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
    // right-aligned user bubble) that actually has text. Doubao prepends a
    // search-status line ("搜索 N 个关键词，参考 N 篇资料" / "找到 N 篇资料")
    // to the answer bubble; strip those status lines so we read (and stream)
    // only the real answer, and so completion isn't triggered by the status.
    return this.page.evaluate(() => {
      const msgs = [...document.querySelectorAll('div[data-message-id]')]
        .filter((e) => !/justify-end/.test(e.className || ''));
      const statusRe = /^(正在搜索|搜索中|找到\s*[一二三四五六七八九十\d]+\s*篇资料|搜索\s*[一二三四五六七八九十\d]+\s*个关键词[^\n]*|参考\s*[一二三四五六七八九十\d]+\s*篇资料[^\n]*)$/;
      for (let i = msgs.length - 1; i >= 0; i--) {
        let t = (msgs[i].innerText || '').trim();
        if (!t) continue;
        // Drop leading search-status lines (they sit atop the real answer).
        const lines = t.split('\n');
        while (lines.length && statusRe.test(lines[0].trim())) lines.shift();
        t = lines.join('\n').trim();
        if (t) return t;
      }
      return '';
    }).catch(() => '');
  }

  /** Latest answer bubble's HTML. Doubao renders the answer as multiple
   *  [data-render-engine] blocks inside the last div[data-message-id]: the
   *  first is a short search-status line ("搜索N个关键词..."), the rest are the
   *  real answer content. Take the LAST block with real text (>20 chars, to
   *  skip the status line) - that's the current/latest answer chunk. Fall back
   *  to the bubble if no engine block matches. */
  async readLatestAnswerHtml() {
    return this.page.evaluate(() => {
      const msgs = [...document.querySelectorAll('div[data-message-id]')]
        .filter((e) => !/justify-end/.test(e.className || ''));
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!(m.innerText || '').trim()) continue;
        const engines = [...m.querySelectorAll('[data-render-engine]')];
        // pick last engine block with substantial text (skip status line)
        for (let j = engines.length - 1; j >= 0; j--) {
          if ((engines[j].innerText || '').trim().length > 20) return engines[j].innerHTML || '';
        }
        return m.innerHTML || '';
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
