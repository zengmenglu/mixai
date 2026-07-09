// SSE transport hub. One process-wide event bus; the UI subscribes via
// GET /events and receives per-pane delta/status events as they happen.
// Decoupled from orchestration so a client disconnect can never crash a turn.

import { EventEmitter } from 'node:events';

class Hub {
  constructor() {
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(0);
  }

  /** Attach an SSE response. Returns a detach function. */
  subscribe(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    const onEvent = (payload) => {
      // If the socket is gone, writes throw — swallow and detach.
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        detach();
      }
    };
    const onPing = () => {
      try {
        res.write(':ping\n\n');
      } catch {
        detach();
      }
    };

    this.bus.on('event', onEvent);
    const ping = setInterval(onPing, 15000);

    const detach = () => {
      clearInterval(ping);
      this.bus.off('event', onEvent);
    };
    return detach;
  }

  /** Publish an event to all subscribers. */
  emit(payload) {
    this.bus.emit('event', payload);
  }

  // Convenience emitters keyed by pane (provider id).
  delta(pane, text) {
    this.emit({ type: 'delta', pane, text });
  }
  status(pane, status, extra = {}) {
    this.emit({ type: 'status', pane, status, ...extra });
  }
  system(message) {
    this.emit({ type: 'system', message });
  }
}

export const hub = new Hub();
