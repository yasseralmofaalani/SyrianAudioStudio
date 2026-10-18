import { $, formatBytes } from './utils.js';

export function renderDashboard(job) {
  const s = job?.stats || {
    total: 0, completed: 0, failed: 0, processing: 0, pending: 0,
    inputBytes: 0, outputBytes: 0, overallProgress: 0,
  };

  $('#statTotal').textContent = s.total;
  $('#statDone').textContent = s.completed;
  $('#statProcessing').textContent = s.processing + (s.pending || 0);
  $('#statFailed').textContent = s.failed;
  $('#statIn').textContent = formatBytes(s.inputBytes);
  $('#statOut').textContent = formatBytes(s.outputBytes);
  $('#overallPct').textContent = `${s.overallProgress || 0}%`;
  $('#overallBar').style.width = `${s.overallProgress || 0}%`;
}

export function renderActivity(job) {
  const list = $('#activityList');
  const empty = $('#activityEmpty');
  const items = job?.activity || [];
  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = items.map((a) => `
    <li>
      <span class="tag ${a.type || 'info'}"></span>
      <div>${escapeHtml(a.message || '')}</div>
      <time>${new Date(a.at).toLocaleTimeString('ar')}</time>
    </li>
  `).join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
