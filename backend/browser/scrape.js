// Generic streaming scraper + completion detector.
//
// Strategy (per design.md): the primary completion signal is text-stability —
// the response container's text stops growing for `stabilityWindowMs`.
// Adapters may optionally provide a `isStreaming(page)` corroborating signal
// (e.g. a stop button is visible / a streaming cursor exists). When present we
// require BOTH "text stable" AND "not streaming" so a mid-generation stall is
// never mistaken for completion.

const POLL_MS = 220;

/**
 * Stream incremental answer text from a response container.
 *
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {() => Promise<string>} opts.readText  reads current full answer text
 * @param {() => Promise<boolean>} [opts.isStreaming]  optional "still generating" signal
 * @param {number} opts.stabilityWindowMs
 * @param {number} [opts.maxMs] hard cap to avoid hanging forever
 * @returns {AsyncGenerator<{type:'delta', text:string} | {type:'done', full:string}>}
 */
export async function* streamAnswer({
  page,
  readText,
  isStreaming,
  stabilityWindowMs,
  maxMs = 180000,
}) {
  let last = '';
  let lastGrowAt = Date.now();
  const startedAt = Date.now();

  // Small grace period so we don't declare "done" before generation even starts.
  let sawAnyText = false;

  while (true) {
    await page.waitForTimeout(POLL_MS);

    let current = '';
    try {
      current = (await readText()) || '';
    } catch {
      current = last; // transient DOM detach during re-render
    }

    if (current.length > last.length) {
      const delta = current.slice(last.length);
      last = current;
      lastGrowAt = Date.now();
      sawAnyText = sawAnyText || current.trim().length > 0;
      yield { type: 'delta', text: delta };
    } else if (current !== last && current.length > 0) {
      // Container re-rendered/replaced (length not strictly increasing).
      // Emit the whole thing as a correction-free resync only if it diverged.
      if (!current.startsWith(last)) {
        last = current;
        lastGrowAt = Date.now();
        yield { type: 'delta', text: '' }; // keep stream alive; UI keeps prior text
      }
    }

    const stableFor = Date.now() - lastGrowAt;
    let streaming = false;
    if (isStreaming) {
      try {
        streaming = await isStreaming();
      } catch {
        streaming = false;
      }
    }

    const stable = stableFor >= stabilityWindowMs;
    const longEnough = sawAnyText || Date.now() - startedAt > 8000;

    if (stable && !streaming && longEnough) {
      yield { type: 'done', full: last };
      return;
    }

    if (Date.now() - startedAt > maxMs) {
      yield { type: 'done', full: last };
      return;
    }
  }
}
