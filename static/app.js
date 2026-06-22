'use strict';

const pdfInput = document.getElementById('pdf-input');
const fileBadge = document.getElementById('file-badge');
const fileNameEl = document.getElementById('file-name');
const uploadBtn = document.getElementById('upload-btn');
const docList = document.getElementById('doc-list');
const statusDot = document.getElementById('status-dot');
const statusTitle = document.getElementById('status-title');
const statusText = document.getElementById('status-text');
const msgsEl = document.getElementById('messages');
const qInput = document.getElementById('question-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const chatSub = document.getElementById('chat-sub');
const topKInput = document.getElementById('top-k-input');

let docs = [];
let busy = false;
const STORAGE_KEY = 'rag-workspace-docs';

function setStatus(title, text, state = '') {
  statusTitle.textContent = title;
  statusText.textContent = text;
  statusDot.className = `status-dot ${state}`.trim();
}

function setQ(question) {
  qInput.value = question;
  qInput.focus();
}

window.setQ = setQ;

async function readError(response) {
  try {
    const data = await response.json();
    return data.detail || 'Request failed.';
  } catch {
    return 'Request failed.';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDocs() {
  if (!docs.length) {
    docList.innerHTML = '<div class="doc-empty"><i class="ti ti-inbox"></i> No documents yet</div>';
    return;
  }

  docList.innerHTML = docs.map((doc, index) => `
    <div class="doc-item ${index === docs.length - 1 ? 'active' : ''}">
      <span class="doc-dot"></span>
      <span class="doc-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
      <span class="doc-chunks">${doc.chunks}c</span>
    </div>
  `).join('');
}

function saveDocs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

function loadDocs() {
  try {
    docs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    docs = [];
  }

  renderDocs();
  if (docs.length > 0) {
    const latest = docs[docs.length - 1];
    chatSub.textContent = `Loaded: ${latest.name}`;
    sendBtn.disabled = false;
    setStatus('Document ready', `${latest.chunks} chunks indexed`, 'ok');
  }
}

function removeEmptyState() {
  document.getElementById('empty-state')?.remove();
}

function addMessage(role, text, sources = []) {
  removeEmptyState();

  const article = document.createElement('article');
  article.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.innerHTML = role === 'ai'
    ? '<i class="ti ti-sparkles"></i>'
    : '<i class="ti ti-user"></i>';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  if (sources.length > 0) {
    const sourceWrap = document.createElement('div');
    sourceWrap.className = 'sources';

    sources.forEach((source) => {
      const chip = document.createElement('span');
      chip.className = 'source-chip';
      chip.title = source;
      chip.innerHTML = `<i class="ti ti-file-text" aria-hidden="true"></i> ${escapeHtml(source)}`;
      sourceWrap.appendChild(chip);
    });

    bubble.appendChild(sourceWrap);
  }

  article.appendChild(avatar);
  article.appendChild(bubble);
  msgsEl.appendChild(article);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function showTyping() {
  const article = document.createElement('article');
  article.className = 'msg ai';
  article.id = 'typing-indicator';
  article.innerHTML = `
    <div class="avatar ai" aria-hidden="true"><i class="ti ti-sparkles"></i></div>
    <div class="bubble typing-bubble" role="status" aria-label="Thinking">
      <span class="td"></span>
      <span class="td"></span>
      <span class="td"></span>
    </div>
  `;
  msgsEl.appendChild(article);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function hideTyping() {
  document.getElementById('typing-indicator')?.remove();
}

function buildEmptyState() {
  const loaded = docs.length > 0;
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.id = 'empty-state';
  empty.innerHTML = `
    <div class="empty-orb" aria-hidden="true">
      <div class="orb-ring r1"></div>
      <div class="orb-ring r2"></div>
      <div class="orb-core"></div>
    </div>
    <div class="empty-title">${loaded
      ? 'What do you <span class="accent-text">want to know?</span>'
      : 'Leverage <span class="accent-text">AI search,</span><br />understand your docs'
    }</div>
    <div class="empty-sub">${loaded
      ? 'Ask anything about your indexed document below.'
      : 'Upload a PDF from the sidebar and ask anything about its contents.'
    }</div>
    <div class="pill-grid">
      <button class="pill" type="button" onclick="setQ('What is the main topic of this document?')"><i class="ti ti-help-circle"></i> Main topic</button>
      <button class="pill" type="button" onclick="setQ('Summarize the key findings and conclusions')"><i class="ti ti-list-search"></i> Key findings</button>
      <button class="pill" type="button" onclick="setQ('What are the most important dates or numbers mentioned?')"><i class="ti ti-numbers"></i> Key data points</button>
      <button class="pill" type="button" onclick="setQ('What questions does this document answer?')"><i class="ti ti-bulb"></i> What it answers</button>
    </div>
  `;
  return empty;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  uploadBtn.disabled = nextBusy || !pdfInput.files[0];
  sendBtn.disabled = nextBusy || docs.length === 0;
}

pdfInput.addEventListener('change', () => {
  const file = pdfInput.files[0];
  if (!file) {
    fileBadge.style.display = 'none';
    uploadBtn.disabled = true;
    return;
  }

  fileNameEl.textContent = file.name;
  fileBadge.style.display = 'flex';
  uploadBtn.disabled = false;
});

uploadBtn.addEventListener('click', async () => {
  const file = pdfInput.files[0];
  if (!file || busy) return;

  setBusy(true);
  uploadBtn.innerHTML = '<i class="ti ti-loader-2 spin" aria-hidden="true"></i> Ingesting...';
  setStatus('Ingesting document', 'Chunking and embedding your PDF...', 'busy');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/ingest', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const data = await response.json();
    docs.push({ name: data.filename, chunks: data.ingested });
    saveDocs();
    renderDocs();

    chatSub.textContent = `Loaded: ${data.filename}`;
    setStatus('Document ready', `${data.ingested} chunks indexed`, 'ok');
    addMessage('ai', `"${data.filename}" is ready. It was split into ${data.ingested} chunks and stored in Qdrant. Ask me anything about it.`);
  } catch (error) {
    setStatus('Ingest failed', error.message, 'err');
    addMessage('ai', `Failed to ingest: ${error.message}`);
  } finally {
    uploadBtn.innerHTML = '<i class="ti ti-database-import" aria-hidden="true"></i> Ingest document';
    setBusy(false);
  }
});

async function ask() {
  const question = qInput.value.trim();
  if (!question || busy || docs.length === 0) return;

  addMessage('user', question);
  qInput.value = '';
  setBusy(true);
  showTyping();
  setStatus('Searching', 'Retrieving matching chunks...', 'busy');

  try {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        top_k: Number(topKInput.value || 5),
      }),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const data = await response.json();
    hideTyping();
    addMessage('ai', data.answer, data.sources || []);
    setStatus('Answer ready', `${data.num_contexts} context chunk(s) used`, 'ok');
  } catch (error) {
    hideTyping();
    addMessage('ai', `Query failed: ${error.message}`);
    setStatus('Query failed', error.message, 'err');
  } finally {
    setBusy(false);
    qInput.focus();
  }
}

sendBtn.addEventListener('click', ask);

qInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    ask();
  }
});

clearBtn.addEventListener('click', () => {
  msgsEl.innerHTML = '';
  msgsEl.appendChild(buildEmptyState());
});

loadDocs();
