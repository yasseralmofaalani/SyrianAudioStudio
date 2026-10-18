import { $, $$, api, apiUrl, toast, debounce, isStaticHost } from './utils.js';
import { renderDashboard, renderActivity } from './dashboard.js';
import { initUploader, wireFileActions } from './uploader.js';
import { initConverter, renderFiles } from './converter.js';
import { createPlayer } from './player.js';
import { initTelegram } from './telegram.js';

const state = {
  jobId: null,
  job: null,
  pollTimer: null,
};

function getJobId() {
  return state.jobId;
}

function applyJob(job) {
  state.job = job;
  state.jobId = job.id;
  renderDashboard(job);
  renderActivity(job);
  renderFiles(job, { query: $('#fileSearch')?.value || '' });
}

async function refreshJob() {
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

async function boot() {
  initNav();
  initTheme();

  const splash = $('#splash');
  const app = $('#app');

  try {
    const health = await api('/api/health');
    const pill = $('#ffmpegStatus');
    if (health.ffmpeg) {
      pill.classList.add('is-ok');
      pill.querySelector('span:last-child').textContent = 'FFmpeg جاهز';
    } else {
      pill.classList.add('is-bad');
      pill.querySelector('span:last-child').textContent = 'FFmpeg غير متاح';
    }
    $('#serverInfo').textContent =
      `الخادم يعمل · حد الملف ${health.maxFileSizeMb}MB · حتى ${health.maxFilesPerJob} ملفاً/جلسة`;

    const job = await api('/api/jobs', { method: 'POST', body: {} });
    applyJob(job);
  } catch (err) {
    $('#ffmpegStatus').classList.add('is-bad');
    $('#ffmpegStatus').querySelector('span:last-child').textContent = 'الخادم غير متصل';
    if (isStaticHost()) {
      $('#serverInfo').textContent =
        'أنت على GitHub Pages (موقع ثابت). التحويل وTelegram يحتاجان تشغيل الخادم: npm start ثم افتح http://127.0.0.1:3847';
      toast('GitHub Pages يعرض الواجهة فقط — شغّل المشروع محلياً بـ npm start لاستخدام التحويل', 'error');
    } else {
      $('#serverInfo').textContent = 'تعذر الاتصال بخادم Node. تأكد أن npm start يعمل.';
      toast(err.message || 'فشل الاتصال بالخادم', 'error');
    }
  }

  const player = createPlayer({ getJobId });

  initUploader({
    getJobId,
    onUploaded: (job) => {
      applyJob(job);
      // انتقل لقسم المكتبة
      $$('.nav-item').find((b) => b.dataset.section === 'library')?.click();
    },
  });

  wireFileActions({
    getJobId,
    onChange: applyJob,
    onPlay: (id, which) => {
      player.load(id, which);
      $$('.nav-item').find((b) => b.dataset.section === 'library')?.click();
    },
    onDownload: (id) => {
      window.location.href = apiUrl(`/api/jobs/${getJobId()}/files/${id}/download`);
    },
  });

  const converter = initConverter({
    getJobId,
    onUpdate: (job) => {
      applyJob(job);
      startPolling();
      $$('.nav-item').find((b) => b.dataset.section === 'convert')?.click();
    },
  });

  initTelegram({
    getJobId,
    getSelectedIds: () => $$('.file-check:checked').map((el) => el.value),
  });

  $('#fileSearch').addEventListener('input', debounce(() => {
    renderFiles(state.job, { query: $('#fileSearch').value });
  }, 200));

  // اختصار لوحة المفاتيح
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.matches('input, textarea, select')) {
      e.preventDefault();
      $('#fileSearch')?.focus();
    }
  });

  setTimeout(() => {
    splash.classList.add('is-done');
    app.hidden = false;
  }, 900);

  // احتفظ بالمرجع لتجنب unused lint
  void converter;
}

boot();
