import { $, $$, api, apiUrl, toast, debounce, isStaticHost } from './utils.js';
import { renderDashboard, renderActivity } from './dashboard.js';
import { initUploader, wireFileActions } from './uploader.js';
import { initConverter, renderFiles, collectOptions } from './converter.js';
import { createPlayer } from './player.js';
import { initTelegram } from './telegram.js';
import { bootLocalMode } from './local-engine.js';

const state = {
  jobId: null,
  job: null,
  pollTimer: null,
  engine: null,
  mode: 'server',
};

function getJobId() {
  return state.jobId;
}

function getEngine() {
  return state.engine;
}

function applyJob(job) {
  state.job = job;
  state.jobId = job.id;
  renderDashboard(job);
  renderActivity(job);
  renderFiles(job, { query: $('#fileSearch')?.value || '' });
}

function showApp() {
  const splash = $('#splash');
  const app = $('#app');
  splash?.classList.add('is-done');
  if (app) app.hidden = false;
}

async function refreshJob() {
  if (state.mode === 'local') return;
  if (!state.jobId) return;
  try {
    const job = await api(`/api/jobs/${state.jobId}`);
    applyJob(job);
    const busy = job.files?.some((f) => f.status === 'processing' || f.status === 'queued');
    if (!busy && state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  } catch (err) {
    console.warn(err);
  }
}

function startPolling() {
  if (state.mode === 'local') return;
  if (state.pollTimer) return;
  state.pollTimer = setInterval(refreshJob, 900);
}

function initNav() {
  const sidebar = $('#sidebar');
  const backdrop = $('#backdrop');

  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.section;
      $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b === btn));
      $$('[data-section-panel]').forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.sectionPanel === id);
      });
      sidebar.classList.remove('is-open');
      backdrop.hidden = true;
    });
  });

  $('#menuBtn').addEventListener('click', () => {
    const open = !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open);
    backdrop.hidden = !open;
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
  });
}

function initTheme() {
  const dark = localStorage.getItem('sas_dark') === '1';
  const reduce = localStorage.getItem('sas_reduce') === '1'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('reduce-motion', reduce);
  $('#prefDark').checked = dark;
  $('#prefReducedMotion').checked = reduce;

  $('#themeToggle').addEventListener('click', () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('sas_dark', next ? '1' : '0');
    $('#prefDark').checked = next;
  });
  $('#prefDark').addEventListener('change', () => {
    document.documentElement.classList.toggle('dark', $('#prefDark').checked);
    localStorage.setItem('sas_dark', $('#prefDark').checked ? '1' : '0');
  });
  $('#prefReducedMotion').addEventListener('change', () => {
    document.documentElement.classList.toggle('reduce-motion', $('#prefReducedMotion').checked);
    localStorage.setItem('sas_reduce', $('#prefReducedMotion').checked ? '1' : '0');
  });
}

async function startLocalMode() {
  state.mode = 'local';
  state.engine = await bootLocalMode();
  state.engine.subscribe(applyJob);
  applyJob(state.engine.getJob());
  $('#serverInfo').textContent =
    'وضع GitHub / المتصفح: الاستيراد والتحويل والتنزيل داخل المتصفح. Telegram يحتاج npm start.';
  document.body.dataset.mode = 'local';
  const pill = $('#ffmpegStatus');
  pill?.classList.remove('is-bad');
  const text = pill?.querySelector('span:last-child');
  if (text && /فحص|…|.../.test(text.textContent)) {
    text.textContent = 'جاري تجهيز FFmpeg في الخلفية…';
  }
}

async function startServerMode(health) {
  state.mode = 'server';
  const pill = $('#ffmpegStatus');
  if (health.ffmpeg) {
    pill.classList.add('is-ok');
    pill.querySelector('span:last-child').textContent = 'FFmpeg جاهز (خادم)';
  } else {
    pill.classList.add('is-bad');
    pill.querySelector('span:last-child').textContent = 'FFmpeg غير متاح';
  }
  $('#serverInfo').textContent =
    `وضع الخادم · حد الملف ${health.maxFileSizeMb}MB · حتى ${health.maxFilesPerJob} ملفاً/جلسة`;
  const job = await api('/api/jobs', { method: 'POST', body: {} });
  applyJob(job);
}

async function boot() {
  initNav();
  initTheme();
  initCloudApiSettings();

  // أظهر الواجهة فوراً — لا تنتظر FFmpeg أو الشبكة
  showApp();
  const splashTimer = setTimeout(showApp, 300);

  let serverOk = false;
  try {
    // جرّب الخادم أولاً (محلي أو سحابي عبر config / ?api= / localStorage)
    const health = await api('/api/health', { timeoutMs: isStaticHost() ? 8000 : 2500 });
    await startServerMode(health);
    serverOk = true;
  } catch {
    // على GitHub Pages بدون خادم سحابي: وضع المتصفح
    await startLocalMode();
  }
  showApp();

  const player = createPlayer({
    getStreamUrl: (fileId, which) => {
      if (state.mode === 'local') return state.engine.getStreamUrl(fileId, which);
      return apiUrl(`/api/jobs/${getJobId()}/files/${fileId}/stream?which=${which}&t=${Date.now()}`);
    },
  });

  initUploader({
    getJobId,
    getEngine,
    mode: () => state.mode,
    onUploaded: (job) => {
      applyJob(job);
      $$('.nav-item').find((b) => b.dataset.section === 'library')?.click();
    },
  });

  wireFileActions({
    getJobId,
    getEngine,
    mode: () => state.mode,
    onChange: applyJob,
    onPlay: (id, which) => {
      player.load(id, which);
      $$('.nav-item').find((b) => b.dataset.section === 'library')?.click();
    },
    onDownload: (id) => {
      if (state.mode === 'local') {
        try { state.engine.downloadFile(id); }
        catch (err) { toast(err.message, 'error'); }
        return;
      }
      window.location.href = apiUrl(`/api/jobs/${getJobId()}/files/${id}/download`);
    },
  });

  initConverter({
    getJobId,
    getEngine,
    mode: () => state.mode,
    onUpdate: (job) => {
      applyJob(job);
      startPolling();
      $$('.nav-item').find((b) => b.dataset.section === 'convert')?.click();
    },
  });

  initTelegram({
    getJobId,
    getSelectedIds: () => $$('.file-check:checked').map((el) => el.value),
    mode: () => state.mode,
  });

  if (!serverOk) {
    ['formatSelect', 'bitrateSelect', 'concurrencyInput', 'sampleRateSelect',
      'enhLoudnorm', 'enhDenoise', 'enhSpeech', 'enhMono', 'enhTrim'].forEach((id) => {
      $(`#${id}`)?.addEventListener('change', () => {
        state.engine?.setOptions(collectOptions());
      });
    });
  }

  $('#fileSearch').addEventListener('input', debounce(() => {
    renderFiles(state.job, { query: $('#fileSearch').value });
  }, 200));

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      $('#fileSearch')?.focus();
    }
  });

  clearTimeout(splashTimer);
  showApp();
}

function initCloudApiSettings() {
  const input = $('#cloudApiInput');
  const saveBtn = $('#btnSaveCloudApi');
  const clearBtn = $('#btnClearCloudApi');
  if (!input || !saveBtn) return;

  try {
    input.value = localStorage.getItem('sas_api') || '';
  } catch { /* ignore */ }

  saveBtn.addEventListener('click', () => {
    const v = input.value.trim().replace(/\/$/, '');
    if (v && !/^https?:\/\//i.test(v)) {
      toast('الرابط يجب أن يبدأ بـ https://', 'error');
      return;
    }
    try {
      if (v) localStorage.setItem('sas_api', v);
      else localStorage.removeItem('sas_api');
    } catch { /* ignore */ }
    toast('تم حفظ رابط الخادم — سيتم إعادة التحميل', 'success');
    setTimeout(() => location.reload(), 600);
  });

  clearBtn?.addEventListener('click', () => {
    try { localStorage.removeItem('sas_api'); } catch { /* ignore */ }
    input.value = '';
    toast('تم مسح رابط الخادم — سيتم إعادة التحميل', 'success');
    setTimeout(() => location.reload(), 600);
  });
}

boot().catch((err) => {
  console.error(err);
  showApp();
  toast(err.message || 'تعذر تشغيل التطبيق', 'error');
});
