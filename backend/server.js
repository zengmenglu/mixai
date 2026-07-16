// Local server: serves the UI, exposes the SSE stream and control endpoints.
// Single-user, localhost only.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hub } from './transport.js';
import { Orchestrator } from './orchestrator.js';
import { providers, PROVIDER_IDS } from '../config/providers.js';
import { runLogin } from './login.js';
import { log } from './log.js';

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

// Submit one question -> fan out to all (or a subset of) panes.
app.post('/api/ask', (req, res) => {
  const question = (req.body && req.body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'empty question' });
  const providers = Array.isArray(req.body.providers) ? req.body.providers : null;
  const resumeUrls = req.body.resumeUrls && typeof req.body.resumeUrls === 'object' ? req.body.resumeUrls : null;
  log.info('server', 'ask', { len: question.length, providers: providers || 'all', resume: !!resumeUrls });
  res.json({ ok: true }); // fire-and-forward; results arrive over /events
  orchestrator.ask(question, providers, resumeUrls).catch((e) => hub.system(`ask error: ${e}`));
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
  log.info('server', 'login request', { id });
  res.json({ ok: true, message: `Opening ${id} login window…` });
  // Release the profile lock held by the running adapter so the login window
  // can launch a fresh browser with the same userDataDir. Otherwise Chrome
  // delegates to the existing session and the automation pipe breaks (the
  // "正在现有的浏览器会话中打开" failure).
  await orchestrator.closeProvider(id).catch(() => {});
  runLogin([id]).catch((e) => hub.system(`login error: ${e}`));
});

// Stop one provider's current answer (per-pane ❌ button). Other panes keep
// running; this pane's chain resolves so its next turn isn't blocked.
app.post('/api/stop/:id', (req, res) => {
  const id = req.params.id;
  if (!PROVIDER_IDS.includes(id)) return res.status(404).json({ error: 'unknown provider' });
  log.info('server', 'stop request', { id });
  res.json({ ok: true });
  orchestrator.stop(id).catch((e) => hub.system(`stop error: ${e}`));
});

log.info('server', 'starting', { port: PORT, providers: PROVIDER_IDS });

// ---- Startup & shutdown ----

// Launch browsers first, then start HTTP. This avoids the race where a request
// arrives before launchAll completes.
orchestrator.launchAll().then(() => {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  mixai → http://localhost:${PORT}\n`);
  });
}).catch((e) => {
  log.error('server', 'launchAll error', { error: e?.message });
  // Still start the server so the UI is available for login recovery.
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  mixai → http://localhost:${PORT} (browser launch had errors)\n`);
  });
});

// Graceful shutdown: close all browser contexts so no zombie processes linger.
async function shutdown() {
  log.info('server', 'shutting down');
  console.log('\nshutting down…');
  await orchestrator.closeAll();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
