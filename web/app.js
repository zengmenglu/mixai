// Front-end: four panes, each a scrollable CONVERSATION TRANSCRIPT. One shared
// input dispatches a question to all panes; each pane appends a new turn
// (question + streaming answer) so history is preserved on screen. The backend
// keeps each provider's multi-turn context in step (continue mode).

const grid = document.getElementById('grid');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const newSessBtn = document.getElementById('newSessBtn');
const conn = document.getElementById('conn');
const sessionListEl = document.getElementById('sessionList');

// id -> { transcript, status, loginWrap, state, answerEl }
const panes = new Map();

// A pane is "busy" while pending (dispatched, not yet streaming) or streaming.
// The send button is disabled iff ANY pane is busy. Explicit per-pane state is
// idempotent, so duplicate/out-of-order SSE events can't wedge the button.
const BUSY_STATES = new Set(['pending', 'streaming']);
function anyBusy() {
  // Only selected panes count: a deselected pane finishing in the background
  // must not block the next question for the ones you're comparing now.
  for (const [id, p] of panes) if (isSelected(id) && BUSY_STATES.has(p.state)) return true;
  return false;
}

// ---- Answer rendering --------------------------------------------------
// Providers return their answer as native HTML (with <p>/<ul>/<strong>/<a>/
// <table> etc.), so we render it directly - this keeps each platform's native
// formatting (paragraphs, lists, bold, links, tables, numbered items). We
// sanitize (strip scripts/on*/javascript:) so AI output can't run scripts.
// Deltas carry the FULL current HTML each time (a "replace"), so the bubble
// always shows the latest complete markup - no mid-tag slicing.

/** Strip scripts/iframes/on* handlers/javascript: URLs from an HTML fragment,
 *  return a safe DocumentFragment. */
function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, iframe, object, embed, link, style, meta').forEach((el) => el.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value.toLowerCase();
      if (name.startsWith('on') || val.includes('javascript:') || name === 'style') {
        el.removeAttribute(attr.name);
      }
    });
  });
  return tpl.content;
}

/** Render the pane's accumulated answer HTML into its bubble. */
function renderAnswer(p) {
  if (!p.answerEl) return;
  p.answerEl.innerHTML = '';
  p.answerEl.appendChild(sanitizeHtml(p.rawHtml || ''));
  p.transcript.scrollTop = p.transcript.scrollHeight;
}

// ---- Sessions (history) --------------------------------------------------
// Sessions live in localStorage: {id, title, createdAt, chatUrls, turns}.
// chatUrls[providerId] is captured from the done event so a later "resume"
// navigates the provider back to that exact conversation (true context recall).
// Capped to MAX_SESSIONS to bound localStorage growth.

const SESSIONS_KEY = 'mixai.sessions';
const MAX_SESSIONS = 50;
let sessions = [];          // newest first
let currentSession = null;  // the session being viewed/continued (null = fresh)

/** Load saved sessions from localStorage. */
function loadSessions() {
  try { sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
  catch { sessions = []; }
}

/** Persist sessions (capped) and refresh the sidebar. */
function saveSessions() {
  sessions = sessions.slice(0, MAX_SESSIONS);
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch { /* quota */ }
  renderSessionList();
}

/** Format a timestamp as MM-DD HH:MM. */
function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Render the sidebar list of past sessions. */
function renderSessionList() {
  if (!sessions.length) {
    sessionListEl.innerHTML = '<div class="session-empty">暂无历史会话</div>';
    return;
  }
  sessionListEl.innerHTML = '';
  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'session-item' + (currentSession && currentSession.id === s.id ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'sess-title';
    title.textContent = s.title || '(未命名)';
    title.title = `${s.title || ''}  ·  ${fmtTime(s.createdAt)}`;
    const del = document.createElement('button');
    del.className = 'sess-del';
    del.textContent = '×';
    del.title = '删除该会话';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });
    item.append(title, del);
    item.addEventListener('click', () => loadSession(s.id));
    sessionListEl.appendChild(item);
  }
}

/** Start a fresh session: clear the panes and deselect the current one. */
function newSession() {
  currentSession = null;
  clearAll();
  renderSessionList();
}

/** Create a new session record for a question; returns it. */
function createSession(question) {
  const s = {
    id: 'sess-' + Date.now(),
    title: question.slice(0, 30),
    createdAt: Date.now(),
    chatUrls: {},
    turns: [],
  };
  sessions.unshift(s);
  currentSession = s;
  saveSessions();
  return s;
}

/** Load a past session into the panes and mark it current so the next question
 *  resumes it (the backend navigates back to its chatUrls). */
function loadSession(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  currentSession = s;
  clearAll();
  for (const turn of s.turns) {
    for (const pid of panes.keys()) {
      const p = panes.get(pid);
      p.answerEl = startTurn(p, turn.question);
      p.rawHtml = (turn.answers && turn.answers[pid]) || '';
      renderAnswer(p);
    }
  }
  // After replaying turns, show the regenerate icon on each pane's last turn.
  for (const p of panes.values()) refreshTools(p);
  renderSessionList();
}

/** Delete a session (and clear the view if it was current). */
function deleteSession(id) {
  sessions = sessions.filter((s) => s.id !== id);
  if (currentSession && currentSession.id === id) { currentSession = null; clearAll(); }
  saveSessions();
}

/** Persist a pane's final answer text into the current session's latest turn. */
function persistAnswer(paneId, text) {
  if (!currentSession || !currentSession.turns.length) return;
  const turn = currentSession.turns[currentSession.turns.length - 1];
  if (!turn.answers) turn.answers = {};
  turn.answers[paneId] = text;
  saveSessions();
}

/** Record a provider's conversation URL so a future resume can return to it. */
function persistChatUrl(paneId, url) {
  if (!currentSession || !url) return;
  currentSession.chatUrls[paneId] = url;
  saveSessions();
}

async function init() {
  const providers = await fetch('/api/providers').then((r) => r.json());
  for (const p of providers) grid.appendChild(makePane(p));
  buildFilter(providers);
  loadSessions();
  renderSessionList();
  connectSSE();
  autoGrow();
}

function makePane({ id, label }) {
  const el = document.createElement('section');
  el.className = 'pane';
  el.dataset.id = id;
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
  // toolsEl/stopBtn/regenBtn point at the ACTIVE (last) turn's toolbar; built
  // in startTurn. lastQuestion lets "重新回答" re-ask that turn's question.
  panes.set(id, { el, transcript, status, loginWrap, state: 'idle', answerEl: null, rawHtml: '', lastQuestion: '', toolsEl: null, stopBtn: null, regenBtn: null });
  return el;
}

// ---- Provider selection: which panes are shown & driven ------------------
// Checkboxes in the topbar; persisted to localStorage. Unchecked panes are
// hidden and excluded from the ask fan-out, so you compare only what you pick.

const STORAGE_KEY = 'mixai.selectedProviders';
const filterEl = document.getElementById('providerFilter');

/** Load saved selection; default to all providers when none stored. */
function loadSelection(allIds) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const valid = saved.filter((id) => allIds.includes(id));
    return valid.length ? valid : allIds.slice();
  } catch {
    return allIds.slice();
  }
}

/** Build one checkbox per provider and wire change -> re-apply + persist. */
function buildFilter(providers) {
  const allIds = providers.map((p) => p.id);
  const selected = loadSelection(allIds);
  filterEl.innerHTML = '';
  for (const p of providers) {
    const lbl = document.createElement('label');
    lbl.className = 'pfilter';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = p.id;
    cb.checked = selected.includes(p.id);
    cb.addEventListener('change', () => {
      applySelection();
      saveSelection();
      refreshSendState();
    });
    lbl.appendChild(cb);
    lbl.append(p.label);
    filterEl.appendChild(lbl);
  }
  applySelection();
}

/** Currently checked provider ids (order = provider order). */
function getSelected() {
  return [...filterEl.querySelectorAll('input:checked')].map((cb) => cb.dataset.id);
}

function isSelected(id) {
  return getSelected().includes(id);
}

/** Show/hide panes by checkbox state. Grid auto-fit reflows the visible ones. */
function applySelection() {
  const sel = new Set(getSelected());
  for (const [id, p] of panes) p.el.classList.toggle('hidden', !sel.has(id));
}

function saveSelection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSelected()));
}

function setStatus(id, status) {
  const p = panes.get(id);
  if (!p) return;
  p.state = status;
  p.status.textContent = status;
  p.status.className = 'status ' + status;
  p.loginWrap.hidden = status !== 'logged-out';
  refreshTools(p);
}

/** Toggle the active turn's stop/regenerate icons by pane state. The stop icon
 *  shows while streaming; the regenerate icon shows once the answer is done or
 *  stopped. Both are per-pane and independent of other panes. */
function refreshTools(p) {
  if (!p.toolsEl) return;
  const busy = BUSY_STATES.has(p.state);
  p.stopBtn.hidden = !busy;
  p.regenBtn.hidden = busy || !p.lastQuestion;
}

/** Re-ask this pane's last question and replace its answer. Independent of
 *  other panes (reuses /api/ask with a single provider + its saved chat URL so
 *  the provider recalls the conversation). Native regenerate buttons proved too
 *  fragile to target, so we re-send the same question and swap the displayed
 *  answer. */
function regenerate(id) {
  const p = panes.get(id);
  if (!p || !p.answerEl || !p.lastQuestion) return;
  if (BUSY_STATES.has(p.state)) { showToast('该模型正在回答中，请先停止'); return; }
  // Clear the current answer and re-stream into the same turn (replace).
  p.rawHtml = '';
  renderAnswer(p);
  setStatus(id, 'streaming');
  refreshSendState();
  const resumeUrls = {};
  if (currentSession && currentSession.chatUrls && currentSession.chatUrls[id]) {
    resumeUrls[id] = currentSession.chatUrls[id];
  }
  fetch('/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: p.lastQuestion, providers: [id], resumeUrls }),
  });
}

// Append a new turn (question + empty answer) to a pane; returns the answer node.
function startTurn(p, question) {
  // Previous turn is now historical: hide its toolbar (only the active/last
  // turn shows stop/regenerate).
  if (p.toolsEl) p.toolsEl.hidden = true;
  const turn = document.createElement('div');
  turn.className = 'turn';
  const q = document.createElement('div');
  q.className = 'turn-q';
  q.textContent = question;
  const a = document.createElement('div');
  a.className = 'turn-a';
  // Per-turn toolbar: stop (streaming) + regenerate (done/stopped). Small icons,
  // independent per model.
  const tools = document.createElement('div');
  tools.className = 'turn-tools';
  const stopBtn = document.createElement('button');
  stopBtn.className = 'tool-btn';
  stopBtn.textContent = '⏹ 停止';
  stopBtn.title = '终止该模型的回答（不影响其他模型）';
  stopBtn.hidden = true;
  stopBtn.addEventListener('click', () => {
    fetch(`/api/stop/${p.el.dataset.id}`, { method: 'POST' });
    setStatus(p.el.dataset.id, 'stopped');
    refreshSendState();
  });
  const regenBtn = document.createElement('button');
  regenBtn.className = 'tool-btn';
  regenBtn.textContent = '↻ 重新回答';
  regenBtn.title = '用同一问题重新生成该模型的回答（不影响其他模型）';
  regenBtn.hidden = true;
  regenBtn.addEventListener('click', () => regenerate(p.el.dataset.id));
  tools.append(stopBtn, regenBtn);
  turn.append(q, a, tools);
  p.transcript.appendChild(turn);
  p.transcript.scrollTop = p.transcript.scrollHeight;
  p.toolsEl = tools;
  p.stopBtn = stopBtn;
  p.regenBtn = regenBtn;
  p.lastQuestion = question;
  return a;
}

function connectSSE() {
  const es = new EventSource('/events');
  es.onopen = () => {
    conn.classList.add('live');
    hideToast();
  };
  es.onerror = () => {
    conn.classList.remove('live');
    showToast('连接断开，正在重连…');
  };
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    handleEvent(ev);
  };
}

function handleEvent(ev) {
  if (ev.type === 'system') {
    if (ev.message === 'new-conversation') {
      // Backend reset pane.started so the next ask opens fresh chats; mirror
      // that locally by clearing the current session and the view.
      currentSession = null;
      clearAll();
      renderSessionList();
    }
    return;
  }
  const p = panes.get(ev.pane);
  if (!p) return;

  if (ev.type === 'delta') {
    if (!p.answerEl || !ev.html) return;
    // Delta carries the FULL current HTML (replace semantics): each provider's
    // answer grows in place, so the latest HTML supersedes the previous.
    p.rawHtml = ev.html;
    renderAnswer(p);
  } else if (ev.type === 'status') {
    // On done, resync to the authoritative full HTML. Since deltas are
    // full-replace, the done HTML is the complete final markup; use it
    // unconditionally (it's the source of truth from the provider's DOM).
    if (ev.status === 'done' && p.answerEl && typeof ev.full === 'string') {
      p.rawHtml = ev.full;
      renderAnswer(p);
      persistAnswer(ev.pane, p.rawHtml);
      persistChatUrl(ev.pane, ev.url);
    }
    if (ev.status === 'stopped' && p.answerEl) {
      persistAnswer(ev.pane, p.rawHtml);
    }
    if (ev.status === 'error' && p.answerEl) {
      // Append the error to whatever streamed so partial work isn't lost.
      p.rawHtml = (p.rawHtml || '') + `<p><em>⚠️ 出错：${(ev.message || '未知错误').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</em></p>`;
      renderAnswer(p);
      persistAnswer(ev.pane, p.rawHtml);
    }
    // Remove empty answer bubble when a provider is not logged in, so no blank
    // bubble lingers in the transcript.
    if (ev.status === 'logged-out' && p.answerEl) {
      p.answerEl.closest('.turn')?.remove();
      p.answerEl = null;
      p.rawHtml = '';
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

// ---- Toast (connection status) ----

const toast = document.createElement('div');
toast.id = 'toast';
Object.assign(toast.style, {
  position: 'fixed', bottom: '24px', right: '24px',
  background: '#e74c3c', color: '#fff',
  padding: '8px 18px', borderRadius: '8px',
  fontSize: '13px', zIndex: '9999',
  display: 'none', transition: 'opacity 0.3s',
});
document.body.appendChild(toast);
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 4000);
}
function hideToast() {
  toast.style.display = 'none';
  clearTimeout(toastTimer);
}

function clearAll() {
  for (const p of panes.values()) {
    p.transcript.innerHTML = '';
    p.answerEl = null; p.rawHtml = ''; p.lastQuestion = '';
    p.toolsEl = null; p.stopBtn = null; p.regenBtn = null;
  }
  for (const id of panes.keys()) setStatus(id, 'idle');
  refreshSendState();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (anyBusy()) return; // block follow-up while any selected pane is still answering
  const question = input.value.trim();
  if (!question) return;
  const selected = getSelected();
  if (selected.length === 0) { showToast('请至少勾选一个模型'); return; }
  // Start a session if none is current; append this turn to it.
  if (!currentSession) createSession(question);
  currentSession.turns.push({ question, answers: {} });
  saveSessions();
  // Resume URLs: send what we have so the backend navigates back to each
  // provider's prior conversation (skipped if already on it = cheap continue).
  const resumeUrls = {};
  for (const id of selected) {
    if (currentSession.chatUrls[id]) resumeUrls[id] = currentSession.chatUrls[id];
  }
  // Append a fresh turn to every SELECTED pane (history preserved) and stream.
  for (const id of selected) {
    const p = panes.get(id);
    p.answerEl = startTurn(p, question);
    p.rawHtml = '';
    setStatus(id, 'pending');
  }
  refreshSendState();
  input.value = ''; autoGrow();
  await fetch('/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, providers: selected, resumeUrls }),
  });
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});

newSessBtn.addEventListener('click', async () => {
  if (anyBusy()) { showToast('请等待当前回答结束'); return; }
  // Resets backend pane.started (next ask = fresh chats); the SSE
  // 'new-conversation' event clears the view + currentSession.
  await fetch('/api/new-conversation', { method: 'POST' });
});

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoGrow);

init();
