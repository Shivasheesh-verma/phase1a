const TARGETS = {
  cal: 2000,
  protein: 145,
  carb: 140,
  fat: 65,
  fibre: 40,
};

const state = {
  date: todayDate(),
  day: null,
  editingEntryId: null,
  deleteConfirmEntryId: null,
};

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();

  if (document.body.dataset.view === 'history') {
    initHistoryView();
    return;
  }

  initTodayView();
});

function todayDate() {
  return new Date().toLocaleDateString('en-CA');
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
}

async function initTodayView() {
  document.getElementById('todayLabel').textContent = formatDateLabel(state.date);
  document.getElementById('logForm').addEventListener('submit', handleLogSubmit);
  document.getElementById('closeDayButton').addEventListener('click', handleCloseDay);
  document.getElementById('entryList').addEventListener('click', handleEntryListClick);
  document.getElementById('entryList').addEventListener('submit', handleEntryListSubmit);
  await refreshToday();
}

async function refreshToday() {
  const response = await fetch(`/day/${state.date}`);
  state.day = await response.json();
  renderTotals(state.day.running_totals || {});
  renderEntries(state.day.entries || []);
}

async function handleLogSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('logInput');
  const rawText = input.value.trim();
  if (!rawText) return;

  setStatus('Logging...');
  try {
    const response = await fetch('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: state.date, raw_text: rawText }),
    });
    const result = await response.json();
    input.value = '';

    if (result.queued) {
      setStatus('Queued offline. It will sync when the connection returns.');
      return;
    }

    setStatus(result.unresolved?.length ? 'Logged with unresolved items.' : 'Logged.');
    state.day = {
      date: state.date,
      entries: [result.entry, ...(state.day?.entries || [])],
      running_totals: result.running_totals,
    };
    state.editingEntryId = null;
    state.deleteConfirmEntryId = null;
    renderTotals(result.running_totals || {});
    renderEntries(state.day.entries || []);
  } catch (error) {
    setStatus('Could not log this entry.');
  }
}

async function handleCloseDay() {
  setStatus('Closing day...');
  const response = await fetch('/close-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: state.date }),
  });
  const result = await response.json();
  if (!response.ok) {
    setStatus('Close day failed.');
    return;
  }
  setStatus('Day closed.');
  renderSummary(result.summary);
}

function renderTotals(totals) {
  const grid = document.getElementById('totalsGrid');
  const metrics = [
    ['cal', 'Calories'],
    ['protein', 'Protein'],
    ['carb', 'Carbs'],
    ['fat', 'Fat'],
    ['fibre', 'Fibre'],
  ];
  grid.innerHTML = metrics.map(([key, label]) => {
    const value = Number(totals[key] || 0);
    const target = TARGETS[key];
    const pct = Math.min(100, Math.round((value / target) * 100));
    const color = metricColor(key, value, target);
    return `
      <article class="metric">
        <div class="metric-top">
          <span class="metric-name">${label}</span>
          <span class="metric-value">${formatMacro(value)} / ${target}</span>
        </div>
        <div class="bar" aria-hidden="true">
          <div class="bar-fill" style="--pct:${pct}%; --bar-color:${color}"></div>
        </div>
      </article>
    `;
  }).join('');
}

function metricColor(key, value, target) {
  if (key === 'cal' && value > target) return 'var(--red)';
  if ((key === 'protein' || key === 'fibre') && value < target * 0.65) return 'var(--amber)';
  return 'var(--green)';
}

function renderEntries(entries) {
  const list = document.getElementById('entryList');
  document.getElementById('entryCount').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No entries yet.</div>';
    return;
  }

  const newestFirst = [...entries].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  list.innerHTML = newestFirst.map((entry) => {
    const time = entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const resolved = Array.isArray(entry.resolved) ? entry.resolved : [];
    const entryTotals = {
      cal: entry.cal ?? entry.totals?.cal,
      protein: entry.protein ?? entry.totals?.protein,
      carb: entry.carb ?? entry.totals?.carb,
      fat: entry.fat ?? entry.totals?.fat,
      fibre: entry.fibre ?? entry.totals?.fibre,
    };
    const isEditing = state.editingEntryId === entry.id;
    const isDeleteConfirming = state.deleteConfirmEntryId === entry.id;

    if (isEditing) {
      return `
        <article class="entry-card" data-entry-id="${entry.id}">
          <form class="entry-edit-form" data-entry-id="${entry.id}">
            <input class="entry-edit-input" name="raw_text" type="text" value="${escapeAttribute(entry.raw_text || '')}" required>
            <div class="entry-actions">
              <button class="entry-button save" type="submit">Save</button>
              <button class="entry-button" type="button" data-action="cancel-edit" data-entry-id="${entry.id}">Cancel</button>
            </div>
          </form>
        </article>
      `;
    }

    return `
      <article class="entry-card" data-entry-id="${entry.id}">
        <div class="entry-head">
          <div>
            <span class="entry-title">${escapeHtml(entry.raw_text || 'Entry')}</span>
            <time>${time}</time>
          </div>
          <div class="entry-actions">
            <button class="entry-button" type="button" data-action="edit" data-entry-id="${entry.id}">Edit</button>
            <button class="entry-button danger" type="button" data-action="delete" data-entry-id="${entry.id}">Delete</button>
          </div>
        </div>
        <ul class="item-list">
          ${resolved.map((item) => `<li>${escapeHtml(item.name)} - ${formatMacro(item.cal)} cal, ${formatMacro(item.protein)} P</li>`).join('')}
        </ul>
        <div class="macro-line">${formatMacro(entryTotals.cal)} cal | ${formatMacro(entryTotals.protein)} P | ${formatMacro(entryTotals.carb)} C | ${formatMacro(entryTotals.fat)} F | ${formatMacro(entryTotals.fibre)} fibre</div>
        ${isDeleteConfirming ? `
          <div class="delete-confirm">
            <span>sure?</span>
            <button class="entry-button danger" type="button" data-action="confirm-delete" data-entry-id="${entry.id}">Delete</button>
            <button class="entry-button" type="button" data-action="cancel-delete" data-entry-id="${entry.id}">Cancel</button>
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

function handleEntryListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const entryId = Number(button.dataset.entryId);
  if (!Number.isInteger(entryId)) return;

  if (action === 'edit') {
    state.editingEntryId = entryId;
    state.deleteConfirmEntryId = null;
    renderEntries(state.day?.entries || []);
    return;
  }

  if (action === 'cancel-edit') {
    state.editingEntryId = null;
    renderEntries(state.day?.entries || []);
    return;
  }

  if (action === 'delete') {
    state.deleteConfirmEntryId = state.deleteConfirmEntryId === entryId ? null : entryId;
    state.editingEntryId = null;
    renderEntries(state.day?.entries || []);
    return;
  }

  if (action === 'cancel-delete') {
    state.deleteConfirmEntryId = null;
    renderEntries(state.day?.entries || []);
    return;
  }

  if (action === 'confirm-delete') {
    handleDeleteEntry(entryId);
  }
}

async function handleEntryListSubmit(event) {
  const form = event.target.closest('.entry-edit-form');
  if (!form) return;

  event.preventDefault();
  const entryId = Number(form.dataset.entryId);
  const rawText = new FormData(form).get('raw_text')?.toString().trim() || '';
  if (!Number.isInteger(entryId) || !rawText) return;

  await handleSaveEntryEdit(entryId, rawText);
}

async function handleDeleteEntry(entryId) {
  setStatus('Deleting...');
  try {
    const response = await fetch(`/entry/${entryId}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) {
      setStatus('Could not delete this entry.');
      return;
    }

    state.day = {
      ...(state.day || { date: state.date, entries: [] }),
      entries: (state.day?.entries || []).filter((entry) => entry.id !== entryId),
      running_totals: result.running_totals,
    };
    state.deleteConfirmEntryId = null;
    renderTotals(result.running_totals || {});
    renderEntries(state.day.entries || []);
    setStatus('Entry deleted.');
  } catch {
    setStatus('Could not delete this entry.');
  }
}

async function handleSaveEntryEdit(entryId, rawText) {
  setStatus('Saving edit...');
  try {
    const response = await fetch(`/entry/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: rawText }),
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus('Could not save this edit.');
      return;
    }

    state.day = {
      ...(state.day || { date: state.date, entries: [] }),
      entries: (state.day?.entries || []).map((entry) => entry.id === entryId ? result.entry : entry),
      running_totals: result.running_totals,
    };
    state.editingEntryId = null;
    state.deleteConfirmEntryId = null;
    renderTotals(result.running_totals || {});
    renderEntries(state.day.entries || []);
    setStatus(result.unresolved?.length ? 'Saved with unresolved items.' : 'Entry updated.');
  } catch {
    setStatus('Could not save this edit.');
  }
}

function renderSummary(summary) {
  const card = document.getElementById('summaryCard');
  if (!summary) return;

  card.classList.remove('hidden');
  card.innerHTML = `
    <h2>Summary</h2>
    <div class="score-row">
      <span class="pill">Adherence ${summary.adherence_score ?? '-'}/10</span>
      <span class="pill">Quality ${summary.quality_score ?? '-'}/10</span>
    </div>
    <p class="macro-line">${escapeHtml(summary.analysis_md || '')}</p>
    <ul class="suggestions">
      ${(summary.suggestions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}

async function initHistoryView() {
  const list = document.getElementById('historyList');
  try {
    const response = await fetch('/days');
    const data = await response.json();
    const days = data.days || [];

    if (days.length === 0) {
      list.innerHTML = '<div class="empty-state">No closed days yet.</div>';
      return;
    }

    list.innerHTML = days.map(renderHistoryDay).join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load history.</div>';
  }
}

function renderHistoryDay(day) {
  const pct = Math.min(100, Math.round((Number(day.cal || 0) / TARGETS.cal) * 100));
  return `
    <details class="history-card">
      <summary>
        <div class="history-head">
          <span class="history-date">${escapeHtml(day.date)}</span>
          <span>${formatMacro(day.cal)} cal</span>
        </div>
        <div class="history-metrics">
          <span class="pill">${formatMacro(day.protein)} P</span>
          <span class="pill">A ${day.adherence_score ?? '-'}/10</span>
          <span class="pill">Q ${day.quality_score ?? '-'}/10</span>
        </div>
        <svg class="cal-chart" viewBox="0 0 100 10" preserveAspectRatio="none" aria-label="Calories versus target">
          <rect x="0" y="2" width="100" height="6" rx="3" fill="#262626"></rect>
          <rect x="0" y="2" width="${pct}" height="6" rx="3" fill="${Number(day.cal || 0) > TARGETS.cal ? '#ff5b5b' : '#35d07f'}"></rect>
          <line x1="100" y1="0" x2="100" y2="10" stroke="#6fd5ff" stroke-width="1"></line>
        </svg>
      </summary>
      <p class="macro-line">${escapeHtml(day.analysis_md || '')}</p>
      <ul class="suggestions">
        ${(day.suggestions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </details>
  `;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    window.addEventListener('online', () => {
      if (registration.active) {
        registration.active.postMessage({ type: 'REPLAY_LOGS' });
      }
    });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

function setStatus(message) {
  const status = document.getElementById('statusLine');
  if (status) status.textContent = message;
}

function formatMacro(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}
