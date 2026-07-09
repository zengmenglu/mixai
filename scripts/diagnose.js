// Throwaway diagnostic: open each provider from its saved profile, report
// ensureLoggedIn() + which input selectors match, and screenshot the page so we
// can tune selectors against the real DOM. Windows open off-screen per config.

import fs from 'node:fs';
import { createAdapter } from '../backend/adapters/index.js';
import { PROVIDER_IDS } from '../config/providers.js';

const OUT = '/tmp/mixai-shots';
fs.mkdirSync(OUT, { recursive: true });

const which = process.argv.slice(2);
const ids = which.length ? which : PROVIDER_IDS;

for (const id of ids) {
  const a = createAdapter(id);
  try {
    await a.launch();
    await a.page.waitForTimeout(4000); // let the SPA settle
    const loggedIn = await a.ensureLoggedIn().catch((e) => `ERR: ${e.message}`);
    // Report a quick DOM census so we can see what's actually present.
    const census = await a.page.evaluate(() => ({
      url: location.href,
      title: document.title,
      textareas: document.querySelectorAll('textarea').length,
      contenteditables: document.querySelectorAll('[contenteditable="true"]').length,
      passwords: document.querySelectorAll('input[type="password"]').length,
      bodySnippet: (document.body.innerText || '').slice(0, 160).replace(/\s+/g, ' '),
    }));
    const shot = `${OUT}/${id}.png`;
    await a.page.screenshot({ path: shot, fullPage: false });
    console.log(JSON.stringify({ id, loggedIn, ...census, shot }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ id, error: String(e.message || e) }));
  } finally {
    await a.close();
  }
}
process.exit(0);
