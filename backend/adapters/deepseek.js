// DeepSeek adapter — chat.deepseek.com
//
// SELECTORS: the only part that breaks on redesign. Each is a candidate list;
// add a new string to repair. Verify/tune these during the live spike (task 3.1).

import { BaseAdapter } from './base.js';
import {
  firstVisible, anyExists, typeInto, clickFirst, pageTextMatches,
} from './util.js';

const S = {
  // Login wall indicators (presence => logged OUT)
  loginWall: [
    'text=登录', 'text=Log in', 'input[type="password"]',
    'button:has-text("登录")',
  ],
  // The message composer (presence => logged IN and ready)
  input: [
    'textarea#chat-input',
    'textarea[placeholder*="给 DeepSeek"]',
    'textarea[placeholder*="message"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  sendButton: [
    'div[role="button"][aria-disabled="false"]:near(textarea)',
    'button[type="submit"]',
    'button:has-text("发送")',
  ],
  newChat: [
    'text=新建对话', 'text=New chat', 'a:has-text("新对话")',
    'button:has-text("新对话")',
  ],
  // Latest assistant answer container (last match = newest turn).
  answer: [
    '.ds-markdown',
    'div[class*="markdown"]',
    'div[class*="message"][class*="assistant"]',
  ],
  // "Still generating" signal
  stopButton: [
    'div[role="button"]:has-text("停止")',
    'button:has-text("Stop")',
    '[aria-label*="stop" i]',
  ],
  quota: /(达到上限|额度已用完|rate limit|too many requests|稍后再试)/i,
};

export class DeepSeekAdapter extends BaseAdapter {
  async ensureLoggedIn() {
    // Logged in if a composer is visible and no password wall is present.
    const hasInput = !!(await firstVisible(this.page, S.input));
    const hasWall = await anyExists(this.page, ['input[type="password"]']);
    return hasInput && !hasWall;
  }

  async ensureChat(mode) {
    if (mode === 'new') {
      const clicked = await clickFirst(this.page, S.newChat);
      if (!clicked) {
        await this.page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      await this.page.waitForTimeout(400);
    }
  }

  async send(question) {
    await typeInto(this.page, S.input, question);
    // Prefer Enter; fall back to a send button.
    const clicked = await clickFirst(this.page, S.sendButton);
    if (!clicked) await this.page.keyboard.press('Enter');
  }

  async readLatestAnswerText() {
    // Text read (for stability/baseline detection) - strips citation spans so
    // they don't pollute the text. Keep cheap; the streamed payload is HTML.
    return this.page.evaluate((sel) => {
      const locs = [...document.querySelectorAll(sel)];
      const last = locs[locs.length - 1];
      if (!last) return '';
      const clone = last.cloneNode(true);
      clone.querySelectorAll('.ds-markdown-cite, sup, [class*="cite"]').forEach((e) => e.remove());
      return (clone.innerText || '').trim();
    }, S.answer[0]).catch(() => '');
  }

  /** Latest answer's HTML, citation spans removed (they render as "-\n1" noise). */
  async readLatestAnswerHtml() {
    return this.page.evaluate((sel) => {
      const locs = [...document.querySelectorAll(sel)];
      const last = locs[locs.length - 1];
      if (!last) return '';
      const clone = last.cloneNode(true);
      clone.querySelectorAll('.ds-markdown-cite, sup, [class*="cite"]').forEach((e) => e.remove());
      return clone.innerHTML || '';
    }, S.answer[0]).catch(() => '');
  }

  async isStreaming() {
    return !!(await firstVisible(this.page, S.stopButton));
  }

  async isQuotaExhausted() {
    return pageTextMatches(this.page, S.quota);
  }

  /** Click the stop button to halt generation, freeing the composer for the
   *  next turn (used by the per-pane stop button). */
  async stopGenerating() { await clickFirst(this.page, S.stopButton); }
}
