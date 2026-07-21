// Generic streaming scraper + completion detector.
//
// Strategy (per design.md): the primary completion signal is text-stability —
// the response container's text stops growing for `stabilityWindowMs`.
// Adapters may optionally provide a `isStreaming(page)` corroborating signal
// (e.g. a stop button is visible / a streaming cursor exists). When present we
// require BOTH "text stable" AND "not streaming" so a mid-generation stall is
// never mistaken for completion.

import { plog } from '../log.js';

const POLL_MS = 150;

/**
 * Stream incremental answer text from a response container.
 *
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {() => Promise<string>} opts.readText  reads current full answer text
 * @param {() => Promise<boolean>} [opts.isStreaming]  optional "still generating" signal
 * @param {number} opts.stabilityWindowMs
 * @param {number} [opts.maxMs] hard cap to avoid hanging forever
 * @param {string} [opts.tag] provider id for log lines
 * @param {AbortSignal} [opts.signal] abort to stop streaming mid-answer
 * @param {string} [opts.baseline] text of the PREVIOUS answer still on the page
 *   (continue mode); the stream waits for new text that diverges from it so we
 *   never re-stream the old answer. Empty/omitted for a fresh chat.
 * @returns {AsyncGenerator<{type:'delta', text:string} | {type:'done', full:string}>}
 */
export async function* streamAnswer({
  page,
  readText,
  isStreaming,
  stabilityWindowMs,
  maxMs = 180000,
  tag = 'scrape',
  signal,
  baseline = '',
}) {
  const log = plog(tag);
  let last = '';
  let lastGrowAt = Date.now();
  const startedAt = Date.now();

  // Small grace period so we don't declare "done" before generation even starts.
  let sawAnyText = false;
  // Consecutive readText failures: if the selector breaks mid-stream we fast-fail
  // instead of spinning until maxMs.
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 20;
  // Minimum length for the DOM-echo guard: only suppress a delta when the prior
  // text is long enough that an exact self-repetition is implausibly a real
  // answer (avoids truncating short legitimate repetitions like "是。是。").
  const ECHO_MIN_LEN = 10;
  // Continue mode: the page still shows the PREVIOUS answer. Don't stream it
  // again - wait until readText diverges from the baseline (the new answer
  // appears), then stream from scratch. baseline='' (fresh chat) drops immediately.
  let baselineDropped = !baseline;

  while (true) {
    // Stop button: abort returns promptly (within one poll) without yielding a
    // done event - the orchestrator emits 'stopped' from the outside.
    if (signal?.aborted) {
      log.info('aborted, stopping stream', { fullLen: last.length });
      return;
    }
    // User closed the window mid-stream: finish gracefully with the partial
    // text instead of throwing "Target page ... has been closed". The next
    // turn's launch() re-opens a fresh browser, so no error surfaces.
    if (page.isClosed()) {
      log.warn('page closed mid-stream, finishing partial', { fullLen: last.length });
      yield { type: 'done', full: last };
      return;
    }
    try {
      await page.waitForTimeout(POLL_MS);
    } catch {
      log.warn('page closed during wait, finishing partial', { fullLen: last.length });
      yield { type: 'done', full: last };
      return;
    }

    let current = '';
    try {
      current = (await readText()) || '';
      consecutiveFailures = 0; // reset on success
    } catch {
      consecutiveFailures++;
      // If the selector worked before (we've seen text) but now fails
      // repeatedly, it may have been removed from the DOM. Fast-fail.
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && sawAnyText) {
        log.warn('readText failing repeatedly, fast-finishing', { failures: consecutiveFailures });
        yield { type: 'done', full: last };
        return;
      }
      current = last; // transient DOM detach during re-render
    }

    // Continue mode: hold off while the page still shows the previous answer.
    // Reset the stability clock so we never declare done on stale text; once the
    // read text diverges from the baseline, drop it and stream the new answer.
    if (!baselineDropped) {
      if (current !== baseline) {
        baselineDropped = true;
        last = '';
        lastGrowAt = Date.now();
      } else {
        lastGrowAt = Date.now();
        current = last; // no growth to evaluate below
      }
    }

    if (baselineDropped) {
      if (current.length > last.length) {
        // Safety net for provider DOM echo: if the container duplicated its
        // content (current is exactly last repeated), streaming the slice would
        // print the whole answer a second time. Skip and warn.
        const isEcho = last.length >= ECHO_MIN_LEN && current === last + last;
        if (isEcho) {
          log.warn('detected DOM echo, skipping duplicate', { lastLen: last.length });
        } else {
          const delta = current.slice(last.length);
          log.debug('delta', { lastLen: last.length, curLen: current.length, deltaLen: delta.length });
          last = current;
          lastGrowAt = Date.now();
          sawAnyText = sawAnyText || current.trim().length > 0;
          yield { type: 'delta', text: delta };
        }
      } else if (current !== last && current.length > 0) {
        // Container re-rendered/replaced (length not strictly increasing).
        if (!current.startsWith(last)) {
          log.debug('container re-rendered, text diverged', { lastLen: last.length, curLen: current.length });
          last = current;
          lastGrowAt = Date.now();
          yield { type: 'delta', text: '' };
        }
      }

      const stableFor = Date.now() - lastGrowAt;
      let streaming = false;
      if (isStreaming) {
        try { streaming = await isStreaming(); } catch { streaming = false; }
      }
      const stable = stableFor >= stabilityWindowMs;
      // Never finish on an empty answer: require actual text (sawAnyText) before
      // declaring done. This avoids returning '' when a slow first turn (Kimi/
      // ChatGPT hydration) hasn't rendered text within the stability window.
      // maxMs is the only time-based cap; the 8s fallback is removed so we don't
      // silently produce empty answers. In continue mode sawAnyText reflects NEW
      // text (baseline is dropped before counting), so this also guards re-asks.
      const longEnough = sawAnyText;
      if (stable && !streaming && longEnough) {
        log.info('answer stable, finishing', { fullLen: last.length, stableFor, preview: last.slice(0, 80) });
        yield { type: 'done', full: last };
        return;
      }
    }

    if (Date.now() - startedAt > maxMs) {
      log.warn('max wait exceeded, finishing', { fullLen: last.length, elapsedMs: Date.now() - startedAt });
      yield { type: 'done', full: last };
      return;
    }
  }
}
