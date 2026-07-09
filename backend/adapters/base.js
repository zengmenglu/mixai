// Shared adapter interface. The orchestrator only ever talks to this surface,
// so it stays completely provider-agnostic. All provider-specific selectors and
// quirks are confined to subclasses — when a provider redesigns its UI, only
// that one subclass needs editing.

import { launchProviderContext } from '../browser/contextFactory.js';
import { streamAnswer } from '../browser/scrape.js';

/** @typedef {'idle'|'streaming'|'done'|'unavailable'|'logged-out'} PaneStatus */

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
  }

  // ---- lifecycle ----------------------------------------------------------

  async launch() {
    if (this.page) return;
    const { context, page } = await launchProviderContext(this.cfg);
    this.context = context;
    this.page = page;
    await this.page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
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
    do {
      try { if (await this.ensureLoggedIn()) return true; } catch { /* not ready */ }
      await this.page.waitForTimeout(800);
    } while (Date.now() - start < ms);
    return false;
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
   */
  async *ask(question, mode) {
    await this.launch();

    if (!(await this.waitLoggedIn(this.cfg.loginSettleMs || 12000))) {
      yield { type: 'status', status: 'logged-out' };
      return;
    }

    if (await this.isQuotaExhausted()) {
      yield { type: 'status', status: 'unavailable' };
      return;
    }

    await this.ensureChat(mode);
    await this.send(question);

    yield { type: 'status', status: 'streaming' };

    const stream = streamAnswer({
      page: this.page,
      readText: () => this.readLatestAnswerText(),
      isStreaming: () => this.isStreaming(),
      stabilityWindowMs: this.cfg.stabilityWindowMs,
    });

    for await (const ev of stream) {
      if (ev.type === 'delta') {
        if (ev.text) yield { type: 'delta', text: ev.text };
        // mid-stream quota wall can appear after generation starts
      } else if (ev.type === 'done') {
        if (await this.isQuotaExhausted()) {
          yield { type: 'status', status: 'unavailable' };
          return;
        }
        yield { type: 'status', status: 'done', full: ev.full };
        return;
      }
    }
  }
}
