/**
 * محرك محلي للمتصفح (GitHub Pages) باستخدام FFmpeg.wasm
 * يعمل بدون خادم Node.
 */

import { toast } from './utils.js';

const AUDIO_EXT = /\.(mp3|wav|ogg|opus|m4a|aac|flac|wma|aiff|aif|amr|webm)$/i;

let ffmpeg = null;
let ffmpegLoading = null;
let busy = false;
const abortFlag = { cancelled: false };

function uid() {
  return crypto.randomUUID?.() || `f_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitize(name) {
  return String(name || 'audio')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 180) || 'audio';
}

function computeStats(job) {
  const files = job.files;
  const completed = files.filter((f) => f.status === 'done').length;
  const failed = files.filter((f) => f.status === 'failed').length;
  const processing = files.filter((f) => f.status === 'processing').length;
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued').length;
  const inputBytes = files.reduce((s, f) => s + (f.size || 0), 0);
  const outputBytes = files.reduce((s, f) => s + (f.outputSize || 0), 0);
  const total = files.length || 1;
  const overallProgress = Math.round(
    files.reduce((s, f) => s + (f.status === 'done' ? 100 : f.progress || 0), 0) / total,
  );
  return {
    total: files.length,
    completed,
    failed,
    processing,
    pending,
    inputBytes,
    outputBytes,
    overallProgress,
  };
}

function pushActivity(job, entry) {
  job.activity.unshift({
    id: uid(),
    at: new Date().toISOString(),
    ...entry,
  });
  if (job.activity.length > 200) job.activity.length = 200;
}

function publicJob(job) {
  return {
    ...job,
    stats: computeStats(job),
    files: job.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      ext: f.ext,
      size: f.size,
      duration: f.duration,
      status: f.status,
      progress: f.progress,
      error: f.error,
      targetFormat: f.targetFormat || job.options.format,
      outputName: f.outputName,
      outputSize: f.outputSize,
      outputDuration: f.outputDuration,
      hasOutput: Boolean(f._outBlob),
      selected: f.selected,
    })),
  };
}

async function probeDuration(file) {
  try {
    const url = URL.createObjectURL(file);
    const duration = await new Promise((resolve) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => {
        resolve(Number.isFinite(a.duration) ? a.duration : null);
        URL.revokeObjectURL(url);
      };
      a.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(url);
      };
      a.src = url;
    });
    return duration;
  } catch {
    return null;
  }
}

async function loadFfmpeg(onStatus) {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    onStatus?.('تحميل محرك FFmpeg في المتصفح…');
    const loadWithTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`انتهت مهلة ${label}`)), ms);
      }),
    ]);

    // ملفات محلية من نفس أصل GitHub Pages (Worker من CDN يفشل بسبب CORS)
    const vendorBase = new URL('../vendor/ffmpeg/', import.meta.url).href;
    const [{ FFmpeg }, { toBlobURL }] = await loadWithTimeout(Promise.all([
      import(`${vendorBase}index.js`),
      import(new URL('../vendor/ffmpeg-util/index.js', import.meta.url).href),
    ]), 45000, 'استيراد مكتبات FFmpeg');

    const instance = new FFmpeg();
    instance.on('log', () => {});

    const sources = [
      // أولاً: الملفات المحلية (موثوقة على GitHub Pages)
      { label: 'محلي', base: vendorBase, local: true },
      // احتياطي من CDN عبر Blob URL
      { label: 'jsDelivr', base: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/', local: false },
    ];

    let lastErr = null;
    for (const src of sources) {
      try {
        onStatus?.(`تحميل نواة FFmpeg (${src.label})…`);
        let coreURL;
        let wasmURL;
        if (src.local) {
          coreURL = `${src.base}ffmpeg-core.js`;
          wasmURL = `${src.base}ffmpeg-core.wasm`;
        } else {
          coreURL = await toBlobURL(`${src.base}ffmpeg-core.js`, 'text/javascript');
          wasmURL = await toBlobURL(`${src.base}ffmpeg-core.wasm`, 'application/wasm');
        }
        await loadWithTimeout(instance.load({ coreURL, wasmURL }), 120000, 'تحميل WASM');
        ffmpeg = instance;
        onStatus?.('FFmpeg جاهز في المتصفح');
        return instance;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('تعذر تحميل نواة FFmpeg');
  })();

  try {
    return await ffmpegLoading;
  } catch (err) {
    ffmpegLoading = null;
    throw new Error(`تعذر تحميل FFmpeg في المتصفح: ${err.message || err}`);
  }
}

function buildArgs(options, inName, outName) {
  const args = ['-i', inName];
  const enh = options.enhancements || {};
  if (enh.mono) args.push('-ac', '1');
  if (enh.sampleRate) args.push('-ar', String(enh.sampleRate));

  const filters = [];
  if (enh.trimSilence) {
    filters.push('silenceremove=start_periods=1:start_silence=0.3:start_threshold=-50dB:stop_periods=1:stop_silence=0.4:stop_threshold=-50dB');
  }
  if (enh.denoise) filters.push('highpass=f=80', 'afftdn=nf=-25');
  if (enh.speechClarity) {
    filters.push('equalizer=f=1200:t=q:w=1:g=3', 'equalizer=f=3000:t=q:w=1:g=2');
  }
  if (enh.loudnorm) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (filters.length) args.push('-af', filters.join(','));

  const format = options.format || 'mp3';
  const br = `${options.bitrate || 192}k`;
  switch (format) {
    case 'mp3':
      args.push('-c:a', 'libmp3lame', '-b:a', br);
      break;
    case 'm4a':
    case 'aac':
      args.push('-c:a', 'aac', '-b:a', br);
      break;
    case 'ogg':
      args.push('-c:a', 'libvorbis', '-b:a', br);
      break;
    case 'opus':
      args.push('-c:a', 'libopus', '-b:a', br);
      break;
    case 'wav':
      args.push('-c:a', 'pcm_s16le');
      break;
    case 'flac':
      args.push('-c:a', 'flac');
      break;
    default:
      args.push('-c:a', 'libmp3lame', '-b:a', br);
  }
  args.push('-vn', outName);
  return args;
}

export function createLocalEngine() {
  const job = {
    id: 'local-browser',
    status: 'ready',
    createdAt: new Date().toISOString(),
    options: {
      format: 'mp3',
      bitrate: 192,
      enhancements: {},
      concurrency: 1,
    },
    files: [],
    activity: [],
    mode: 'local',
  };

  pushActivity(job, {
    type: 'info',
    message: 'وضع GitHub Pages: المعالجة تتم داخل المتصفح (FFmpeg.wasm)',
  });

  const listeners = new Set();
  const notify = () => {
    const pub = publicJob(job);
    listeners.forEach((fn) => fn(pub));
  };

  return {
    mode: 'local',
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getJob() {
      return publicJob(job);
    },
    async ensureFfmpeg() {
      await loadFfmpeg((msg) => {
        const pill = document.querySelector('#ffmpegStatus span:last-child');
        if (pill) pill.textContent = msg;
      });
      document.querySelector('#ffmpegStatus')?.classList.add('is-ok');
      document.querySelector('#ffmpegStatus')?.classList.remove('is-bad');
    },
    async addFiles(fileList) {
      const files = [...fileList].filter((f) =>
        AUDIO_EXT.test(f.name)
        || (f.type || '').startsWith('audio/')
        || f.type === 'video/webm'
        || f.type === 'application/ogg',
      );
      if (!files.length) throw new Error('لم يُعثر على ملفات صوتية صالحة');

      for (const file of files) {
        const id = uid();
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
        const duration = await probeDuration(file);
        const inUrl = URL.createObjectURL(file);
        job.files.push({
          id,
          originalName: sanitize(file.name),
          ext,
          size: file.size,
          duration,
          status: 'pending',
          progress: 0,
          error: null,
          selected: true,
          targetFormat: job.options.format,
          outputName: null,
          outputSize: null,
          outputDuration: null,
          _file: file,
          _inUrl: inUrl,
          _outBlob: null,
          _outUrl: null,
        });
        pushActivity(job, { type: 'success', message: `تم استيراد: ${file.name}`, fileId: id });
      }
      notify();
      return publicJob(job);
    },
    patchFiles(action, ids = []) {
      const set = new Set(ids);
      if (action === 'select-all') job.files.forEach((f) => { f.selected = true; });
      else if (action === 'deselect-all') job.files.forEach((f) => { f.selected = false; });
      else if (action === 'select') job.files.forEach((f) => { if (set.has(f.id)) f.selected = true; });
      else if (action === 'deselect') job.files.forEach((f) => { if (set.has(f.id)) f.selected = false; });
      else if (action === 'remove') {
        job.files = job.files.filter((f) => {
          if (!set.has(f.id)) return true;
          if (f._inUrl) URL.revokeObjectURL(f._inUrl);
          if (f._outUrl) URL.revokeObjectURL(f._outUrl);
          return false;
        });
      }
      notify();
      return publicJob(job);
    },
    setOptions(options) {
      job.options = { ...job.options, ...options };
      job.files.forEach((f) => { f.targetFormat = job.options.format; });
      pushActivity(job, {
        type: 'info',
        message: `إعدادات: ${(job.options.format || 'mp3').toUpperCase()}${job.options.bitrate ? ` @ ${job.options.bitrate}kbps` : ''}`,
      });
      notify();
      return publicJob(job);
    },
    async convert({ retryFailed = false } = {}) {
      if (busy) throw new Error('هناك تحويل جارٍ بالفعل');
      abortFlag.cancelled = false;
      const targets = job.files.filter((f) => {
        if (retryFailed) return f.status === 'failed';
        return f.status === 'pending' || f.status === 'cancelled' || f.status === 'failed';
      });
      if (!targets.length) throw new Error('لا توجد ملفات جاهزة للتحويل');

      busy = true;
      job.status = 'converting';
      pushActivity(job, { type: 'info', message: `بدء تحويل محلي لـ ${targets.length} ملفاً` });
      notify();

      try {
        const ff = await loadFfmpeg();
        const { fetchFile } = await import(new URL('../vendor/ffmpeg-util/index.js', import.meta.url).href);

        for (const file of targets) {
          if (abortFlag.cancelled) {
            file.status = 'cancelled';
            file.error = 'تم الإلغاء';
            notify();
            continue;
          }
          file.status = 'processing';
          file.progress = 5;
          file.error = null;
          notify();

          const ext = file.ext || 'bin';
          const inName = `in_${file.id}.${ext}`;
          const outExt = job.options.format || 'mp3';
          const outName = `out_${file.id}.${outExt}`;

          try {
            const progressHandler = ({ progress }) => {
              file.progress = Math.min(99, Math.max(5, Math.round((progress || 0) * 100)));
              notify();
            };
            ff.on('progress', progressHandler);

            await ff.writeFile(inName, await fetchFile(file._file));
            await ff.exec(buildArgs(job.options, inName, outName));
            const data = await ff.readFile(outName);
            const blob = new Blob([data.buffer], {
              type: outExt === 'mp3' ? 'audio/mpeg' : `audio/${outExt}`,
            });
            if (file._outUrl) URL.revokeObjectURL(file._outUrl);
            file._outBlob = blob;
            file._outUrl = URL.createObjectURL(blob);
            file.outputSize = blob.size;
            file.outputName = `${sanitize(file.originalName.replace(/\.[^.]+$/, ''))}.${outExt}`;
            file.outputDuration = file.duration;
            file.status = 'done';
            file.progress = 100;
            pushActivity(job, {
              type: 'success',
              message: `اكتمل: ${file.originalName} → ${file.outputName}`,
              fileId: file.id,
            });

            try { await ff.deleteFile(inName); } catch { /* ignore */ }
            try { await ff.deleteFile(outName); } catch { /* ignore */ }
            try { ff.off?.('progress', progressHandler); } catch { /* ignore */ }
          } catch (err) {
            file.status = 'failed';
            file.error = err.message || 'فشل التحويل المحلي';
            pushActivity(job, {
              type: 'error',
              message: `فشل: ${file.originalName} — ${file.error}`,
              fileId: file.id,
            });
          }
          notify();
        }
      } finally {
        busy = false;
        const anyFail = job.files.some((f) => f.status === 'failed');
        const anyDone = job.files.some((f) => f.status === 'done');
        job.status = anyFail && anyDone ? 'partial' : anyFail ? 'failed' : 'done';
        pushActivity(job, { type: anyFail ? 'warning' : 'success', message: 'انتهت دفعة التحويل المحلي' });
        notify();
      }
      return publicJob(job);
    },
    cancel() {
      abortFlag.cancelled = true;
      job.files.forEach((f) => {
        if (f.status === 'queued' || f.status === 'pending') {
          f.status = 'cancelled';
          f.error = 'تم الإلغاء';
        }
      });
      job.status = 'cancelled';
      pushActivity(job, { type: 'warning', message: 'تم طلب إلغاء العمليات' });
      notify();
      return publicJob(job);
    },
    getStreamUrl(fileId, which = 'converted') {
      const f = job.files.find((x) => x.id === fileId);
      if (!f) return null;
      if (which === 'original') return f._inUrl;
      return f._outUrl || null;
    },
    downloadFile(fileId) {
      const f = job.files.find((x) => x.id === fileId);
      if (!f?._outBlob) throw new Error('لا يوجد ملف محوّل');
      const a = document.createElement('a');
      a.href = f._outUrl;
      a.download = f.outputName || 'audio.mp3';
      a.click();
    },
    getSendableFiles({ ids = null, all = false } = {}) {
      let list = job.files.filter((f) => f.status === 'done' && f._outBlob);
      if (!all && Array.isArray(ids) && ids.length) {
        const set = new Set(ids);
        list = list.filter((f) => set.has(f.id));
      } else if (!all) {
        const selected = list.filter((f) => f.selected);
        if (selected.length) list = selected;
      }
      return list.map((f) => ({
        id: f.id,
        name: f.outputName || `${f.id}.mp3`,
        blob: f._outBlob,
      }));
    },
    async downloadZip() {
      const done = job.files.filter((f) => f._outBlob);
      if (!done.length) throw new Error('لا توجد ملفات محوّلة');
      const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
      const zip = new JSZip();
      const used = new Set();
      for (const f of done) {
        let name = f.outputName || `${f.id}.mp3`;
        if (used.has(name)) name = `${f.id.slice(0, 8)}_${name}`;
        used.add(name);
        zip.file(name, f._outBlob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'syrian-audio-studio.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  };
}

export async function bootLocalMode() {
  toast('وضع المتصفح: الواجهة تعمل من GitHub بدون خادم', 'success');
  const engine = createLocalEngine();
  // لا ننتظر FFmpeg هنا حتى لا تتجمد شاشة الافتتاح
  engine.ensureFfmpeg().catch((err) => {
    const pill = document.querySelector('#ffmpegStatus');
    pill?.classList.add('is-bad');
    const text = pill?.querySelector('span:last-child');
    if (text) text.textContent = 'تعذر تحميل FFmpeg';
    toast(err.message || 'تعذر تحميل FFmpeg في المتصفح', 'error');
  });
  return engine;
}
