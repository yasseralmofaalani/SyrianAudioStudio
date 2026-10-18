import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';

const ALLOWED_FORMATS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac']);
const BITRATES = new Set([64, 96, 128, 192, 256, 320]);
const SAMPLE_RATES = new Set([8000, 16000, 22050, 44100, 48000]);

const AUDIO_MIME_HINTS = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/opus',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'audio/webm',
  'audio/amr',
  'audio/x-ms-wma',
  'audio/aiff',
  'audio/x-aiff',
  'video/webm',
  'application/ogg',
]);

export function getFfmpegBin() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('FFmpeg غير متوفر. تأكد من تثبيت حزمة ffmpeg-static.');
  }
  return ffmpegPath;
}

export function getFfprobeBin() {
  const p = ffprobePath?.path || ffprobePath;
  if (!p || !fs.existsSync(p)) {
    throw new Error('FFprobe غير متوفر. تأكد من تثبيت حزمة ffprobe-static.');
  }
  return p;
}

function run(bin, args, { timeoutMs = 10 * 60 * 1000, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error('انتهت مهلة معالجة الصوت'));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(parseFfmpegError(stderr) || `فشل FFmpeg (رمز ${code})`));
    });
  });
}

function parseFfmpegError(stderr) {
  if (!stderr) return null;
  if (/Invalid data found/i.test(stderr)) return 'الملف تالف أو ليس ملفاً صوتياً صالحاً';
  if (/No such file/i.test(stderr)) return 'تعذر العثور على الملف المصدر';
  if (/Permission denied/i.test(stderr)) return 'رفض الوصول إلى الملف';
  if (/Unknown encoder/i.test(stderr)) return 'ترميز غير مدعوم على هذا النظام';
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-3).join(' — ').slice(0, 280);
}

export async function probeAudio(filePath) {
  const bin = getFfprobeBin();
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];
  const { stdout } = await run(bin, args, { timeoutMs: 60_000 });
  const data = JSON.parse(stdout || '{}');
  const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
  if (!audioStream && !data.format) {
    throw new Error('تعذر قراءة بيانات الملف الصوتي');
  }
  const duration = Number(data.format?.duration || audioStream?.duration || 0) || 0;
  const size = Number(data.format?.size || 0) || 0;
  const bitrate = Number(data.format?.bit_rate || audioStream?.bit_rate || 0) || 0;
  return {
    duration,
    size,
    bitrate,
    codec: audioStream?.codec_name || null,
    channels: audioStream?.channels || null,
    sampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : null,
    formatName: data.format?.format_name || null,
    hasAudio: Boolean(audioStream),
  };
}

export function isLikelyAudio({ mime, ext, probe }) {
  if (probe?.hasAudio) return true;
  if (mime && AUDIO_MIME_HINTS.has(mime.toLowerCase())) return true;
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  return [
    'mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'wma', 'aiff', 'aif', 'amr', 'webm',
  ].includes(e);
}

function codecArgs(format, bitrate) {
  const br = `${bitrate}k`;
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', br];
    case 'm4a':
    case 'aac':
      return ['-c:a', 'aac', '-b:a', br];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', br];
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', br];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '5'];
    default:
      throw new Error('صيغة إخراج غير مدعومة');
  }
}

function normalizeOptions(raw = {}) {
  const format = String(raw.format || 'mp3').toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    throw new Error('صيغة الإخراج غير مسموحة');
  }

  let bitrate = Number(raw.bitrate || 192);
  if (!BITRATES.has(bitrate)) bitrate = 192;
  if (format === 'wav' || format === 'flac') bitrate = null;

  const enhancements = raw.enhancements || {};
  const sampleRate = enhancements.sampleRate
    ? Number(enhancements.sampleRate)
    : null;
  if (sampleRate && !SAMPLE_RATES.has(sampleRate)) {
    throw new Error('معدل العينات غير مدعوم');
  }

  return {
    format,
    bitrate,
    enhancements: {
      loudnorm: Boolean(enhancements.loudnorm),
      denoise: Boolean(enhancements.denoise),
      speechClarity: Boolean(enhancements.speechClarity),
      mono: Boolean(enhancements.mono),
      sampleRate,
      trimSilence: Boolean(enhancements.trimSilence),
    },
  };
}

function buildFilterChain(enh) {
  const filters = [];
  if (enh.trimSilence) {
    filters.push('silenceremove=start_periods=1:start_silence=0.3:start_threshold=-50dB:stop_periods=1:stop_silence=0.4:stop_threshold=-50dB');
  }
  if (enh.denoise) {
    filters.push('highpass=f=80', 'afftdn=nf=-25');
  }
  if (enh.speechClarity) {
    filters.push('equalizer=f=1200:t=q:w=1:g=3', 'equalizer=f=3000:t=q:w=1:g=2');
  }
  if (enh.loudnorm) {
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }
  return filters.length ? filters.join(',') : null;
}

/**
 * تحويل ملف صوتي بأوامر FFmpeg آمنة (مصفوفة args بدون shell)
 */
export async function convertAudio({
  inputPath,
  outputPath,
  options = {},
  onProgress,
  signal,
}) {
  const opts = normalizeOptions(options);
  const bin = getFfmpegBin();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let duration = 0;
  try {
    const meta = await probeAudio(inputPath);
    duration = meta.duration || 0;
  } catch {
    duration = 0;
  }

  const args = ['-y', '-hide_banner', '-i', inputPath];

  if (opts.enhancements.mono) {
    args.push('-ac', '1');
  }
  if (opts.enhancements.sampleRate) {
    args.push('-ar', String(opts.enhancements.sampleRate));
  }

  const filter = buildFilterChain(opts.enhancements);
  if (filter) args.push('-af', filter);

  args.push(...codecArgs(opts.format, opts.bitrate || 192));
  args.push('-vn', '-map_metadata', '-1', outputPath);

  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let settled = false;

    const abort = () => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(Object.assign(new Error('تم إلغاء العملية'), { code: 'CANCELLED' }));
      }
    };

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }

    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onProgress && duration > 0) {
        const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          const pct = Math.min(99, Math.round((t / duration) * 100));
          onProgress(pct);
        }
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(parseFfmpegError(stderr) || `فشل التحويل (رمز ${code})`));
      }
    });
  });

  if (!fs.existsSync(outputPath)) {
    throw new Error('اكتمل الأمر لكن ملف الإخراج غير موجود');
  }

  const outStat = fs.statSync(outputPath);
  let outMeta = null;
  try {
    outMeta = await probeAudio(outputPath);
  } catch {
    outMeta = { duration: 0, size: outStat.size };
  }

  return {
    format: opts.format,
    bitrate: opts.bitrate,
    outputSize: outStat.size,
    duration: outMeta.duration || 0,
  };
}

export async function ffmpegAvailable() {
  try {
    getFfmpegBin();
    getFfprobeBin();
    const bin = getFfmpegBin();
    await run(bin, ['-version'], { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export { ALLOWED_FORMATS, BITRATES, SAMPLE_RATES };
