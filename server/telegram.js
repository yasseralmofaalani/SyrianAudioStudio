import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TG_API = 'https://api.telegram.org';
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_VOICE_BYTES = 50 * 1024 * 1024;

/** تخزين الجلسة في الذاكرة فقط — لا يُعاد للواجهة */
const sessions = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function maskToken(token) {
  if (!token || token.length < 10) return '***';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}

export function setSession(sessionId, { botToken, chatId = '', botUsername = null }) {
  if (!botToken || !String(botToken).includes(':')) {
    throw new Error('رمز البوت غير صالح');
  }
  const prev = sessions.get(sessionId) || {};
  sessions.set(sessionId, {
    botToken: String(botToken).trim(),
    chatId: chatId === 0 || chatId ? String(chatId).trim() : '',
    botUsername: botUsername || prev.botUsername || null,
    contacts: prev.contacts || new Map(),
    updatedAt: Date.now(),
  });
}

function contactFromUser(user, chatId) {
  const id = String(chatId || user.id);
  const title = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || id;
  return {
    chatId: id,
    title,
    username: user.username ? `@${user.username}` : null,
    type: 'private',
  };
}

function rememberContact(sessionId, contact) {
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (!session) return;
  if (!(session.contacts instanceof Map)) session.contacts = new Map();
  session.contacts.set(contact.chatId, contact);
}

/**
 * يجلب الأشخاص الذين راسلوا البوت (Start) من تحديثات Telegram
 */
export async function listStartedContacts(botToken, sessionId = null) {
  // إن وُجد webhook قديم يمنع getUpdates
  try {
    await tgCall(botToken, 'deleteWebhook', { json: { drop_pending_updates: false } });
  } catch { /* ignore */ }

  const updates = await tgCall(botToken, 'getUpdates', {
    json: { limit: 100, timeout: 0, allowed_updates: ['message', 'my_chat_member'] },
  });

  const map = new Map();
  for (const u of updates || []) {
    const msg = u.message;
    const member = u.my_chat_member;
    const from = msg?.from || member?.from;
    const chat = msg?.chat || member?.chat;
    if (!from || !chat || chat.type !== 'private') continue;
    if (from.is_bot) continue;
    const contact = contactFromUser(from, chat.id);
    map.set(contact.chatId, contact);
    rememberContact(sessionId, contact);
  }

  // دمج المخزّن سابقاً في الجلسة
  const session = sessionId ? sessions.get(sessionId) : null;
  if (session?.contacts instanceof Map) {
    for (const [id, c] of session.contacts) map.set(id, c);
  }

  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title, 'ar'));
}

/**
 * يحلّل مستلماً: رقم Chat ID أو @username
 * ملاحظة: للإرسال الخاص يجب أن يكون الشخص قد بدأ محادثة مع البوت (/start).
 */
export async function resolveRecipient(botToken, recipient, sessionId = null) {
  const raw = String(recipient || '').trim();
  if (!raw) throw new Error('حدد الشخص المستلم (رقم أو @username)');

  // إن كان الاختيار من القائمة المخزّنة
  const session = sessionId ? sessions.get(sessionId) : null;
  if (session?.contacts instanceof Map) {
    const byId = session.contacts.get(raw);
    if (byId) return byId;
    const uname = raw.startsWith('@') ? raw.toLowerCase() : `@${raw}`.toLowerCase();
    for (const c of session.contacts.values()) {
      if (c.username && c.username.toLowerCase() === uname) return c;
    }
  }

  let chatId = raw;
  if (raw.startsWith('@')) {
    chatId = raw;
  } else if (/^[A-Za-z]\w{3,31}$/.test(raw)) {
    chatId = `@${raw}`;
  }

  // جرّب أولاً من قائمة من ضغطوا Start
  try {
    const started = await listStartedContacts(botToken, sessionId);
    const uname = chatId.startsWith('@') ? chatId.toLowerCase() : null;
    const found = started.find((c) =>
      c.chatId === String(raw)
      || (uname && c.username && c.username.toLowerCase() === uname),
    );
    if (found) return found;
  } catch { /* نكمل إلى getChat */ }

  try {
    const chat = await tgCall(botToken, 'getChat', { json: { chat_id: chatId } });
    const title =
      chat.title
      || [chat.first_name, chat.last_name].filter(Boolean).join(' ')
      || chat.username
      || String(chat.id);
    const contact = {
      chatId: String(chat.id),
      title,
      username: chat.username ? `@${chat.username}` : null,
      type: chat.type || 'private',
    };
    rememberContact(sessionId, contact);
    return contact;
  } catch (err) {
    if (/chat not found/i.test(err.message) || /تعذر العثور/i.test(err.message)) {
      throw new Error(
        'البوت لا يعرف هذا الشخص بعد. اطلب منه فتح رابط البوت والضغط Start، ثم اضغط «تحديث قائمة من بدأوا البوت» واختره من القائمة.',
      );
    }
    throw err;
  }
}

async function tgCall(botToken, method, { form, json, retries = 3 } = {}) {
  const url = `${TG_API}/bot${botToken}/${method}`;
  let lastErr = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const init = { method: 'POST' };
      if (form) {
        init.body = form;
      } else {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(json || {});
      }

      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));

      if (data.ok) return data.result;

      const retryAfter = Number(data.parameters?.retry_after || 0);
      const desc = data.description || `خطأ Telegram (${res.status})`;

      if ((res.status === 429 || /retry/i.test(desc)) && attempt < retries - 1) {
        await sleep((retryAfter || 2 + attempt) * 1000);
        continue;
      }

      const err = new Error(mapTelegramError(desc));
      err.telegram = true;
      throw err;
    } catch (err) {
      lastErr = err;
      if (err.telegram) throw err;
      if (attempt < retries - 1) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr || new Error('فشل الاتصال بـ Telegram');
}

function mapTelegramError(desc) {
  if (/Unauthorized/i.test(desc)) return 'رمز البوت غير صحيح أو ملغى';
  if (/chat not found/i.test(desc)) return 'تعذر العثور على المحادثة. تحقق من Chat ID';
  if (/bot was blocked/i.test(desc)) return 'تم حظر البوت من قبل المستخدم';
  if (/too big/i.test(desc) || /file is too big/i.test(desc)) {
    return 'حجم الملف يتجاوز حد Telegram';
  }
  if (/VOICE_MESSAGES_FORBIDDEN/i.test(desc)) {
    return 'لا يمكن إرسال رسائل صوتية إلى هذه المحادثة';
  }
  return desc;
}

export async function testConnection({ botToken, chatId }) {
  const me = await tgCall(botToken, 'getMe', { json: {} });
  let recipient = null;
  if (chatId) {
    try {
      recipient = await resolveRecipient(botToken, chatId);
    } catch (err) {
      if (/Unauthorized/i.test(err.message) || /رمز البوت/i.test(err.message)) throw err;
      // البوت صالح لكن الوجهة الافتراضية غير متاحة بعد
      recipient = { warning: err.message };
    }
  }
  return {
    ok: true,
    botUsername: me.username || null,
    botName: me.first_name || null,
    botLink: me.username ? `https://t.me/${me.username}` : null,
    tokenHint: maskToken(botToken),
    recipient,
  };
}

function pickSendMethod(requested, filePath, mimeHint) {
  const ext = path.extname(filePath).toLowerCase();
  const size = fs.statSync(filePath).size;

  if (requested === 'voice') {
    // Telegram voice: ideally OGG/OPUS
    const voiceOk = ext === '.ogg' || ext === '.opus' || /opus/i.test(mimeHint || '');
    if (!voiceOk) {
      throw new Error(
        'إرسال Voice يتطلب ملفاً بصيغة OGG/OPUS. حوّل الملف إلى OPUS أولاً أو اختر Audio/Document.',
      );
    }
    if (size > MAX_VOICE_BYTES) throw new Error('الملف أكبر من حد الرسائل الصوتية');
    return 'sendVoice';
  }

  if (requested === 'audio') {
    if (size > MAX_AUDIO_BYTES) throw new Error('الملف أكبر من حد الملفات الصوتية');
    return 'sendAudio';
  }

  if (size > MAX_DOCUMENT_BYTES) throw new Error('الملف أكبر من حد المستندات في Telegram (50MB)');
  return 'sendDocument';
}

export async function sendFile({
  botToken,
  chatId,
  filePath,
  originalName,
  method = 'document',
  caption = '',
}) {
  if (!fs.existsSync(filePath)) {
    throw new Error('الملف المطلوب إرساله غير موجود');
  }

  const size = fs.statSync(filePath).size;
  if (size <= 0) throw new Error('الملف فارغ');
  if (size > MAX_DOCUMENT_BYTES) {
    throw new Error('حجم الملف يتجاوز 50MB وهو حد Telegram الشائع للبوتات');
  }

  const apiMethod = pickSendMethod(method, filePath, '');
  const field =
    apiMethod === 'sendVoice' ? 'voice' : apiMethod === 'sendAudio' ? 'audio' : 'document';

  const blob = new Blob([fs.readFileSync(filePath)]);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(field, blob, originalName || path.basename(filePath));
  if (caption && (apiMethod === 'sendAudio' || apiMethod === 'sendDocument' || apiMethod === 'sendVoice')) {
    form.append('caption', String(caption).slice(0, 1024));
  }

  const result = await tgCall(botToken, apiMethod, { form, retries: 4 });
  const messageId = result?.message_id ?? null;
  if (!messageId) {
    throw new Error('لم تُستلم استجابة نجاح صالحة من Telegram');
  }

  return {
    ok: true,
    telegramMessageId: messageId,
    method: apiMethod,
  };
}

export async function sendMany({
  botToken,
  chatId,
  files,
  method = 'document',
  caption = '',
  onItem,
}) {
  const results = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const itemCaption = i === 0 ? caption : '';
    try {
      // تباعد بسيط لاحترام حدود المعدل
      if (i > 0) await sleep(350);
      const r = await sendFile({
        botToken,
        chatId,
        filePath: file.filePath,
        originalName: file.originalName,
        method,
        caption: itemCaption,
      });
      sent += 1;
      const row = {
        id: file.id,
        ok: true,
        telegramMessageId: r.telegramMessageId,
        error: null,
      };
      results.push(row);
      if (onItem) onItem(row);
    } catch (err) {
      failed += 1;
      const row = {
        id: file.id,
        ok: false,
        telegramMessageId: null,
        error: err.message || 'فشل الإرسال',
      };
      results.push(row);
      if (onItem) onItem(row);
    }
  }

  return { sent, failed, results };
}

export function resolveBotToken(sessionId, body = {}) {
  const envToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const session = sessionId ? getSession(sessionId) : null;
  const botToken = body.botToken || session?.botToken || envToken;
  if (!botToken) throw new Error('رمز البوت غير مُعدّ. أدخله من مركز Telegram أو عبر .env');
  return botToken;
}

export function resolveCredentials(sessionId, body = {}) {
  const envChat = process.env.TELEGRAM_CHAT_ID || '';
  const session = sessionId ? getSession(sessionId) : null;
  const botToken = resolveBotToken(sessionId, body);
  // أولوية: مستلم هذه العملية → chatId في الطلب → جلسة → .env
  const chatId = body.recipient || body.chatId || session?.chatId || envChat;

  if (!chatId) {
    throw new Error('حدد المستلم: رقم الشخص أو @username أو Chat ID الافتراضي');
  }

  return {
    botToken,
    chatId,
    fromEnv: Boolean(process.env.TELEGRAM_BOT_TOKEN && !body.botToken && !session?.botToken),
  };
}

// منع تسجيل التوكن
export function safeLogMeta(meta = {}) {
  const copy = { ...meta };
  if (copy.botToken) copy.botToken = maskToken(copy.botToken);
  if (copy.token) copy.token = maskToken(copy.token);
  return copy;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = __dirname;
