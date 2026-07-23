// Generic streaming scraper + completion detector.
//
// Strategy: the primary completion signal is text-stability - the response
// container's TEXT stops growing for `stabilityWindowMs`. We read text (cheap,
// stable) to detect growth and completion, but we deliver HTML (the provider's
// rendered answer with <p>/<ul>/<strong>/<a> intact) so the UI shows native
// formatting. Each time the text grows we emit the full current HTML as a
// "replace" delta (slicing HTML mid-tag is unreliable, so the UI always swaps
// in the latest complete HTML). Adapters may provide an isStreaming(page)
// corroborating signal; when present we require BOTH "text stable" AND "not
// streaming" so a mid-generation stall is never mistaken for completion.

import { plog } from '../log.js';

const POLL_MS = 150;

/**
 * Stream the answer as HTML, using text-stability for completion.
 *
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {() => Promise<string>} opts.readText  reads current full answer text (for stability/baseline)
 * @param {() => Promise<string>} opts.readHtml  reads current full answer HTML (the payload we stream)
 * @param {() => Promise<boolean>} [opts.isStreaming]  optional "still generating" signal
 * @param {number} opts.stabilityWindowMs
 * @param {number} [opts.maxMs] hard cap to avoid hanging forever
 * @param {string} [opts.tag] provider id for log lines
 * @param {AbortSignal} [opts.signal] abort to stop streaming mid-answer
 * @param {string} [opts.baseline] text of the PREVIOUS answer still on the page
 *   (continue mode); the stream waits for new text that diverges from it so we
 *   never re-stream the old answer. Empty/omitted for a fresh chat.
 * @returns {AsyncGenerator<{type:'delta', html:string} | {type:'done', full:string}>}
 *   `full` on done is the final HTML.
 */
export async function* streamAnswer({
  page,
  readText,
  readHtml,
  isStreaming,
  stabilityWindowMs,
  maxMs = 180000,
  tag = 'scrape',
  signal,
  baseline = '',
}) {
  const log = plog(tag);
  // `lastText` tracks the text for stability/growth; `lastHtml` is the last
  // HTML we streamed (so done-time `full` is HTML, not text).
  let lastText = '';
  let lastHtml = '';
  let lastGrowAt = Date.now();
  const startedAt = Date.now();

  let sawAnyText = false;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 20;
  const ECHO_MIN_LEN = 10;
  let baselineDropped = !baseline;

  while (true) {
    // Stop button: abort returns promptly (within one poll) without yielding a
    // done event - the orchestrator emits 'stopped' from the outside.
    if (signal?.aborted) {
      log.info('aborted, stopping stream', { fullLen: lastHtml.length });
      return;
    }
    // User closed the window mid-stream: finish gracefully with the partial
    // HTML instead of throwing "Target page ... has been closed".
    if (page.isClosed()) {
      log.warn('page closed mid-stream, finishing partial', { fullLen: lastHtml.length });
      yield { type: 'done', full: lastHtml };
      return;
    }
    try {
      await page.waitForTimeout(POLL_MS);
    } catch {
      log.warn('page closed during wait, finishing partial', { fullLen: lastHtml.length });
      yield { type: 'done', full: lastHtml };
      return;
    }

    let current = '';
    try {
      current = (await readText()) || '';
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && sawAnyText) {
        log.warn('readText failing repeatedly, fast-finishing', { failures: consecutiveFailures });
        yield { type: 'done', full: lastHtml };
        return;
      }
      current = lastText; // transient DOM detach during re-render
    }

    // Transient pre-answer states (Doubao "正在搜索/找到N篇资料", Kimi "正在思考"
    // etc.) are NOT the answer. While the page shows one of these as the (short)
    // current text, never treat it as stable/done; keep the clock running.
    const isTransient = current.length <= 60
      && /正在搜索|搜索中|联网搜索|搜索\s*[一二三四五六七八九十\d]+\s*个|参考\s*[一二三四五六七八九十\d]+\s*篇|找到\s*[一二三四五六七八九十\d]+\s*篇|正在思考|思考中|正在生成|分析中/.test(current);
    if (isTransient) {
      lastGrowAt = Date.now();
      log.debug('transient state, waiting', { preview: current.slice(0, 40) });
    }

    // Continue mode: hold off while the page still shows the previous answer.
    if (!baselineDropped) {
      if (current !== baseline) {
        baselineDropped = true;
        lastText = '';
        lastHtml = '';
        lastGrowAt = Date.now();
      } else {
        lastGrowAt = Date.now();
        current = lastText; // no growth to evaluate below
      }
    }

    if (baselineDropped) {
      if (current.length > lastText.length) {
        // DOM-echo guard: a container that doubled its content would stream the
        // whole answer twice. Skip and warn (text-based check).
        const isEcho = lastText.length >= ECHO_MIN_LEN && current === lastText + lastText;
        if (isEcho) {
          log.warn('detected DOM echo, skipping duplicate', { lastLen: lastText.length });
        } else {
          lastText = current;
          lastGrowAt = Date.now();
          sawAnyText = sawAnyText || current.trim().length > 0;
          // Stream the full current HTML as a "replace" delta. Slicing HTML
          // mid-tag is unreliable, so the UI always swaps in the latest
          // complete HTML - simpler and never produces broken markup.
          const html = (await readHtml().catch(() => '')) || '';
          if (html && html !== lastHtml) {
            lastHtml = html;
            log.debug('delta (html replace)', { textLen: current.length, htmlLen: html.length });
            yield { type: 'delta', html };
          }
        }
      } else if (current !== lastText && current.length > 0) {
        // Container re-rendered/replaced (text not strictly increasing).
        if (!current.startsWith(lastText)) {
          log.debug('container re-rendered, text diverged', { lastLen: lastText.length, curLen: current.length });
          lastText = current;
          lastGrowAt = Date.now();
          const html = (await readHtml().catch(() => '')) || '';
          if (html && html !== lastHtml) { lastHtml = html; yield { type: 'delta', html }; }
        }
      }

      const stableFor = Date.now() - lastGrowAt;
      let streaming = false;
      if (isStreaming) {
        try { streaming = await isStreaming(); } catch { streaming = false; }
      }
      const stable = stableFor >= stabilityWindowMs;
      // Never finish on an empty answer: require actual text before declaring
      // done. maxMs is the only time-based cap.
      const longEnough = sawAnyText;
      if (stable && !streaming && longEnough) {
        // Final read to capture the complete HTML at done time.
        const finalHtml = (await readHtml().catch(() => lastHtml)) || lastHtml;
        lastHtml = finalHtml;
        log.info('answer stable, finishing', { fullLen: finalHtml.length, textLen: lastText.length, stableFor });
        yield { type: 'done', full: finalHtml };
        return;
      }
    }

    if (Date.now() - startedAt > maxMs) {
      const finalHtml = (await readHtml().catch(() => lastHtml)) || lastHtml;
      log.warn('max wait exceeded, finishing', { fullLen: finalHtml.length, elapsedMs: Date.now() - startedAt });
      yield { type: 'done', full: finalHtml };
      return;
    }
  }
}
