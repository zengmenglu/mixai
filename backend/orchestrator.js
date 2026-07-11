// Orchestrator: owns the four adapters, fans one question out to all of them
// concurrently, maps the tool conversation to one chat per provider, serializes
// turns per pane, and isolates per-pane failures. All output goes to the SSE hub.

import { createAllAdapters } from './adapters/index.js';
import { hub } from './transport.js';

export class Orchestrator {
  constructor() {
    this.adapters = createAllAdapters();
    // Per-pane state: whether this conversation has already opened a chat,
    // and a promise chain that serializes turns so two questions never
    // interleave in one pane.
    this.panes = new Map();
    for (const a of this.adapters) {
      this.panes.set(a.id, { adapter: a, started: false, chain: Promise.resolve() });
    }
  }

  /** Launch all provider browsers eagerly at startup. Fire-and-forget: failures are logged, never crash. */
  async launchAll() {
    const results = await Promise.allSettled(
      this.adapters.map(async (a) => {
        await a.launch();
        hub.status(a.id, 'idle');
      })
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        console.error(`[${this.adapters[i].id}] launch failed:`, results[i].reason?.message);
      }
    }
  }

  /** Start a fresh conversation: next turn opens a new chat in every provider. */
  newConversation() {
    for (const p of this.panes.values()) p.started = false;
    hub.system('new-conversation');
  }

  /** Fan a question out to all panes concurrently. Returns when all settle. */
  ask(question) {
    const runs = [];
    for (const pane of this.panes.values()) {
      // Append to this pane's chain so its turns run strictly in order.
      pane.chain = pane.chain.then(() => this.#runPane(pane, question));
      runs.push(pane.chain);
    }
    return Promise.allSettled(runs);
  }

  async #runPane(pane, question) {
    const { adapter } = pane;
    const mode = pane.started ? 'continue' : 'new';
    try {
      for await (const ev of adapter.ask(question, mode)) {
        if (ev.type === 'delta') {
          hub.delta(adapter.id, ev.text);
        } else if (ev.type === 'status') {
          // On completion, forward the authoritative full text so the UI can
          // render/resync even if some streamed deltas were missed (e.g. a slow
          // provider whose answer rendered in one late burst).
          if (ev.status === 'done' && typeof ev.full === 'string') {
            hub.status(adapter.id, 'done', { full: ev.full });
          } else {
            hub.status(adapter.id, ev.status);
          }
          if (ev.status === 'streaming') {
            // A successful send means the chat is now open for follow-ups.
            pane.started = true;
          }
        }
      }
    } catch (err) {
      // Isolation: one pane's failure never blocks the others.
      hub.status(adapter.id, 'error', { message: String(err && err.message || err) });
    }
  }

  async closeAll() {
    await Promise.allSettled(this.adapters.map((a) => a.close()));
  }
}
