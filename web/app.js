// Front-end: four panes, each a scrollable CONVERSATION TRANSCRIPT. One shared
// input dispatches a question to all panes; each pane appends a new turn
// (question + streaming answer) so history is preserved on screen. The backend
// keeps each provider's multi-turn context in step (continue mode).

const grid = document.getElementById('grid');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const newConvBtn = document.getElementById('newConvBtn');
const conn = document.getElementById('conn');

// id -> { transcript, status, loginWrap, state, answerEl }
const panes = new Map();

// A pane is "busy" while pending (dispatched, not yet streaming) or streaming.
// The send button is disabled iff ANY pane is busy. Explicit per-pane state is
// idempotent, so duplicate/out-of-order SSE events can't wedge the button.
const BUSY_STATES = new Set(['pending', 'streaming']);
function anyBusy() {
  for (const p of panes.values()) if (BUSY_STATES.has(p.state)) return true;
  return false;
}

async function init() {
  const providers = await fetch('/api/providers').then((r) => r.json());
  for (const p of providers) grid.appendChild(makePane(p));
  connectSSE();
  autoGrow();
}

function makePane({ id, label }) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.innerHTML = `
    <div class="pane-head">
      <span class="label">${label}</span>
      <span class="status" data-status>idle</span>
    </div>
    <div class="pane-transcript" data-transcript></div>
    <div class="pane-login" data-login hidden>
      <button data-login-btn>该模型未登录 — 点此打开登录窗口</button>
    </div>`;
  const transcript = el.querySelector('[data-transcript]');
  const status = el.querySelector('[data-status]');
  const loginWrap = el.querySelector('[data-login]');
  el.querySelector('[data-login-btn]').addEventListener('click', () => {
    fetch(`/api/login/${id}`, { method: 'POST' });
    setStatus(id, 'logged-out');
  });
  panes.set(id, { transcript, status, loginWrap, state: 'idle', answerEl: null });
  return el;
}

function setStatus(id, status) {
  const p = panes.get(id);
  if (!p) return;
  p.state = status;
  p.status.textContent = status;
  p.status.className = 'status ' + status;
  p.loginWrap.hidden = status !== 'logged-out';
}

// Append a new turn (question + empty answer) to a pane; returns the answer node.
function startTurn(p, question) {
  const turn = document.createElement('div');
  turn.className = 'turn';
  const q = document.createElement('div');
  q.className = 'turn-q';
  q.textContent = question;
  const a = document.createElement('div');
  a.className = 'turn-a';
  turn.appendChild(q);
  turn.appendChild(a);
  p.transcript.appendChild(turn);
  p.transcript.scrollTop = p.transcript.scrollHeight;
  return a;
}

function connectSSE() {
  const es = new EventSource('/events');
  es.onopen = () => conn.classList.add('live');
  es.onerror = () => conn.classList.remove('live');
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handleEvent(ev);
  };
}

function handleEvent(ev) {
  if (ev.type === 'system') {
    if (ev.message === 'new-conversation') clearAll();
    return;
  }
  const p = panes.get(ev.pane);
  if (!p || !p.answerEl) return;

  if (ev.type === 'delta') {
    p.answerEl.textContent += ev.text;
    p.transcript.scrollTop = p.transcript.scrollHeight;
  } else if (ev.type === 'status') {
    // On done, resync to the authoritative full text. Fixes a slow provider
    // (e.g. ChatGPT) that finished but whose deltas didn't paint.
    if (ev.status === 'done' && typeof ev.full === 'string'
        && ev.full.length > p.answerEl.textContent.length) {
      p.answerEl.textContent = ev.full;
      p.transcript.scrollTop = p.transcript.scrollHeight;
    }
    if (ev.status === 'error') {
      p.answerEl.textContent = `（出错：${ev.message || '未知错误'}）`;
    }
    setStatus(ev.pane, ev.status);
    refreshSendState();
  }
}

function refreshSendState() {
  const busy = anyBusy();
  sendBtn.disabled = busy;
  sendBtn.textContent = busy ? '回答中…' : '发送';
}

function clearAll() {
  for (const p of panes.values()) { p.transcript.innerHTML = ''; p.answerEl = null; }
  for (const id of panes.keys()) setStatus(id, 'idle');
  refreshSendState();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (anyBusy()) return; // block follow-up while any pane is still answering
  const question = input.value.trim();
  if (!question) return;
  // Append a fresh turn to every pane (history preserved) and await streaming.
  for (const id of panes.keys()) {
    const p = panes.get(id);
    p.answerEl = startTurn(p, question);
    setStatus(id, 'pending');
  }
  refreshSendState();
  input.value = ''; autoGrow();
  await fetch('/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

newConvBtn.addEventListener('click', async () => {
  await fetch('/api/new-conversation', { method: 'POST' });
  clearAll();
});

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoGrow);

init();
