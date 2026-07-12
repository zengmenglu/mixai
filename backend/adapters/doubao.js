// Doubao adapter — doubao.com (ByteDance). Stricter detection: stealthLevel
// 'high' + larger stability window are set in config/providers.js.
// Tune selectors during live spike (task 3.3).

import { BaseAdapter } from './base.js';
import {
  firstVisible, anyExists, typeInto, clickFirst, pageTextMatches,
} from './util.js';

const S = {
  input: [
    'textarea.semi-input-textarea',
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="输入"]',
    'textarea',
  ],
  sendButton: [
    'button:has-text("发送")',
    '[aria-label*="发送"]',
    'button[type="submit"]',
  ],
  newChat: [
    'text=新对话', 'text=新建对话', 'button:has-text("新对话")',
  ],
  // Every message bubble carries data-message-id. User bubbles are right-aligned
  // (.justify-end); the assistant answer is the latest one WITHOUT that class.
  answer: [
    'div[data-message-id]:not(.justify-end)',
    'div[data-target-id="message-box-target-id"]',
  ],
  stopButton: [
    'button:has-text("停止")',
    '[aria-label*="停止"]',
    '[aria-label*="stop" i]',
  ],
  // The "登录以解锁更多功能" modal (phone input / QR) shows when logged OUT.
  loginWall: ['text=登录以解锁', 'text=请输入手机号', 'input[type="password"]'],
  quota: /(达到上限|额度|rate limit|too many requests|稍后再试|今日.*次数)/i,
};

export class DoubaoAdapter extends BaseAdapter {
  async ensureLoggedIn() {
    const hasInput = !!(await firstVisible(this.page, S.input));
    const hasWall = await anyExists(this.page, S.loginWall);
    return hasInput && !hasWall;
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
    // Robust read: take the last assistant bubble (data-message-id, not the
    // right-aligned user bubble) that actually has text. Done in one DOM pass so
    // we don't race a transiently-empty placeholder bubble.
    return this.page.evaluate(() => {
      const msgs = [...document.querySelectorAll('div[data-message-id]')]
        .filter((e) => !/justify-end/.test(e.className || ''));
      for (let i = msgs.length - 1; i >= 0; i--) {
        const t = (msgs[i].innerText || '').trim();
        if (t) return t;
      }
      return '';
    }).catch(() => '');
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
