import { $, $$, formatDuration, toast } from './utils.js';

/**
 * مشغّل مخصص مع موجة صوتية مرسومة على Canvas
 */
export function createPlayer({ getStreamUrl }) {
  const canvasHost = $('#waveform');
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvasHost.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const audio = new Audio();
  audio.preload = 'metadata';
  let peaks = [];
  let currentFileId = null;
  let source = 'converted';

  function resize() {
    const rect = canvasHost.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    draw();
  }
  window.addEventListener('resize', resize);
  resize();

  function draw(progress = audio.currentTime / (audio.duration || 1)) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const bars = peaks.length || 64;
    const gap = 2 * (window.devicePixelRatio || 1);
    const barW = Math.max(2, w / bars - gap);
    for (let i = 0; i < bars; i++) {
      const amp = peaks[i] ?? (0.2 + 0.15 * Math.sin(i / 3));
      const bh = Math.max(4, amp * (h * 0.85));
      const x = i * (barW + gap);
      const active = i / bars <= progress;
      ctx.fillStyle = active ? '#007A3D' : 'rgba(0,122,61,0.22)';
      ctx.fillRect(x, mid - bh / 2, barW, bh);
    }
  }

  async function buildPeaks(url) {
    peaks = [];
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ac.decodeAudioData(buf.slice(0));
      const data = decoded.getChannelData(0);
      const blocks = 80;
      const blockSize = Math.floor(data.length / blocks) || 1;
      for (let i = 0; i < blocks; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) sum += Math.abs(data[i * blockSize + j] || 0);
        peaks.push(Math.min(1, (sum / blockSize) * 3.2));
      }
      ac.close?.();
    } catch {
      peaks = Array.from({ length: 64 }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i / 2.5)));
    }
    draw(0);
  }

  async function load(fileId, which = 'converted') {
    if (!fileId) return;
    currentFileId = fileId;
    source = which;
    $$('#playerSourceSeg button').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.src === which);
    });
    const url = getStreamUrl?.(fileId, which);
    if (!url) {
      toast(which === 'converted' ? 'لا يوجد ناتج محوّل بعد' : 'تعذر تحميل الأصلي', 'error');
      return;
    }
    $('#playerHint').textContent = which === 'original' ? 'تشغيل النسخة الأصلية' : 'تشغيل النسخة المحوّلة';
    try {
      audio.pause();
      audio.src = url;
      await buildPeaks(url);
      $('#playBtn').textContent = '▶';
    } catch (err) {
      toast(err.message || 'تعذر تحميل الصوت', 'error');
    }
  }

  $('#playBtn').addEventListener('click', async () => {
    if (!audio.src) return toast('اختر ملفاً أولاً', 'error');
    try {
      if (audio.paused) {
        await audio.play();
        $('#playBtn').textContent = '❚❚';
      } else {
        audio.pause();
        $('#playBtn').textContent = '▶';
      }
    } catch {
      toast('تعذر التشغيل على هذا الجهاز', 'error');
    }
  });

  audio.addEventListener('timeupdate', () => {
    $('#timeCurrent').textContent = formatDuration(audio.currentTime);
    $('#timeTotal').textContent = formatDuration(audio.duration || 0);
    const max = Number($('#seekBar').max);
    $('#seekBar').value = String(((audio.currentTime / (audio.duration || 1)) * max) || 0);
    draw(audio.currentTime / (audio.duration || 1));
  });
  audio.addEventListener('ended', () => {
    $('#playBtn').textContent = '▶';
  });

  $('#seekBar').addEventListener('input', () => {
    if (!audio.duration) return;
    const max = Number($('#seekBar').max);
    audio.currentTime = (Number($('#seekBar').value) / max) * audio.duration;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    const p = rtl ? 1 - ratio : ratio;
    audio.currentTime = Math.min(1, Math.max(0, p)) * audio.duration;
  });

  $('#volumeBar').addEventListener('input', () => {
    audio.volume = Number($('#volumeBar').value);
  });
  $('#rateSelect').addEventListener('change', () => {
    audio.playbackRate = Number($('#rateSelect').value);
  });

  $$('#playerSourceSeg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!currentFileId) return toast('اختر ملفاً أولاً', 'error');
      load(currentFileId, btn.dataset.src);
    });
  });

  return {
    load,
    get currentFileId() { return currentFileId; },
    get source() { return source; },
  };
}
