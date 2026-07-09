// Kimi adapter — kimi.moonshot.cn
// Same surface as DeepSeek. Tune selectors during live spike (task 3.2).

import { BaseAdapter } from './base.js';
import {
  firstVisible, lastVisible, anyExists, typeInto, clickFirst, pageTextMatches,
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
    const loc = await lastVisible(this.page, S.answer);
    return loc ? (await loc.innerText().catch(() => '')) : '';
  }

  async isStreaming() {
    return !!(await firstVisible(this.page, S.stopButton));
  }

  async isQuotaExhausted() {
    return pageTextMatches(this.page, S.quota);
  }
}
