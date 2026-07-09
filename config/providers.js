// Central per-service configuration.
//
// This is the ONLY place launch/runtime knobs live. Adapters never hardcode
// headless or launch options — they receive an already-launched context from
// the context factory. That keeps "how the browser starts" fully decoupled
// from "how we scrape", so flipping a provider headful<->headless (A->B),
// running mixed mode, or adding a virtual display is a config-only change.
//
// stealthLevel: 'none' | 'standard' | 'high'
//   - none:     vanilla (friendly providers, headful)
//   - standard: basic fingerprint masking
//   - high:     full hardening (detection-strict providers)
//
// stabilityWindowMs: how long the answer text must stop growing before we
//   consider a turn complete. Tune per provider during the live spike.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.resolve(__dirname, '..', 'profiles');

export const PROFILES_ROOT = PROFILES_DIR;

/** @typedef {'none'|'standard'|'high'} StealthLevel */

export const providers = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    userDataDir: path.join(PROFILES_DIR, 'deepseek'),
    headless: false, // friendly, but headful is a safe default
    stealthLevel: 'standard',
    stabilityWindowMs: 800,
    launchOptions: {
      // Off-screen + reasonable viewport. Window is "there" but out of the way.
      args: ['--window-position=-2400,0', '--window-size=1280,900'],
    },
  },

  kimi: {
    id: 'kimi',
    label: 'Kimi',
    url: 'https://www.kimi.com/',
    userDataDir: path.join(PROFILES_DIR, 'kimi'),
    headless: false,
    stealthLevel: 'standard',
    stabilityWindowMs: 800,
    launchOptions: {
      args: ['--window-position=-2400,0', '--window-size=1280,900'],
    },
  },

  doubao: {
    id: 'doubao',
    label: 'Doubao',
    url: 'https://www.doubao.com/chat/',
    userDataDir: path.join(PROFILES_DIR, 'doubao'),
    headless: false, // stricter detection — keep headful
    stealthLevel: 'high',
    stabilityWindowMs: 1100,
    launchOptions: {
      args: ['--window-position=-2400,0', '--window-size=1280,900'],
    },
  },

  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    userDataDir: path.join(PROFILES_DIR, 'chatgpt'),
    headless: false, // strictest (Turnstile + fingerprint) — never headless until proven
    // Drive REAL Chrome via patchright to get past Cloudflare Turnstile. With
    // patchright the engine handles stealth itself, so we skip our manual init
    // script and UA tampering (adding those can actually re-trigger detection).
    engine: 'patchright',
    channel: 'chrome',
    stealthLevel: 'none',
    stabilityWindowMs: 1500,
    // Real Chrome + proxy + Cloudflare settles slowly, especially when all four
    // browsers launch at once — give the login check a longer window.
    loginSettleMs: 30000,
    // Per-service proxy: only ChatGPT routes through it (the other three are
    // reachable directly). Accepts http(s)://host:port or socks5://host:port,
    // optionally with user:pass@. Set CHATGPT_PROXY to override without editing.
    proxy: process.env.CHATGPT_PROXY || 'http://127.0.0.1:7890',
    launchOptions: {
      args: ['--window-position=-2400,0', '--window-size=1280,900'],
    },
  },
};

export const PROVIDER_IDS = Object.keys(providers);

export function getProviderConfig(id) {
  const cfg = providers[id];
  if (!cfg) throw new Error(`Unknown provider: ${id}`);
  return cfg;
}
