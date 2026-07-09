// End-to-end smoke test: fan one real question out to all four adapters
// concurrently, print streamed deltas + final status per pane. Exercises the
// real orchestrator path without the browser UI.

import { Orchestrator } from '../backend/orchestrator.js';
import { hub } from '../backend/transport.js';

const question = process.argv.slice(2).join(' ') || '用一句话介绍你自己，并说出你是哪个模型。';

const got = {}; // id -> { text, status }
hub.bus.on('event', (ev) => {
  if (ev.type === 'delta') {
    got[ev.pane] = got[ev.pane] || { text: '', status: '' };
    got[ev.pane].text += ev.text;
  } else if (ev.type === 'status') {
    got[ev.pane] = got[ev.pane] || { text: '', status: '' };
    got[ev.pane].status = ev.status;
    const len = (got[ev.pane].text || '').length;
    console.log(`[${ev.pane}] status=${ev.status} chars=${len}`);
  }
});

const orch = new Orchestrator();
console.log(`\nQ: ${question}\n`);
const t0 = Date.now();
await orch.ask(question);
console.log(`\n--- all panes settled in ${((Date.now() - t0) / 1000).toFixed(1)}s ---\n`);

for (const id of ['deepseek', 'kimi', 'doubao', 'chatgpt']) {
  const g = got[id] || { text: '', status: '(no events)' };
  const preview = (g.text || '').replace(/\s+/g, ' ').slice(0, 200);
  console.log(`\n=== ${id} [${g.status}] ===\n${preview || '(empty)'}`);
}

await orch.closeAll();
process.exit(0);
