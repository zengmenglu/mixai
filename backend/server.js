// Local server: serves the UI, exposes the SSE stream and control endpoints.
// Single-user, localhost only.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hub } from './transport.js';
import { Orchestrator } from './orchestrator.js';
import { providers, PROVIDER_IDS } from '../config/providers.js';
import { runLogin } from './login.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', 'web');
const PORT = process.env.PORT || 5173;

const app = express();
app.use(express.json());
app.use(express.static(WEB_DIR));

const orchestrator = new Orchestrator();

// Provider metadata for the UI to render panes/labels.
app.get('/api/providers', (_req, res) => {
  res.json(PROVIDER_IDS.map((id) => ({ id, label: providers[id].label })));
});

// SSE stream: per-pane deltas + status events.
app.get('/events', (req, res) => {
  const detach = hub.subscribe(res);
  req.on('close', detach); // client disconnect — stop forwarding, never crash
});

// Submit one question -> fan out to all four panes.
app.post('/api/ask', (req, res) => {
  const question = (req.body && req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'empty question' });
  res.json({ ok: true }); // fire-and-forward; results arrive over /events
  orchestrator.ask(question).catch((e) => hub.system(`ask error: ${e}`));
});

// Start a fresh conversation in all providers.
app.post('/api/new-conversation', (_req, res) => {
  orchestrator.newConversation();
  res.json({ ok: true });
});

// Login recovery: open a headful window for one provider so the user can log in.
app.post('/api/login/:id', async (req, res) => {
  const id = req.params.id;
  if (!PROVIDER_IDS.includes(id)) return res.status(404).json({ error: 'unknown provider' });
  res.json({ ok: true, message: `Opening ${id} login window…` });
  runLogin([id]).catch((e) => hub.system(`login error: ${e}`));
});

app.listen(PORT, () => {
  console.log(`\n  mixai → http://localhost:${PORT}\n`);
});
