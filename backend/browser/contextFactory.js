// Context factory: launches one persistent browser context per provider.
//
// Launch concerns ONLY live here (headless, args, stealth init scripts,
// userDataDir). Adapters receive the resulting `page` and never know how it
// was launched — that's the launch/scrape decoupling the design requires.

import fs from 'node:fs';
import { chromium as pwChromium } from 'playwright';

// patchright is loaded lazily (only providers that opt into engine:'patchright'
// pay for it). It's a stealth-patched drop-in that defeats Cloudflare Turnstile.
let _patchright = null;
async function engineFor(cfg) {
  if (cfg.engine === 'patchright') {
    if (!_patchright) ({ chromium: _patchright } = await import('patchright'));
    return _patchright;
  }
  return pwChromium;
}

/** Stealth init scripts applied before any page script runs. */
function stealthInitScript(level) {
  if (level === 'none') return null;

  // Standard + high share these basic masks.
  const base = `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  `;

  if (level === 'standard') return base;

  // high: add plugin/permissions/WebGL vendor masking for strict detectors.
  return base + `
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    const _query = window.navigator.permissions && window.navigator.permissions.query;
    if (_query) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : _query(p);
    }
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (p) {
        if (p === 37445) return 'Intel Inc.';        // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return 'Intel Iris OpenGL';  // UNMASKED_RENDERER_WEBGL
        return getParameter.call(this, p);
      };
    } catch (_) {}
  `;
}

/** Parse a proxy URL into Playwright's { server, username?, password? } shape.
 *  Throws early on invalid input so the error is clear at config-load time. */
function parseProxy(str) {
  if (!str || typeof str !== 'string') {
    throw new Error(`Invalid proxy: expected a URL string, got ${typeof str}`);
  }
  try {
    const u = new URL(str);
    if (!u.host) throw new Error('no host');
    const server = `${u.protocol}//${u.host}`;
    const out = { server };
    if (u.username) out.username = decodeURIComponent(u.username);
    if (u.password) out.password = decodeURIComponent(u.password);
    return out;
  } catch {
    // Bare "host:port" — assume http, but validate basic shape.
    if (/^[\w.-]+:\d+$/.test(str)) {
      return { server: `http://${str}` };
    }
    throw new Error(`Invalid proxy format: "${str}". Expected URL (http://host:port) or host:port`);
  }
}

/**
 * Launch (or reopen) the persistent context for a provider.
 * @param {object} cfg one entry from config/providers.js
 * @returns {Promise<{ context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
export async function launchProviderContext(cfg) {
  fs.mkdirSync(cfg.userDataDir, { recursive: true });

  const chromium = await engineFor(cfg);
  const usePatchright = cfg.engine === 'patchright';

  const launchOpts = {
    headless: cfg.headless,
    ...cfg.launchOptions,
  };
  if (cfg.channel) launchOpts.channel = cfg.channel; // e.g. real 'chrome'
  if (cfg.proxy) launchOpts.proxy = parseProxy(cfg.proxy);

  if (usePatchright) {
    // Let patchright + real Chrome present a genuine fingerprint. No viewport
    // lock, no UA tampering, no init script — those would undo its stealth.
    launchOpts.viewport = null;
  } else {
    launchOpts.viewport = { width: 1280, height: 900 };
    launchOpts.locale = 'zh-CN';
    launchOpts.userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  const context = await chromium.launchPersistentContext(cfg.userDataDir, launchOpts);

  if (!usePatchright) {
    const init = stealthInitScript(cfg.stealthLevel);
    if (init) await context.addInitScript(init);
  }

  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}
