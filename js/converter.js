import { $, api, apiUrl, toast, formatBytes, formatDuration, statusBadge, debounce } from './utils.js';

export function collectOptions() {
  const format = $('#formatSelect').value;
  const bitrate = Number($('#bitrateSelect').value);
  return {
    format,
    bitrate,
    concurrency: Number($('#concurrencyInput').value || 2),
    enhancements: {
      loudnorm: $('#enhLoudnorm').checked,
      denoise: $('#enhDenoise').checked,
      speechClarity: $('#enhSpeech').checked,
      mono: $('#enhMono').checked,
      trimSilence: $('#enhTrim').checked,
      sampleRate: $('#sampleRateSelect').value || null,
    },
  };
}

export function syncBitrateVisibility() {
  const format = $('#formatSelect').value;
  const field = $('#bitrateField');
  const hide = format === 'wav' || format === 'flac';
  field.style.display = hide ? 'none' : '';
}

export function initConverter({ getJobId, getEngine, mode, onUpdate }) {
  const saveOptions = debounce(async () => {
    try {
      if (mode?.() === 'local') {
        onUpdate?.(getEngine().setOptions(collectOptions()));
        return;
      }
      const jobId = getJobId();
      if (!jobId) return;
      const job = await api(`/api/jobs/${jobId}/options`, {
        method: 'PUT',
        body: collectOptions(),
      });
      onUpdate?.(job);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, 300);

  ['formatSelect', 'bitrateSelect', 'concurrencyInput', 'sampleRateSelect',
    'enhLoudnorm', 'enhDenoise', 'enhSpeech', 'enhMono', 'enhTrim'].forEach((id) => {
    $(`#${id}`)?.addEventListener('change', () => {
      syncBitrateVisibility();
      saveOptions();
    });
  });

  syncBitrateVisibility();

  async function start({ retryFailed = false } = {}) {
    try {
      if (mode?.() === 'local') {
        getEngine().setOptions(collectOptions());
        toast('بدء التحويل داخل المتصفح…');
        const job = await getEngine().convert({ retryFailed });
        onUpdate?.(job);
        toast('انتهى التحويل المحلي', 'success');
        return;
      }

      const jobId = getJobId();
      await api(`/api/jobs/${jobId}/options`, { method: 'PUT', body: collectOptions() });
      const data = await api(`/api/jobs/${jobId}/convert`, {
        method: 'POST',
        body: { retryFailed, onlySelected: false },
      });
      toast(`بدأ تحويل ${data.started} ملفاً`, 'success');
      onUpdate?.(data.job);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  $('#btnStartConvert').addEventListener('click', () => start({}));
  $('#startConvertTop').addEventListener('click', () => start({}));
  $('#btnRetryFailed').addEventListener('click', () => start({ retryFailed: true }));
  $('#btnCancelConvert').addEventListener('click', async () => {
    try {
      if (mode?.() === 'local') {
        onUpdate?.(getEngine().cancel());
        toast('تم إلغاء العمليات المعلقة', 'success');
        return;
      }
      const job = await api(`/api/jobs/${getJobId()}/cancel`, { method: 'POST', body: {} });
      toast('تم إلغاء العمليات المعلقة', 'success');
      onUpdate?.(job);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btnDownloadZip').addEventListener('click', async () => {
    try {
      if (mode?.() === 'local') {
        await getEngine().downloadZip();
        return;
      }
      window.location.href = apiUrl(`/api/jobs/${getJobId()}/download-zip`);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  return { start };
}

export function renderFiles(job, { query = '' } = {}) {
  const tbody = $('#filesTbody');
  const cards = $('#filesCards');
  const empty = $('#libraryEmpty');
  const processList = $('#processList');
  const processEmpty = $('#processEmpty');

  let files = job?.files || [];
  const q = query.trim().toLowerCase();
  if (q) files = files.filter((f) => f.originalName.toLowerCase().includes(q));

  if (!files.length) {
    tbody.innerHTML = '';
    cards.innerHTML = '';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    tbody.innerHTML = files.map((f) => rowHtml(f)).join('');
    cards.innerHTML = files.map((f) => cardHtml(f)).join('');
  }

  const active = (job?.files || []).filter((f) =>
    ['queued', 'processing', 'done', 'failed', 'cancelled'].includes(f.status),
  );
  if (!active.length) {
    processList.innerHTML = '';
    processEmpty.hidden = false;
  } else {
    processEmpty.hidden = true;
    processList.innerHTML = active.map((f) => `
      <div class="process-card">
        <div>
          <strong>${esc(f.originalName)}</strong>
          <div class="process-card__meta">
            ${statusBadge(f.status)} · ${f.targetFormat?.toUpperCase() || ''}
            ${f.error ? ` · ${esc(f.error)}` : ''}
            ${f.outputSize ? ` · ${formatBytes(f.outputSize)}` : ''}
          </div>
          <div class="progress" style="margin-top:.5rem"><div class="progress__bar" style="width:${f.progress || 0}%"></div></div>
        </div>
        <div class="ring" style="--p:${f.progress || 0}"><span>${f.progress || 0}%</span></div>
      </div>
    `).join('');
  }
}

function rowHtml(f) {
  return `
    <tr>
      <td><input class="file-check" type="checkbox" value="${f.id}" ${f.selected ? 'checked' : ''} /></td>
      <td title="${esc(f.originalName)}">${esc(f.originalName)}</td>
      <td>${esc(f.ext)}</td>
      <td>${formatBytes(f.size)}</td>
      <td>${formatDuration(f.duration)}</td>
      <td>${(f.targetFormat || 'mp3').toUpperCase()}</td>
      <td>${statusBadge(f.status)}</td>
      <td><span class="mini-progress"><i style="width:${f.progress || 0}%"></i></span> ${f.progress || 0}%</td>
      <td>
        <button class="btn btn--ghost btn--sm" data-play="${f.id}" data-which="original" type="button">▶ أصلي</button>
        ${f.hasOutput ? `
          <button class="btn btn--ghost btn--sm" data-play="${f.id}" data-which="converted" type="button">▶ ناتج</button>
          <button class="btn btn--secondary btn--sm" data-download="${f.id}" type="button">تنزيل</button>
        ` : ''}
      </td>
    </tr>
  `;
}

function cardHtml(f) {
  return `
    <article class="file-card">
      <label><input class="file-check" type="checkbox" value="${f.id}" ${f.selected ? 'checked' : ''} /> <strong>${esc(f.originalName)}</strong></label>
      <div class="file-card__row"><span>${esc(f.ext)} · ${formatBytes(f.size)}</span>${statusBadge(f.status)}</div>
      <div class="file-card__row"><span>${formatDuration(f.duration)}</span><span>${f.progress || 0}%</span></div>
      <div class="progress" style="margin:.5rem 0"><div class="progress__bar" style="width:${f.progress || 0}%"></div></div>
      <div class="btn-row">
        <button class="btn btn--ghost btn--sm" data-play="${f.id}" data-which="original" type="button">أصلي</button>
        ${f.hasOutput ? `
          <button class="btn btn--ghost btn--sm" data-play="${f.id}" data-which="converted" type="button">ناتج</button>
          <button class="btn btn--secondary btn--sm" data-download="${f.id}" type="button">تنزيل</button>
        ` : ''}
      </div>
    </article>
  `;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
