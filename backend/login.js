// Login / recovery flow.
//
// Opens a VISIBLE (headful, on-screen) browser per provider so the user can log
// in. SMS codes, QR scans, and captcha/human-verification are ALWAYS completed
// by the user. The persistent context auto-saves the session to its userDataDir,
// so login persists across runs.
//
// Usage:
//   npm run login                 # all providers
//   node backend/login.js kimi    # just one (or several) providers

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { providers, PROVIDER_IDS } from '../config/providers.js';
import { createAdapter } from './adapters/index.js';
import { hub } from './transport.js';
import { log } from './log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Open one provider headful and keep the window open until the USER closes it.
 * We never auto-close based on detection (detection is imperfect and was closing
 * windows before the user could finish). The persistent context saves the
 * session continuously, so simply logging in then closing the window persists it.
 * Detection runs in the background only to REPORT status, never to close.
 */
async function loginOne(id, index = 0) {
  const base = providers[id];
  const adapter = createAdapter(id);
  // Force VISIBLE on-screen window; cascade by index so multiple login windows
  // don't stack on top of each other.
  const x = 60 + index * 60;
  const y = 50 + index * 60;
  adapter.cfg = {
    ...base,
    headless: false,
    launchOptions: { args: [`--window-position=${x},${y}`, '--window-size=1000,800'] },
  };

  await adapter.launch();
  const page = adapter.page;

  log.info(id, 'login window opened');
  console.log(`\n[${id}] 窗口已打开。请登录；登录完成后，直接关闭这个窗口即可（会话会自动保存）。`);
  hub.status(id, 'logged-out');

  // Background poll: remember the latest detected login state for reporting.
  let lastOk = false;
  const poll = setInterval(async () => {
    try { lastOk = await adapter.ensureLoggedIn(); } catch { /* page busy */ }
    if (lastOk) {
      log.info(id, 'login detected');
      hub.status(id, 'idle');
    }
  }, 3000);

  // Wait until the user closes the window/context, or a generous timeout.
  await new Promise((resolve) => {
    let done = false;
    // Warn 1 minute before the 15-minute cap so the user isn't surprised.
    const warnTimer = setTimeout(() => {
      console.log(`\n[${id}] ⚠️  登录窗口将在 1 分钟后自动关闭`);
    }, 14 * 60 * 1000);
    const capTimer = setTimeout(() => {
      console.log(`\n[${id}] ⏰  登录超时（15 分钟），窗口关闭`);
      finish();
    }, 15 * 60 * 1000);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(warnTimer);
      clearTimeout(capTimer);
      resolve();
    };
    adapter.context.on('close', finish);
    page.on('close', finish);
  });

  clearInterval(poll);
  await adapter.close().catch(() => {});
  log.info(id, 'login window closed', { ok: lastOk });
  console.log(`[${id}] 窗口已关闭。检测登录态：${lastOk ? '✓ 已登录' : '未确认（若你已登录，会话仍已保存）'}`);
  return { id, ok: lastOk };
}

/** Run login for the given provider ids (default: all), in parallel windows. */
export async function runLogin(ids = PROVIDER_IDS) {
  const valid = ids.filter((id) => PROVIDER_IDS.includes(id));
  return Promise.all(valid.map((id, i) => loginOne(id, i)));
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ids = args.length ? args : PROVIDER_IDS;
  runLogin(ids)
    .then((rs) => {
      const ok = rs.filter((r) => r.ok).map((r) => r.id);
      const bad = rs.filter((r) => !r.ok).map((r) => r.id);
      console.log(`\nLogged in: ${ok.join(', ') || '(none)'}`);
      if (bad.length) console.log(`Not completed: ${bad.join(', ')}`);
      process.exit(0);
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
