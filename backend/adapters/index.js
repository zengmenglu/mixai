// Adapter registry — maps provider id -> adapter class.

import { providers } from '../../config/providers.js';
import { DeepSeekAdapter } from './deepseek.js';
import { KimiAdapter } from './kimi.js';
import { DoubaoAdapter } from './doubao.js';
import { ChatGPTAdapter } from './chatgpt.js';

const CLASSES = {
  deepseek: DeepSeekAdapter,
  kimi: KimiAdapter,
  doubao: DoubaoAdapter,
  chatgpt: ChatGPTAdapter,
};

export function createAdapter(id) {
  const Cls = CLASSES[id];
  if (!Cls) throw new Error(`No adapter class for provider: ${id}`);
  return new Cls(providers[id]);
}

export function createAllAdapters() {
  return Object.keys(providers).map((id) => createAdapter(id));
}
