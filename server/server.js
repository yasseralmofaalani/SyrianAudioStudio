import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import archiver from 'archiver';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fileTypeFromFile } from 'file-type';

import { TaskQueue } from './queue.js';
import {
  convertAudio,
  probeAudio,
  isLikelyAudio,
  ffmpegAvailable,
  ALLOWED_FORMATS,
  BITRATES,
} from './ffmpeg.js';
import {
  setSession,
  clearSession,
  testConnection,
  sendMany,
  resolveCredentials,
  resolveBotToken,
  resolveRecipient,
  listStartedContacts,
  safeLogMeta,
} from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({
  path: path.join(ROOT, '.env'),
  override: true,
});

const UPLOADS = path.join(ROOT, 'uploads');
const CONVERTED = path.join(ROOT, 'converted');

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(CONVERTED, { recursive: true });

const PORT = Number(process.env.PORT || 3847);
// على Render/Railway يجب الاستماع على 0.0.0.0 وليس localhost فقط
const HOST = process.env.HOST || '0.0.0.0';
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 100);
const MAX_FILES_PER_JOB = Number(process.env.MAX_FILES_PER_JOB || 200);
const API_KEY = process.env.API_KEY || '';

const queue = new TaskQueue({ concurrency: Number(process.env.CONCURRENCY || 2) });

/** @type {Map<string, any>} */
const jobs = new Map();
/** @type {Map<string, AbortController>} */
const abortControllers = new Map();

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تم تجاوز حد الطلبات. حاول لاحقاً.' },
  }),
);

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.get('x-api-key') || req.query.apiKey;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'مفتاح API غير صالح' });
  }
  next();
}

app.use('/api', requireApiKey);

function safeJoin(base, ...parts) {
  const target = path.resolve(base, ...parts);
  if (!target.startsWith(base + path.sep) && target !== base) {
    throw new Error('مسار غير آمن');
  }
  return target;
}

function sanitizeFilename(name) {
  return String(name || 'audio')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'audio';
}

function activityPush(job, entry) {
  if (!job.activity) job.activity = [];
  job.activity.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    ...entry,
  });
  if (job.activity.length > 200) job.activity.length = 200;
}

function jobPublic(job) {
  const files = job.files.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    ext: f.ext,
    size: f.size,
    duration: f.duration,
    status: f.status,
    progress: f.progress,
    error: f.error,
    targetFormat: f.targetFormat || job.options?.format || 'mp3',
    outputName: f.outputName || null,
    outputSize: f.outputSize || null,
    outputDuration: f.outputDuration || null,
    hasOutput: Boolean(f.outputRel),
  }));

  const completed = files.filter((f) => f.status === 'done').length;
  const failed = files.filter((f) => f.status === 'failed').length;
  const processing = files.filter((f) => f.status === 'processing').length;
  const pending = files.filter((f) => f.status === 'pending' || f.status === 'queued').length;
  const inputBytes = files.reduce((s, f) => s + (f.size || 0), 0);
  const outputBytes = files.reduce((s, f) => s + (f.outputSize || 0), 0);
  const total = files.length || 1;
  const overall = Math.round(
    files.reduce((s, f) => s + (f.status === 'done' ? 100 : f.progress || 0), 0) / total,
  );

  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    options: job.options,
    files,
    stats: {
      total: files.length,
      completed,
      failed,
      processing,
      pending,
      inputBytes,
      outputBytes,
      overallProgress: overall,
    },
    activity: job.activity || [],
    queue: queue.stats(),
  };
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const jobId = req.params.jobId;
    const dir = path.join(UPLOADS, jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const id = randomUUID();
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safe = sanitizeFilename(original);
    const ext = path.extname(safe);
    cb(null, `${id}${ext || '.bin'}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES_PER_JOB,
  },
});

app.get('/api/health', async (_req, res) => {
  const ffmpeg = await ffmpegAvailable();
  res.json({
    ok: true,
    name: 'Syrian Audio Studio',
    ffmpeg,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    maxFilesPerJob: MAX_FILES_PER_JOB,
    formats: [...ALLOWED_FORMATS],
    bitrates: [...BITRATES],
  });
});

app.post('/api/jobs', (req, res) => {
  const id = randomUUID();
  const job = {
    id,
    status: 'ready',
    createdAt: new Date().toISOString(),
    options: {
      format: 'mp3',
      bitrate: 192,
      enhancements: {},
      concurrency: queue.concurrency,
    },
    files: [],
    activity: [],
  };
  jobs.set(id, job);
  fs.mkdirSync(path.join(UPLOADS, id), { recursive: true });
  fs.mkdirSync(path.join(CONVERTED, id), { recursive: true });
  activityPush(job, { type: 'info', message: 'تم إنشاء جلسة عمل جديدة' });
  res.status(201).json(jobPublic(job));
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  res.json(jobPublic(job));
});

app.post('/api/jobs/:jobId/upload', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  upload.array('files', MAX_FILES_PER_JOB)(req, res, async (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `حجم الملف يتجاوز ${MAX_FILE_SIZE_MB}MB`
          : err.code === 'LIMIT_FILE_COUNT'
            ? `لا يمكن رفع أكثر من ${MAX_FILES_PER_JOB} ملفاً`
            : err.message || 'فشل الرفع';
      return res.status(400).json({ error: msg });
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'لم يتم استلام ملفات' });

    if (job.files.length + files.length > MAX_FILES_PER_JOB) {
      for (const f of files) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
      return res.status(400).json({
        error: `الحد الأقصى ${MAX_FILES_PER_JOB} ملفاً لكل جلسة`,
      });
    }

    const added = [];
    for (const f of files) {
      const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName).toLowerCase() || path.extname(f.filename).toLowerCase();
      const id = path.basename(f.filename, path.extname(f.filename));

      let mime = f.mimetype || '';
      try {
        const ft = await fileTypeFromFile(f.path);
        if (ft?.mime) mime = ft.mime;
      } catch { /* ignore */ }

      let duration = null;
      let probe = null;
      try {
        probe = await probeAudio(f.path);
        duration = probe.duration;
      } catch {
        probe = null;
      }

      const ok = isLikelyAudio({ mime, ext, probe });
      const entry = {
        id,
        originalName: sanitizeFilename(originalName),
        storedName: f.filename,
        ext: ext.replace(/^\./, '') || 'unknown',
        mime,
        size: f.size,
        duration,
        status: ok ? 'pending' : 'failed',
        progress: 0,
        error: ok ? null : 'الملف ليس صوتياً صالحاً أو غير مدعوم',
        inputRel: path.join(job.id, f.filename),
        outputRel: null,
        outputName: null,
        outputSize: null,
        outputDuration: null,
        targetFormat: job.options.format,
        selected: ok,
      };

      job.files.push(entry);
      added.push(entry);
      activityPush(job, {
        type: ok ? 'success' : 'error',
        message: ok
          ? `تم استيراد: ${entry.originalName}`
          : `رفض الملف: ${entry.originalName} — ${entry.error}`,
        fileId: id,
      });
    }

    res.json({ added: added.length, job: jobPublic(job) });
  });
});

app.patch('/api/jobs/:jobId/files', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const { action, ids } = req.body || {};
  const idSet = new Set(Array.isArray(ids) ? ids : []);

  if (action === 'select-all') {
    job.files.forEach((f) => {
      if (f.status !== 'failed' || f.hasOutput) f.selected = true;
    });
  } else if (action === 'deselect-all') {
    job.files.forEach((f) => { f.selected = false; });
  } else if (action === 'select' || action === 'deselect') {
    job.files.forEach((f) => {
      if (idSet.has(f.id)) f.selected = action === 'select';
    });
  } else if (action === 'remove') {
    const keep = [];
    for (const f of job.files) {
      if (!idSet.has(f.id)) {
        keep.push(f);
        continue;
      }
      try {
        fs.unlinkSync(safeJoin(UPLOADS, f.inputRel));
      } catch { /* ignore */ }
      if (f.outputRel) {
        try { fs.unlinkSync(safeJoin(CONVERTED, f.outputRel)); } catch { /* ignore */ }
      }
      activityPush(job, { type: 'info', message: `حُذف من القائمة: ${f.originalName}`, fileId: f.id });
    }
    job.files = keep;
  } else {
    return res.status(400).json({ error: 'إجراء غير معروف' });
  }

  res.json(jobPublic(job));
});

app.put('/api/jobs/:jobId/options', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const body = req.body || {};
  const format = String(body.format || job.options.format || 'mp3').toLowerCase();
  if (!ALLOWED_FORMATS.has(format)) {
    return res.status(400).json({ error: 'صيغة غير مدعومة' });
  }
  let bitrate = Number(body.bitrate ?? job.options.bitrate ?? 192);
  if (!BITRATES.has(bitrate)) bitrate = 192;
  if (format === 'wav' || format === 'flac') bitrate = null;

  const enh = body.enhancements || job.options.enhancements || {};
  const concurrency = Math.max(1, Math.min(8, Number(body.concurrency || job.options.concurrency || 2)));
  queue.setConcurrency(concurrency);

  job.options = {
    format,
    bitrate,
    enhancements: {
      loudnorm: Boolean(enh.loudnorm),
      denoise: Boolean(enh.denoise),
      speechClarity: Boolean(enh.speechClarity),
      mono: Boolean(enh.mono),
      sampleRate: enh.sampleRate ? Number(enh.sampleRate) : null,
      trimSilence: Boolean(enh.trimSilence),
    },
    concurrency,
  };

  job.files.forEach((f) => {
    f.targetFormat = format;
  });

  activityPush(job, {
    type: 'info',
    message: `تم تحديث إعدادات التحويل: ${format.toUpperCase()}${bitrate ? ` @ ${bitrate}kbps` : ''}`,
  });

  res.json(jobPublic(job));
});

async function processFile(job, file) {
  if (file.status === 'failed' && !file.inputRel) return;

  const inputPath = safeJoin(UPLOADS, file.inputRel);
  if (!fs.existsSync(inputPath)) {
    file.status = 'failed';
    file.error = 'الملف المصدر مفقود';
    return;
  }

  const ac = new AbortController();
  abortControllers.set(`${job.id}:${file.id}`, ac);

  file.status = 'processing';
  file.progress = 1;
  file.error = null;

  const base = path.basename(file.originalName, path.extname(file.originalName));
  const outName = `${sanitizeFilename(base)}.${job.options.format}`;
  const outRel = path.join(job.id, `${file.id}.${job.options.format}`);
  const outPath = safeJoin(CONVERTED, outRel);

  try {
    const result = await convertAudio({
      inputPath,
      outputPath: outPath,
      options: job.options,
      signal: ac.signal,
      onProgress: (p) => {
        file.progress = p;
      },
    });

    file.status = 'done';
    file.progress = 100;
    file.outputRel = outRel;
    file.outputName = outName;
    file.outputSize = result.outputSize;
    file.outputDuration = result.duration;
    activityPush(job, {
      type: 'success',
      message: `اكتمل التحويل: ${file.originalName} → ${outName}`,
      fileId: file.id,
    });
  } catch (err) {
    if (err.code === 'CANCELLED') {
      file.status = 'cancelled';
      file.error = 'تم الإلغاء';
      activityPush(job, { type: 'info', message: `أُلغي: ${file.originalName}`, fileId: file.id });
    } else {
      file.status = 'failed';
      file.error = err.message || 'فشل التحويل';
      activityPush(job, {
        type: 'error',
        message: `فشل التحويل: ${file.originalName} — ${file.error}`,
        fileId: file.id,
      });
    }
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* ignore */ }
  } finally {
    abortControllers.delete(`${job.id}:${file.id}`);
  }
}

app.post('/api/jobs/:jobId/convert', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const ffmpegOk = await ffmpegAvailable();
  if (!ffmpegOk) {
    return res.status(503).json({ error: 'FFmpeg غير متاح على الخادم' });
  }

  const onlySelected = Boolean(req.body?.onlySelected);
  const retryFailed = Boolean(req.body?.retryFailed);

  let targets = job.files.filter((f) => {
    if (retryFailed) return f.status === 'failed' && f.inputRel;
    if (onlySelected) return f.selected && (f.status === 'pending' || f.status === 'failed' || f.status === 'cancelled');
    return f.status === 'pending' || f.status === 'cancelled' || (f.status === 'failed' && f.inputRel);
  });

  // لا نعيد تحويل الملفات المكتملة إلا عند إعادة المحاولة الصريحة للفشل
  targets = targets.filter((f) => f.status !== 'done');

  if (!targets.length) {
    return res.status(400).json({ error: 'لا توجد ملفات جاهزة للتحويل' });
  }

  queue.clearCancel(job.id);
  job.status = 'converting';
  activityPush(job, {
    type: 'info',
    message: `بدء تحويل ${targets.length} ملفاً (تزامن: ${queue.concurrency})`,
  });

  res.json({ started: targets.length, job: jobPublic(job) });

  // معالجة غير متزامنة بعد الرد
  (async () => {
    const tasks = targets.map((file) => {
      file.status = 'queued';
      file.progress = 0;
      return queue.add(job.id, () => processFile(job, file));
    });

    await Promise.allSettled(tasks);

    const still = job.files.some((f) => f.status === 'processing' || f.status === 'queued');
    if (!still) {
      const anyFail = job.files.some((f) => f.status === 'failed');
      const anyDone = job.files.some((f) => f.status === 'done');
      job.status = anyFail && anyDone ? 'partial' : anyFail ? 'failed' : 'done';
      activityPush(job, {
        type: anyFail ? 'warning' : 'success',
        message: 'انتهت دفعة التحويل',
      });
    }
  })().catch((err) => {
    console.error('[convert]', err.message);
    job.status = 'failed';
  });
});

app.post('/api/jobs/:jobId/cancel', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  queue.cancel(job.id);
  for (const [key, ac] of abortControllers) {
    if (key.startsWith(`${job.id}:`)) ac.abort();
  }
  job.files.forEach((f) => {
    if (f.status === 'queued' || f.status === 'pending') {
      f.status = 'cancelled';
      f.error = 'تم الإلغاء';
    }
  });
  job.status = 'cancelled';
  activityPush(job, { type: 'warning', message: 'تم إلغاء العمليات المعلقة' });
  res.json(jobPublic(job));
});

app.get('/api/jobs/:jobId/files/:fileId/download', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  const file = job.files.find((f) => f.id === req.params.fileId);
  if (!file?.outputRel) return res.status(404).json({ error: 'لا يوجد ملف محوّل' });

  const full = safeJoin(CONVERTED, file.outputRel);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'الملف غير موجود على القرص' });

  res.download(full, file.outputName || path.basename(full));
});

app.get('/api/jobs/:jobId/files/:fileId/stream', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  const file = job.files.find((f) => f.id === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });

  const which = req.query.which === 'original' ? 'original' : 'converted';
  let full;
  let name;
  if (which === 'original') {
    full = safeJoin(UPLOADS, file.inputRel);
    name = file.originalName;
  } else {
    if (!file.outputRel) return res.status(404).json({ error: 'لا يوجد ناتج محوّل بعد' });
    full = safeJoin(CONVERTED, file.outputRel);
    name = file.outputName || file.originalName;
  }
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'الملف غير موجود' });

  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.sendFile(full);
});

app.get('/api/jobs/:jobId/download-zip', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const done = job.files.filter((f) => f.status === 'done' && f.outputRel);
  if (!done.length) return res.status(400).json({ error: 'لا توجد ملفات محوّلة للتنزيل' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="syrian-audio-studio-${job.id.slice(0, 8)}.zip"`,
  );

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[zip]', err.message);
    try { res.status(500).end(); } catch { /* ignore */ }
  });
  archive.pipe(res);

  const used = new Set();
  for (const f of done) {
    let name = f.outputName || path.basename(f.outputRel);
    if (used.has(name)) name = `${f.id.slice(0, 8)}_${name}`;
    used.add(name);
    archive.file(safeJoin(CONVERTED, f.outputRel), { name });
  }
  archive.finalize();
});

app.post('/api/telegram/session', async (req, res) => {
  try {
    const sessionId = req.body.sessionId || randomUUID();
    const { botToken, chatId = '' } = req.body;
    if (!botToken) {
      return res.status(400).json({ error: 'Bot Token مطلوب' });
    }
    const result = await testConnection({ botToken, chatId });
    setSession(sessionId, {
      botToken,
      chatId,
      botUsername: result.botUsername,
    });
    console.log('[telegram] session ok', safeLogMeta({ sessionId, botToken }));
    res.json({ sessionId, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'فشل ربط Telegram' });
  }
});

app.post('/api/telegram/resolve', async (req, res) => {
  try {
    const { sessionId, recipient } = req.body || {};
    const botToken = resolveBotToken(sessionId, req.body || {});
    const info = await resolveRecipient(botToken, recipient, sessionId);
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message || 'تعذر التعرف على الشخص' });
  }
});

app.post('/api/telegram/contacts', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    const botToken = resolveBotToken(sessionId, req.body || {});
    const contacts = await listStartedContacts(botToken, sessionId);
    res.json({
      count: contacts.length,
      contacts,
      hint: contacts.length
        ? 'اختر شخصاً من القائمة ثم أرسل.'
        : 'لا أحد ضغط Start بعد. أرسل رابط البوت للمستلم واطلب منه Start ثم حدّث القائمة.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'تعذر جلب القائمة' });
  }
});

app.delete('/api/telegram/session/:sessionId', (req, res) => {
  clearSession(req.params.sessionId);
  res.json({ ok: true });
});

app.post('/api/telegram/test', async (req, res) => {
  try {
    const { botToken, chatId } = resolveCredentials(req.body.sessionId, req.body);
    const result = await testConnection({ botToken, chatId });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'فشل الاختبار' });
  }
});

app.post('/api/telegram/send', async (req, res) => {
  try {
    const {
      jobId,
      fileIds,
      method = 'document',
      caption = '',
      sessionId,
      sendAll = false,
      recipient = '',
    } = req.body || {};
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'الجلسة غير موجودة' });

    const { botToken, chatId: rawChat } = resolveCredentials(sessionId, req.body);
    const resolved = await resolveRecipient(botToken, recipient || rawChat, sessionId);
    const chatId = resolved.chatId;

    let files = job.files.filter((f) => f.status === 'done' && f.outputRel);
    if (sendAll) {
      // كل الملفات المحوّلة
    } else if (Array.isArray(fileIds) && fileIds.length) {
      const set = new Set(fileIds);
      files = files.filter((f) => set.has(f.id));
    } else {
      const selected = files.filter((f) => f.selected);
      files = selected.length ? selected : files;
    }

    if (!files.length) {
      return res.status(400).json({ error: 'لا توجد ملفات محوّلة للإرسال' });
    }

    activityPush(job, {
      type: 'info',
      message: `بدء إرسال ${files.length} ملفاً إلى ${resolved.title || chatId}`,
    });

    const payload = files.map((f) => ({
      id: f.id,
      filePath: safeJoin(CONVERTED, f.outputRel),
      originalName: f.outputName || f.originalName,
    }));

    const result = await sendMany({
      botToken,
      chatId,
      files: payload,
      method,
      caption,
      onItem: (row) => {
        activityPush(job, {
          type: row.ok ? 'success' : 'error',
          message: row.ok
            ? `أُرسل إلى Telegram (رسالة ${row.telegramMessageId})`
            : `فشل إرسال Telegram: ${row.error}`,
          fileId: row.id,
        });
      },
    });

    // نجاح فقط عند استجابات فعلية
    res.json({
      ok: result.sent > 0 && result.failed === 0,
      sent: result.sent,
      failed: result.failed,
      results: result.results,
      job: jobPublic(job),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'فشل الإرسال' });
  }
});

// ملفات الواجهة الثابتة
app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(ROOT, 'index.html'));
});

function cleanupOld(dir, maxAgeMs) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const now = Date.now();
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const full = path.join(dir, ent.name);
      const st = fs.statSync(full);
      if (now - st.mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.warn('[cleanup]', err.message);
  }
}

const TTL = Number(process.env.UPLOAD_TTL_HOURS || 24) * 3600_000;
setInterval(() => {
  cleanupOld(UPLOADS, TTL);
  cleanupOld(CONVERTED, TTL);
}, 60 * 60_000).unref?.();

app.listen(PORT, HOST, () => {
  console.log(`\n🎙️  Syrian Audio Studio`);
  console.log(`    http://${HOST}:${PORT}\n`);
});
