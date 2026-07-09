// Small defensive helpers shared by adapters. Providers ship obfuscated,
// frequently-changing class names, so every adapter queries a LIST of candidate
// selectors and uses the first that matches. Repairing after a redesign usually
// means adding one selector string to the relevant list — no logic changes.

/** Return the first locator (from candidates) that is attached & visible, else null. */
export async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 250 })) return loc;
    } catch {
      /* selector not present; try next */
    }
  }
  return null;
}

/** Like firstVisible but returns the LAST match (for "latest answer" reads). */
export async function lastVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).last();
    try {
      if (await loc.isVisible({ timeout: 250 })) return loc;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** True if any candidate selector currently exists in the DOM. */
export async function anyExists(page, selectors) {
  for (const sel of selectors) {
    try {
      if ((await page.locator(sel).count()) > 0) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Type text into the first matching input/textarea/contenteditable.
 *  Falls back to a forced click when an overlay (e.g. a floating sidebar mask)
 *  intercepts pointer events. */
export async function typeInto(page, selectors, text) {
  const loc = await firstVisible(page, selectors);
  if (!loc) throw new Error('input box not found (selectors may need repair)');
  try {
    await loc.click({ timeout: 3000 });
  } catch {
    await loc.click({ force: true }).catch(async () => { await loc.focus().catch(() => {}); });
  }
  await loc.fill('').catch(() => {});
  // Prefer fill for speed/reliability; fall back to typing for editors that
  // ignore fill (some Lexical/contenteditable widgets).
  try {
    await loc.fill(text, { timeout: 2000 });
    if (!(await loc.inputValue().catch(() => text))) throw new Error('fill no-op');
  } catch {
    await loc.type(text, { delay: 8 }).catch(() => {});
  }
  return loc;
}

/** Click the first matching element; returns true if something was clicked. */
export async function clickFirst(page, selectors) {
  const loc = await firstVisible(page, selectors);
  if (!loc) return false;
  await loc.click().catch(() => {});
  return true;
}

/** Does any visible text on the page match the regex? (for quota/limit walls) */
export async function pageTextMatches(page, regex) {
  try {
    const body = await page.locator('body').innerText({ timeout: 500 });
    return regex.test(body);
  } catch {
    return false;
  }
}
