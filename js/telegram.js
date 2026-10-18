import { $, api, toast } from './utils.js';

const BROWSER_KEY = 'sas_tg_browser';
const SESSION_KEY = 'sas_tg_session';

function ensureTgFrame() {
  let frame = document.getElementById('tgHiddenFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'tgHiddenFrame';
    frame.name = 'tgHiddenFrame';
    frame.title = 'telegram';
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
  }
  return frame;
}

/**
 * إرسال من المتصفح مباشرة إلى Telegram Bot API
 * (يعمل على GitHub Pages بدون خادم)
 */
async function sendBrowserFile({ token, chatId, blob, filename, method, caption }) {
  const apiMethod = method === 'voice' ? 'sendVoice' : method === 'audio' ? 'sendAudio' : 'sendDocument';
  const field = method === 'voice' ? 'voice' : method === 'audio' ? 'audio' : 'document';

  if (method === 'voice') {
    const ok = /\.(ogg|opus)$/i.test(filename);
    if (!ok) {
      throw new Error('Voice يحتاج ملف OGG/OPUS. حوّل إلى OPUS أولاً أو اختر Document/Audio.');
    }
  }

  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append(field, blob, filename);
  if (caption) fd.append('caption', String(caption).slice(0, 1024));

  // محاولة fetch المباشرة
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${apiMethod}`, {
      method: 'POST',
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.result?.message_id) {
      return { ok: true, telegramMessageId: data.result.message_id, via: 'fetch' };
    }
    if (data.description) throw new Error(data.description);
  } catch (err) {
    // إن كان الخطأ من Telegram نفسه (وليس CORS) أعد رميه
    if (err.message && !/Failed to fetch|NetworkError|CORS|Load failed/i.test(err.message)) {
      throw err;
    }
  }

  // بديل بدون CORS: إرسال عبر نموذج إلى iframe
  ensureTgFrame();
  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = `https://api.telegram.org/bot${token}/${apiMethod}`;
  form.target = 'tgHiddenFrame';
  form.style.display = 'none';

  const chatInput = document.createElement('input');
  chatInput.name = 'chat_id';
  chatInput.value = String(chatId);
  form.appendChild(chatInput);

  if (caption) {
    const cap = document.createElement('input');
    cap.name = 'caption';
    cap.value = String(caption).slice(0, 1024);
    form.appendChild(cap);
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.name = field;
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  form.appendChild(fileInput);

  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 2000);

  return { ok: true, telegramMessageId: null, via: 'form', assumed: true };
}

export function initTelegram({ getJobId, getSelectedIds, mode, getEngine }) {
  let sessionId = sessionStorage.getItem(SESSION_KEY) || '';
  let browserCreds = null;

  try {
    const raw = sessionStorage.getItem(BROWSER_KEY);
    if (raw) browserCreds = JSON.parse(raw);
  } catch { /* ignore */ }

  function isBrowser() {
    return mode?.() === 'local';
  }

  function setStatus(text, ok) {
    const el = $('#tgStatus');
    el.textContent = text;
    el.style.color = ok ? 'var(--ok)' : 'var(--muted)';
  }

  function syncDestMode() {
    const person = $('#tgDestMode').value === 'person';
    $('#tgPersonField').style.display = person ? '' : 'none';
    $('#tgResolveRow').style.display = person ? '' : 'none';
    // قائمة "من بدأوا البوت" تحتاج خادم — أخفِها في وضع GitHub
    const showContacts = !isBrowser();
    $('#tgContactsField').style.display = person && showContacts ? '' : 'none';
    $('#tgContactsRow').style.display = person && showContacts ? '' : 'none';
  }

  function setBotLink(username) {
    const link = $('#tgBotLink');
    if (!link) return;
    const u = (username || 'syrianAudioBot').replace(/^@/, '');
    const href = `https://t.me/${u}`;
    link.href = href;
    link.textContent = href;
  }

  $('#tgDestMode').addEventListener('change', syncDestMode);
  syncDestMode();
  setBotLink('syrianAudioBot');

  if (browserCreds?.token) {
    setStatus('جاهز للإرسال من المتصفح (GitHub Pages)', true);
    $('#tgChat').value = browserCreds.chatId || '';
  } else if (sessionId && !isBrowser()) {
    setStatus('توجد جلسة على الخادم', true);
  }

  $('#tgContacts').addEventListener('change', () => {
    const v = $('#tgContacts').value;
    if (v) {
      $('#tgRecipient').value = v;
      const opt = $('#tgContacts').selectedOptions[0];
      $('#tgRecipientInfo').textContent = opt ? `تم اختيار: ${opt.textContent}` : '';
    }
  });

  $('#btnTgConnect').addEventListener('click', async () => {
    const botToken = $('#tgToken').value.trim();
    const chatId = $('#tgChat').value.trim();
    if (!botToken) return toast('أدخل Bot Token', 'error');
    if (!botToken.includes(':')) return toast('صيغة رمز البوت غير صحيحة', 'error');

    if (isBrowser()) {
      if (!chatId && $('#tgDestMode').value !== 'person') {
        return toast('أدخل Chat ID الافتراضي أو اختر «إرسال لشخص»', 'error');
      }
      browserCreds = { token: botToken, chatId };
      try {
        sessionStorage.setItem(BROWSER_KEY, JSON.stringify(browserCreds));
      } catch { /* ignore */ }
      $('#tgToken').value = '';
      setStatus('جاهز — الإرسال من المتصفح مباشرة إلى Telegram', true);
      toast('تم حفظ إعدادات البوت لهذه الجلسة', 'success');
      // محاولة خفيفة للتحقق
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = await res.json();
        if (data.ok) {
          setBotLink(data.result.username);
          setStatus(`متصل: @${data.result.username}`, true);
          toast(`البوت: @${data.result.username}`, 'success');
        }
      } catch {
        toast('تعذر التحقق التلقائي (قيود المتصفح) — جرّب الإرسال مباشرة', 'info');
      }
      return;
    }

    try {
      const data = await api('/api/telegram/session', {
        method: 'POST',
        body: { sessionId: sessionId || undefined, botToken, chatId },
      });
      sessionId = data.sessionId;
      sessionStorage.setItem(SESSION_KEY, sessionId);
      $('#tgToken').value = '';
      setStatus(`متصل: @${data.botUsername || 'bot'}`, true);
      if (data.botUsername) setBotLink(data.botUsername);
      toast('تم ربط البوت بنجاح', 'success');
    } catch (err) {
      setStatus(err.message, false);
      toast(err.message, 'error');
    }
  });

  $('#btnTgClear').addEventListener('click', async () => {
    if (!isBrowser() && sessionId) {
      try {
        await api(`/api/telegram/session/${sessionId}`, { method: 'DELETE' });
      } catch { /* ignore */ }
    }
    sessionId = '';
    browserCreds = null;
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(BROWSER_KEY);
    $('#tgToken').value = '';
    $('#tgRecipientInfo').textContent = '';
    setStatus('غير متصل', false);
    toast('تم مسح إعدادات Telegram');
  });

  $('#btnTgContacts').addEventListener('click', async () => {
    if (isBrowser()) {
      return toast('في وضع GitHub: أدخل رقم المستلم أو @username يدوياً (بعد أن يضغط Start على البوت)', 'info');
    }
    if (!sessionId) return toast('اربط البوت أولاً', 'error');
    try {
      const data = await api('/api/telegram/contacts', {
        method: 'POST',
        body: { sessionId },
      });
      const sel = $('#tgContacts');
      if (!data.contacts?.length) {
        sel.innerHTML = '<option value="">لا يوجد أحد بعد</option>';
        toast(data.hint || 'القائمة فارغة', 'info');
        return;
      }
      sel.innerHTML = [
        '<option value="">— اختر مستلماً —</option>',
        ...data.contacts.map((c) =>
          `<option value="${c.chatId}">${c.title}${c.username ? ` ${c.username}` : ''} · ${c.chatId}</option>`,
        ),
      ].join('');
      toast(`تم العثور على ${data.count} مستلم`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btnTgResolve').addEventListener('click', async () => {
    const recipient = $('#tgRecipient').value.trim();
    if (!recipient) return toast('أدخل @username أو الرقم', 'error');
    if (isBrowser()) {
      $('#tgRecipientInfo').textContent = `سيتم الإرسال إلى: ${recipient}`;
      toast('في وضع GitHub يُستخدم المعرّف كما هو عند الإرسال', 'info');
      return;
    }
    try {
      const info = await api('/api/telegram/resolve', {
        method: 'POST',
        body: { sessionId, recipient },
      });
      $('#tgRecipient').value = info.chatId;
      $('#tgRecipientInfo').textContent =
        `المستلم: ${info.title}${info.username ? ` (${info.username})` : ''} · id: ${info.chatId}`;
      toast('تم التعرف على الشخص', 'success');
    } catch (err) {
      $('#tgRecipientInfo').textContent = err.message;
      toast(err.message, 'error');
    }
  });

  async function sendBrowser({ all = false } = {}) {
    if (!browserCreds?.token) {
      return toast('اربط البوت أولاً (Bot Token)', 'error');
    }

    let chatId = browserCreds.chatId;
    if ($('#tgDestMode').value === 'person') {
      chatId = $('#tgRecipient').value.trim() || $('#tgContacts').value;
      if (!chatId) return toast('أدخل رقم الشخص أو @username', 'error');
    }
    if (!chatId) return toast('Chat ID مطلوب', 'error');

    const files = getEngine()?.getSendableFiles({
      all,
      ids: all ? null : getSelectedIds(),
    }) || [];

    if (!files.length) {
      return toast('لا توجد ملفات محوّلة للإرسال — حوّل الملفات أولاً', 'error');
    }

    const method = $('#tgMethod').value;
    const caption = $('#tgCaption').value.trim();
    const log = $('#tgSendLog');
    log.innerHTML = '';

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        if (i > 0) await new Promise((r) => setTimeout(r, 400));
        const r = await sendBrowserFile({
          token: browserCreds.token,
          chatId,
          blob: f.blob,
          filename: f.name,
          method,
          caption: i === 0 ? caption : '',
        });
        sent += 1;
        log.innerHTML += `<div class="ok">${f.name} — ${
          r.assumed
            ? 'أُرسل عبر المتصفح (تحقق من تيليجرام)'
            : `نجاح · message_id: ${r.telegramMessageId}`
        }</div>`;
      } catch (err) {
        failed += 1;
        log.innerHTML += `<div class="bad">${f.name} — ${err.message}</div>`;
      }
    }

    if (sent && !failed) toast(`تم إرسال ${sent} ملفاً`, 'success');
    else toast(`أُرسل ${sent} · فشل ${failed}`, sent ? 'info' : 'error');
  }

  async function sendServer({ all = false } = {}) {
    const jobId = getJobId();
    const method = $('#tgMethod').value;
    const caption = $('#tgCaption').value.trim();
    const log = $('#tgSendLog');
    log.innerHTML = '<div class="skeleton" style="height:40px"></div>';

    const body = {
      jobId,
      sessionId,
      method,
      caption,
      sendAll: all,
    };

    if ($('#tgDestMode').value === 'person') {
      const recipient = $('#tgRecipient').value.trim() || $('#tgContacts').value;
      if (!recipient) {
        log.innerHTML = '<div class="bad">أدخل المستلم</div>';
        return toast('أدخل المستلم', 'error');
      }
      body.recipient = recipient;
    }

    if (!all) {
      const ids = getSelectedIds();
      if (ids.length) body.fileIds = ids;
    }

    try {
      const data = await api('/api/telegram/send', { method: 'POST', body });
      log.innerHTML = (data.results || []).map((r) => `
        <div class="${r.ok ? 'ok' : 'bad'}">
          ${r.ok ? `نجاح — ${r.telegramMessageId}` : `فشل — ${r.error || ''}`}
        </div>
      `).join('') || '<div class="bad">لا نتائج</div>';
      if (data.sent > 0 && data.failed === 0) toast(`تم إرسال ${data.sent} ملفاً`, 'success');
      else toast(`أُرسل ${data.sent} · فشل ${data.failed}`, data.sent ? 'info' : 'error');
    } catch (err) {
      log.innerHTML = `<div class="bad">${err.message}</div>`;
      toast(err.message, 'error');
    }
  }

  async function send({ all = false } = {}) {
    if (isBrowser()) return sendBrowser({ all });
    return sendServer({ all });
  }

  $('#btnTgSendSelected').addEventListener('click', () => send({ all: false }));
  $('#btnTgSendAll').addEventListener('click', () => send({ all: true }));

  return { getSessionId: () => sessionId };
}
