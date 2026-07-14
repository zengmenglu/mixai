// Orchestrator: owns the four adapters, fans one question out to all of them
// concurrently, maps the tool conversation to one chat per provider, serializes
// turns per pane, and isolates per-pane failures. All output goes to the SSE hub.

import { createAllAdapters } from './adapters/index.js';
import { hub } from './transport.js';
import { log } from './log.js';

export class Orchestrator {
  constructor() {
    this.adapters = createAllAdapters();
    // Per-pane state: whether this conversation has already opened a chat,
    // and a promise chain that serializes turns so two questions never
    // interleave in one pane.
    this.panes = new Map();
    for (const a of this.adapters) {
      // controller: the AbortController for the pane's CURRENT turn (null when
      // idle). stop(id) aborts it to terminate a slow answer mid-stream.
      this.panes.set(a.id, { adapter: a, started: false, chain: Promise.resolve(), controller: null });
    }
  }

  /** Launch all provider browsers eagerly at startup. Fire-and-forget: failures are logged, never crash. */
  async launchAll() {
    log.info('orchestrator', 'launching all providers', { count: this.adapters.length });
    const results = await Promise.allSettled(
      this.adapters.map(async (a) => {
        await a.launch();
        hub.status(a.id, 'idle');
      })
    );
    for (let i = 0; i < results.length; i++) {
      const id = this.adapters[i].id;
      if (results[i].status === 'rejected') {
        const error = results[i].reason?.message || String(results[i].reason);
        log.error(id, 'launch failed', { error });
        // Surface to the UI so the pane shows error (not silent idle) and the
        // user knows to check the log / proxy / login for this provider.
        hub.status(id, 'error', { message: `launch failed: ${error}` });
      }
    }
  }

  /** Start a fresh conversation: next turn opens a new chat in every provider. */
  newConversation() {
    for (const p of this.panes.values()) p.started = false;
    hub.system('new-conversation');
  }

  /** Fan a question out to all panes concurrently. Returns when all settle.
   *  @param {string} question
   *  @param {string[]} [ids] optional provider-id allowlist; unset/empty = all
   *  @param {Object<string,string>} [resumeUrls] map providerId->chat URL to
   *    resume; the pane navigates there only if it isn't already on that URL
   *    (so same-session continue is free, cross-session resume navigates). */
  ask(question, ids, resumeUrls) {
    const allow = new Set(ids && ids.length ? ids : null);
    const runs = [];
    for (const pane of this.panes.values()) {
      if (allow.size && !allow.has(pane.adapter.id)) continue;
      const resumeUrl = resumeUrls && resumeUrls[pane.adapter.id];
      // Append to this pane's chain so its turns run strictly in order.
      pane.chain = pane.chain.then(() => this.#runPane(pane, question, resumeUrl));
      runs.push(pane.chain);
    }
    log.info('orchestrator', 'ask fanning out', { panes: runs.length, preview: question.slice(0, 40), resume: !!resumeUrls });
    return Promise.allSettled(runs);
  }

  async #runPane(pane, question, resumeUrl) {
    const { adapter } = pane;
    // Resume a prior conversation: navigate to its saved URL so the provider
    // recalls the context, then continue on it. Skip the nav if we're already
    // on that URL (cheap same-session follow-ups). Fall back to a fresh chat if
    // the URL won't load.
    if (resumeUrl) {
      await adapter.launch();
      if (adapter.page.url() !== resumeUrl) {
        const ok = await adapter.page.goto(resumeUrl, { waitUntil: 'domcontentloaded' })
          .then(() => true).catch(() => false);
        pane.started = ok;
        log.info(adapter.id, ok ? 'resumed conversation' : 'resume nav failed, new chat', { url: resumeUrl });
      } else {
        pane.started = true; // already on this conversation
      }
    }
    const mode = pane.started ? 'continue' : 'new';
    const controller = new AbortController();
    pane.controller = controller;
    log.info(adapter.id, 'turn start', { mode });
    try {
      for await (const ev of adapter.ask(question, mode, controller.signal)) {
        if (ev.type === 'delta') {
          hub.delta(adapter.id, ev.text);
        } else if (ev.type === 'status') {
          // On completion, forward the authoritative full text so the UI can
          // render/resync even if some streamed deltas were missed (e.g. a slow
          // provider whose answer rendered in one late burst).
          if (ev.status === 'done' && typeof ev.full === 'string') {
            hub.status(adapter.id, 'done', { full: ev.full, url: ev.url });
          } else {
            hub.status(adapter.id, ev.status);
          }
          if (ev.status === 'streaming') {
            // A successful send means the chat is now open for follow-ups.
            pane.started = true;
          }
        }
      }
      // Stream ended without a 'done' event => aborted via stop(). Emit
      // 'stopped' so the UI frees the pane; other panes are unaffected.
      if (controller.signal.aborted) {
        log.info(adapter.id, 'turn stopped');
        hub.status(adapter.id, 'stopped');
      }
    } catch (err) {
      if (controller.signal.aborted) {
        log.info(adapter.id, 'turn stopped (during error path)');
        hub.status(adapter.id, 'stopped');
      } else {
        const message = String(err && err.message || err);
        log.error(adapter.id, 'turn error', { error: message });
        // Isolation: one pane's failure never blocks the others.
        hub.status(adapter.id, 'error', { message });
      }
    } finally {
      if (pane.controller === controller) pane.controller = null;
    }
  }

  /** Stop a provider's current turn: abort the scrape loop and click the
   *  provider's stop button to halt generation (frees the composer for the next
   *  turn). Other panes keep running; this pane's chain resolves so the next
   *  question can run on it too - no blocking. */
  async stop(id) {
    const pane = this.panes.get(id);
    if (!pane) return;
    log.info(id, 'stop requested');
    if (pane.controller) pane.controller.abort();
    // Best-effort halt of the provider's own generation so the composer is free
    // for the next question. Errors here are harmless (no stop button visible).
    await pane.adapter.stopGenerating().catch(() => {});
  }

  /** Close one provider's browser so its profile lock is released - used before
   *  reopening it for login recovery. The next turn re-launches it fresh with
   *  the (now updated) saved session. Without this, the login window's Chrome
   *  collides with the running adapter's Chrome over the same userDataDir and
   *  fails with "opening in an existing browser session". */
  async closeProvider(id) {
    const pane = this.panes.get(id);
    if (!pane) return;
    await pane.adapter.close().catch(() => {});
    pane.started = false;
    log.info(id, 'provider closed (will relaunch on next turn)');
    hub.status(id, 'logged-out');
  }

  async closeAll() {
    await Promise.allSettled(this.adapters.map((a) => a.close()));
  }
}
