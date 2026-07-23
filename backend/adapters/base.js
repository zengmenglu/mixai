// Shared adapter interface. The orchestrator only ever talks to this surface,
// so it stays completely provider-agnostic. All provider-specific selectors and
// quirks are confined to subclasses — when a provider redesigns its UI, only
// that one subclass needs editing.

import { launchProviderContext } from '../browser/contextFactory.js';
import { streamAnswer } from '../browser/scrape.js';
import { plog } from '../log.js';

// Second-chance wait after a reload when the first login check failed. Kept
// shorter than loginSettleMs so a genuinely logged-out provider doesn't double
// the user's wait - the reload is a best-effort recovery, not a full retry.
const RELOAD_RETRY_MS = 15000;

/** @typedef {'idle'|'streaming'|'done'|'unavailable'|'logged-out'|'stopped'} PaneStatus */

export class BaseAdapter {
  /** @param {object} cfg one entry from config/providers.js */
  constructor(cfg) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.label = cfg.label;
    /** @type {import('playwright').BrowserContext|null} */
    this.context = null;
    /** @type {import('playwright').Page|null} */
    this.page = null;
    /** Tag-bound logger so every line carries this provider's id. */
    this.log = plog(cfg.id);
  }

  // ---- lifecycle ----------------------------------------------------------

  async launch() {
    // Reuse a live page if we still have one. Probe it cheaply so we also catch
    // a SIGKILL'd browser (whose close event never fired), not just a window
    // the user closed. Dead -> re-launch fresh; we never operate on a dead page.
    if (this.page && !this.page.isClosed()) {
      // Race with a short timeout: a dead browser usually rejects fast, but a
      // hung transport must not block the turn for the default 30s.
      const alive = await Promise.race([
        this.page.evaluate(() => true).catch(() => false),
        new Promise((r) => setTimeout(() => r(false), 2000)),
      ]);
      if (alive) return;
      this.log.warn('existing browser is dead, relaunching');
    }
    // Release the old context (and its profile lock) before re-launching,
    // otherwise the new launch collides with the stale one over the userDataDir.
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
    const { context, page } = await launchProviderContext(this.cfg);
    this.context = context;
    this.page = page;
    this.#watchClose(context, page);
    await this.page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const title = await this.page.title().catch(() => '?');
    this.log.info('navigated', { url: this.cfg.url, title });
  }

  /** Watch for external close (user closed the window, or the browser died) so
   *  the next turn's launch() re-opens a fresh browser instead of erroring on a
   *  dead page. Idempotent: only clears if the refs still point at our objects. */
  #watchClose(context, page) {
    const clear = () => {
      if (this.page === page) this.page = null;
      if (this.context === context) this.context = null;
    };
    page.on('close', () => { clear(); this.log.warn('page closed externally; will relaunch on next turn'); });
    context.on('close', () => { clear(); this.log.warn('browser closed externally; will relaunch on next turn'); });
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }

  // ---- interface (subclasses MUST implement) ------------------------------

  /** @returns {Promise<boolean>} true if a usable, logged-in chat UI is present */
  async ensureLoggedIn() {
    throw new Error(`${this.id}: ensureLoggedIn() not implemented`);
  }

  /**
   * Poll ensureLoggedIn() for up to `ms`, so slow-settling pages (real-Chrome +
   * proxy + Cloudflare for ChatGPT, SPA hydration generally) aren't prematurely
   * declared logged-out on the very first check.
   */
  async waitLoggedIn(ms = 12000) {
    const start = Date.now();
    let ok = false;
    do {
      try { if (await this.ensureLoggedIn()) { ok = true; break; } } catch { /* not ready */ }
      await this.page.waitForTimeout(800);
    } while (Date.now() - start < ms);
    this.log.info('login check', { ok, waitedMs: Date.now() - start });
    return ok;
  }

  /**
   * Ensure a chat exists for this turn.
   * @param {'new'|'continue'} mode
   */
  async ensureChat(mode) {
    throw new Error(`${this.id}: ensureChat() not implemented`);
  }

  /** Type the question and submit it. @param {string} question */
  async send(question) {
    throw new Error(`${this.id}: send() not implemented`);
  }

  /** Reads the full current text of the latest answer. @returns {Promise<string>} */
  async readLatestAnswerText() {
    throw new Error(`${this.id}: readLatestAnswerText() not implemented`);
  }

  /** Reads the latest answer's innerHTML (provider-rendered, with <p>/<ul>/
   *  <strong>/<a> etc. intact). The frontend renders this directly so the
   *  answer keeps its native formatting (paragraphs, lists, bold, links,
   *  tables) instead of a flattened text version. Subclasses MUST implement.
   *  @returns {Promise<string>} HTML string ('' if no answer yet) */
  async readLatestAnswerHtml() {
    throw new Error(`${this.id}: readLatestAnswerHtml() not implemented`);
  }

  /** Optional corroborating "still generating" signal. @returns {Promise<boolean>} */
  async isStreaming() {
    return false;
  }

  /** Detect a usage/quota/rate-limit wall. @returns {Promise<boolean>} */
  async isQuotaExhausted() {
    return false;
  }

  // ---- shared driving logic (subclasses usually reuse this) ---------------

  /**
   * Full turn: ensure session + chat, send, then stream the answer.
   * Yields {type:'delta'|'status'|'done'} events the orchestrator forwards.
   * @param {string} question
   * @param {'new'|'continue'} mode
   * @param {AbortSignal} [signal] abort to stop mid-turn (stop button)
   */
  async *ask(question, mode, signal) {
    await this.launch();
    if (signal?.aborted) return;

    if (!(await this.waitLoggedIn(this.cfg.loginSettleMs || 12000))) {
      // Stale page (auth expired / transient Cloudflare challenge while the
      // browser sat idle for hours/days). Reload once and recheck before giving
      // up: a reload re-runs auth/redirects and often recovers it without a
      // manual login. Falls through to logged-out if it still fails.
      this.log.info('not logged in, reloading once to retry');
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      if (!(await this.waitLoggedIn(RELOAD_RETRY_MS))) {
        this.log.warn('still not logged in after reload, skipping turn');
        yield { type: 'status', status: 'logged-out' };
        return;
      }
    }
    if (signal?.aborted) return;

    if (await this.isQuotaExhausted()) {
      this.log.warn('quota exhausted, skipping turn');
      yield { type: 'status', status: 'unavailable' };
      return;
    }

    await this.ensureChat(mode);
    this.log.info('sending question', { mode, len: question.length });
    await this.send(question);
    if (signal?.aborted) return;

    yield { type: 'status', status: 'streaming' };

    // Capture the previous answer still on the page (continue mode) so the
    // scraper waits for NEW text instead of re-streaming the old answer. Empty
    // for a fresh chat (nothing on the page yet).
    const baseline = await this.readLatestAnswerText().catch(() => '');

    const stream = streamAnswer({
      page: this.page,
      readText: () => this.readLatestAnswerText(),
      readHtml: () => this.readLatestAnswerHtml(),
      isStreaming: () => this.isStreaming(),
      stabilityWindowMs: this.cfg.stabilityWindowMs,
      tag: this.id,
      signal,
      baseline,
    });

    // Track delta volume so the done-time log can reveal mismatches (e.g. a
    // provider whose DOM doubles text: totalChars would exceed fullLen).
    let deltaCount = 0;
    let totalChars = 0;
    for await (const ev of stream) {
      if (ev.type === 'delta') {
        if (ev.html) {
          deltaCount++;
          totalChars += ev.html.length;
          yield { type: 'delta', html: ev.html };
        }
        // mid-stream quota wall can appear after generation starts
      } else if (ev.type === 'done') {
        if (await this.isQuotaExhausted()) {
          this.log.warn('quota exhausted mid-stream');
          yield { type: 'status', status: 'unavailable' };
          return;
        }
        this.log.info('answer done', { deltaCount, totalChars, fullLen: ev.full.length });
        // Capture the conversation URL so a later "resume" can navigate back to
        // this exact chat and the provider recalls the prior turns.
        yield { type: 'status', status: 'done', full: ev.full, url: this.page.url() };
        return;
      }
    }
    // Stream ended without a done event => aborted. Caller (orchestrator)
    // observes the signal and emits 'stopped'; we just stop yielding.
  }

  /**
   * Best-effort halt of in-flight generation: clicks the provider's stop button
   * so the composer is freed for the next turn. Override in subclasses that have
   * a stop-button selector; the default is a no-op.
   */
  async stopGenerating() { /* no-op: override in subclasses with a stop button */ }
}
