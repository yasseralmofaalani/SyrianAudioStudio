import { $, $$, api, toast } from './utils.js';

const AUDIO_EXT = /\.(mp3|wav|ogg|opus|m4a|aac|flac|wma|aiff|aif|amr|webm)$/i;

export function initUploader({ getJobId, getEngine, mode, onUploaded }) {
  const dropzone = $('#dropzone');
  const folderInput = $('#folderInput');
  const filesInput = $('#filesInput');
  const hint = $('#folderHint');

  if (typeof folderInput.webkitdirectory === 'undefined' && !('directory' in folderInput)) {
    hint.textContent = 'متصفحك لا يدعم اختيار المجلد مباشرة — استخدم اختيار الملفات أو السحب والإفلات.';
  }

  async function uploadList(fileList) {
    const files = [...fileList].filter((f) => {
      if (AUDIO_EXT.test(f.name)) return true;
      return (f.type || '').startsWith('audio/') || f.type === 'video/webm' || f.type === 'application/ogg';
    });

    if (!files.length) {
      toast('لم يُعثر على ملفات صوتية صالحة', 'error');
      return;
    }

    toast(`جاري استيراد ${files.length} ملفاً…`);
    try {
      if (mode?.() === 'local') {
        const job = await getEngine().addFiles(files);
        toast(`تم استيراد ${files.length} ملفاً`, 'success');
        onUploaded?.(job);
        return;
      }

      const jobId = getJobId();
      if (!jobId) {
        toast('الجلسة غير جاهزة بعد', 'error');
        return;
      }
      const fd = new FormData();
      for (const f of files) fd.append('files', f, f.name);
      const data = await api(`/api/jobs/${jobId}/upload`, { method: 'POST', body: fd });
      toast(`تم استيراد ${data.added} ملفاً`, 'success');
      onUploaded?.(data.job);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  folderInput.addEventListener('change', () => {
    if (folderInput.files?.length) uploadList(folderInput.files);
    folderInput.value = '';
  });
  filesInput.addEventListener('change', () => {
    if (filesInput.files?.length) uploadList(filesInput.files);
    filesInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-drag');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const items = e.dataTransfer?.files;
    if (items?.length) uploadList(items);
  });

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      filesInput.click();
    }
  });
}

export function wireFileActions({ getJobId, getEngine, mode, onChange, onPlay, onDownload }) {
  const tbody = $('#filesTbody');
  const cards = $('#filesCards');

  async function patch(action, ids = []) {
    if (mode?.() === 'local') {
      const job = getEngine().patchFiles(action, ids);
      onChange?.(job);
      return;
    }
    const jobId = getJobId();
    const job = await api(`/api/jobs/${jobId}/files`, {
      method: 'PATCH',
      body: { action, ids },
    });
    onChange?.(job);
  }

  $('#btnSelectAll').addEventListener('click', () => patch('select-all'));
  $('#btnDeselectAll').addEventListener('click', () => patch('deselect-all'));
  $('#btnRemoveSelected').addEventListener('click', async () => {
    const ids = $$('.file-check:checked').map((el) => el.value);
    if (!ids.length) return toast('لا يوجد تحديد', 'error');
    if (!confirm('حذف الملفات المحددة من قائمة المعالجة؟')) return;
    try {
      await patch('remove', ids);
      toast('تم الحذف من القائمة', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  function onDelegated(e) {
    const t = e.target;
    if (t.classList?.contains('file-check')) {
      patch(t.checked ? 'select' : 'deselect', [t.value]).catch((err) => toast(err.message, 'error'));
      return;
    }
    const play = t.closest('[data-play]');
    if (play) {
      onPlay?.(play.getAttribute('data-play'), play.getAttribute('data-which') || 'converted');
      return;
    }
    const dl = t.closest('[data-download]');
    if (dl) onDownload?.(dl.getAttribute('data-download'));
  }

  tbody.addEventListener('click', onDelegated);
  tbody.addEventListener('change', onDelegated);
  cards.addEventListener('click', onDelegated);
  cards.addEventListener('change', onDelegated);
}
