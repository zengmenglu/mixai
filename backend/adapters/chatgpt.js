// ChatGPT adapter — chatgpt.com
//
// STRICTEST anti-bot (Cloudflare Turnstile + fingerprinting). stealthLevel
// 'high' + headful are mandatory in config. Expect occasional manual captcha:
// when Turnstile/login appears, ensureLoggedIn() returns false so the pane is
// marked logged-out and the user resolves it via the recovery window.
// Tune selectors + study anti-bot during live spike (task 3.4).

import { BaseAdapter } from './base.js';
import {
  firstVisible, anyExists, typeInto, clickFirst, pageTextMatches,
} from './util.js';

const S = {
  input: [
    'div#prompt-textarea[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea[data-id]',
    'textarea',
  ],
  sendButton: [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
    'button:has-text("Send")',
  ],
  newChat: [
    'a[data-testid="create-new-chat-button"]',
    'button:has-text("New chat")',
    'a:has-text("New chat")',
  ],
  // Assistant turns are tagged with data-message-author-role="assistant".
  answer: [
    'div[data-message-author-role="assistant"]:last-of-type .markdown',
    'div[data-message-author-role="assistant"]:last-of-type',
    'div[class*="markdown"]:last-of-type',
  ],
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
  ],
  // HARD walls only (presence => cannot chat, needs the human). ChatGPT allows
  // anonymous chat, so a mere "Log in" button is NOT a wall — only Turnstile /
  // human-verification / the dedicated auth page block usage.
  loginWall: [
    'text=Verify you are human',
    'text=请验证您是真人',
    'iframe[src*="challenges.cloudflare.com"]',
    'input[name="username"]',
  ],
  quota: /(You.?ve reached your|rate limit|too many requests|usage limit|try again later)/i,
};

export class ChatGPTAdapter extends BaseAdapter {
  async ensureLoggedIn() {
    // Turnstile / login wall present => treat as logged-out (user resolves it).
    const wall = await anyExists(this.page, S.loginWall);
    if (wall) return false;
    return !!(await firstVisible(this.page, S.input));
  }

  async ensureChat(mode) {
    if (mode === 'new') {
      const clicked = await clickFirst(this.page, S.newChat);
      if (!clicked) {
        await this.page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      await this.page.waitForTimeout(500);
    }
  }

  async send(question) {
    await typeInto(this.page, S.input, question);
    const clicked = await clickFirst(this.page, S.sendButton);
    if (!clicked) await this.page.keyboard.press('Enter');
  }

  async readLatestAnswerText() {
    const loc = await firstVisible(this.page, S.answer);
    return loc ? (await loc.innerText().catch(() => '')) : '';
  }

  async isStreaming() {
    return !!(await firstVisible(this.page, S.stopButton));
  }

  async isQuotaExhausted() {
    return pageTextMatches(this.page, S.quota);
  }
}
