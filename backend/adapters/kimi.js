// Kimi adapter — kimi.moonshot.cn
// Same surface as DeepSeek. Tune selectors during live spike (task 3.2).

import { BaseAdapter } from './base.js';
import {
  firstVisible, anyExists, typeInto, clickFirst, pageTextMatches,
} from './util.js';

const S = {
  input: [
    'div.chat-input-editor[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  sendButton: [
    'button:has-text("发送")',
    '[aria-label*="send" i]',
    'button[type="submit"]',
  ],
  newChat: [
    'text=新建会话', 'text=新对话', 'text=New chat',
    'button:has-text("新会话")',
  ],
  // Assistant turns: .segment-assistant (read the latest one).
  answer: [
    '.segment-assistant .markdown',
    '.chat-content-item-assistant .markdown',
    '.segment-assistant',
    '.chat-content-item-assistant',
  ],
  stopButton: [
    'button:has-text("停止")',
    '[aria-label*="stop" i]',
    '.stop-button',
  ],
  // "登录以同步历史会话" / a visible 登录 button only show when logged OUT.
  loginWall: ['text=登录以同步', 'input[type="password"]'],
  quota: /(达到上限|额度|rate limit|too many requests|稍后再试|今日.*次数)/i,
};

export class KimiAdapter extends BaseAdapter {
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
      await this.page.waitForTimeout(400);
    }
  }

  async send(question) {
    await typeInto(this.page, S.input, question);
    const clicked = await clickFirst(this.page, S.sendButton);
    if (!clicked) await this.page.keyboard.press('Enter');
  }

  async readLatestAnswerText() {
    // Take the last .markdown container with text. Kimi emits a "thinking"/
    // search segment then the answer; .markdown holds the rendered answer.
    return this.page.evaluate(() => {
      const mds = [...document.querySelectorAll('.segment-assistant .markdown, .markdown')];
      for (let i = mds.length - 1; i >= 0; i--) {
        const t = (mds[i].innerText || '').trim();
        if (t) return t;
      }
      return '';
    }).catch(() => '');
  }

  /** Latest answer's HTML - the last .markdown container with text. */
  async readLatestAnswerHtml() {
    return this.page.evaluate(() => {
      const mds = [...document.querySelectorAll('.segment-assistant .markdown, .markdown')];
      for (let i = mds.length - 1; i >= 0; i--) {
        if ((mds[i].innerText || '').trim()) return mds[i].innerHTML || '';
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
