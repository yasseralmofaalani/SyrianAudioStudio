import { $, api, toast } from './utils.js';

const SESSION_KEY = 'sas_tg_session';

export function initTelegram({ getJobId, getSelectedIds, mode }) {
  let sessionId = sessionStorage.getItem(SESSION_KEY) || '';

  function guardLocal() {
    if (mode?.() === 'local') {
      toast('إرسال Telegram غير متاح من GitHub Pages. شغّل الخادم محلياً (npm start) لاستخدامه.', 'error');
      return true;
    }
    return false;
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
    $('#tgContactsField').style.display = person ? '' : 'none';
    $('#tgContactsRow').style.display = person ? '' : 'none';
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

  if (sessionId) {
    setStatus('توجد جلسة على الخادم — أعد الربط بعد إعادة تشغيل السيرفر', true);
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
    if (guardLocal()) return;
    const botToken = $('#tgToken').value.trim();
    const chatId = $('#tgChat').value.trim();
    if (!botToken) return toast('أدخل Bot Token', 'error');
    try {
      const data = await api('/api/telegram/session', {
        method: 'POST',
        body: { sessionId: sessionId || undefined, botToken, chatId },
      });
      sessionId = data.sessionId;
      sessionStorage.setItem(SESSION_KEY, sessionId);
      $('#tgToken').value = '';
      setStatus(`متصل: @${data.botUsername || 'bot'} (${data.tokenHint || ''})`, true);
      if (data.botUsername) setBotLink(data.botUsername);
      if (data.botLink) {
        toast(`أرسل هذا الرابط للمستلم: ${data.botLink}`, 'info');
      }
      toast('تم ربط البوت بنجاح', 'success');
    } catch (err) {
      setStatus(err.message, false);
      toast(err.message, 'error');
    }
  });

  $('#btnTgClear').addEventListener('click', async () => {
    if (sessionId) {
      try {
        await api(`/api/telegram/session/${sessionId}`, { method: 'DELETE' });
      } catch { /* ignore */ }
    }
    sessionId = '';
    sessionStorage.removeItem(SESSION_KEY);
    $('#tgToken').value = '';
    $('#tgRecipientInfo').textContent = '';
    $('#tgContacts').innerHTML = '<option value="">— حدّث القائمة بعد أن يضغط المستلم Start —</option>';
    setStatus('غير متصل', false);
    toast('تم مسح جلسة Telegram');
  });

  $('#btnTgContacts').addEventListener('click', async () => {
    if (guardLocal()) return;
    if (!sessionId) return toast('اربط البوت أولاً', 'error');
    try {
      const data = await api('/api/telegram/contacts', {
        method: 'POST',
        body: { sessionId },
      });
      const sel = $('#tgContacts');
      if (!data.contacts?.length) {
        sel.innerHTML = '<option value="">لا يوجد أحد بعد — أرسل رابط البوت واطلب Start</option>';
        $('#tgRecipientInfo').textContent = data.hint || '';
        toast(data.hint || 'القائمة فارغة', 'info');
        return;
      }
      sel.innerHTML = [
        '<option value="">— اختر مستلماً —</option>',
        ...data.contacts.map((c) =>
          `<option value="${c.chatId}">${c.title}${c.username ? ` ${c.username}` : ''} · ${c.chatId}</option>`,
        ),
      ].join('');
      $('#tgRecipientInfo').textContent = `وُجد ${data.count} شخصاً بدأوا البوت`;
      toast(`تم العثور على ${data.count} مستلم`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btnTgResolve').addEventListener('click', async () => {
    if (guardLocal()) return;
    const recipient = $('#tgRecipient').value.trim() || $('#tgContacts').value;
    if (!recipient) return toast('اختر من القائمة أو أدخل @username / الرقم', 'error');
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

  async function send({ all = false } = {}) {
    if (guardLocal()) return;
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
        log.innerHTML = '<div class="bad">اختر المستلم من القائمة أو أدخله يدوياً</div>';
        return toast('اختر شخصاً من قائمة من بدأوا البوت', 'error');
      }
      body.recipient = recipient;
    }

    if (!all) {
      const ids = getSelectedIds();
      if (ids.length) body.fileIds = ids;
    }

    try {
      const data = await api('/api/telegram/send', { method: 'POST', body });
      if (!data.results?.length) {
        log.innerHTML = '<div class="bad">لا نتائج</div>';
        return;
      }
      log.innerHTML = data.results.map((r) => `
        <div class="${r.ok ? 'ok' : 'bad'}">
          ${r.ok
            ? `نجاح فعلي — message_id: ${r.telegramMessageId}`
            : `فشل — ${r.error || ''}`}
        </div>
      `).join('');

      if (data.sent > 0 && data.failed === 0) {
        toast(`تم إرسال ${data.sent} ملفاً بنجاح`, 'success');
      } else {
        toast(`أُرسل ${data.sent} · فشل ${data.failed}`, data.sent ? 'info' : 'error');
      }
    } catch (err) {
      log.innerHTML = `<div class="bad">${err.message}</div>`;
      toast(err.message, 'error');
    }
  }

  $('#btnTgSendSelected').addEventListener('click', () => send({ all: false }));
  $('#btnTgSendAll').addEventListener('click', () => send({ all: true }));

  return { getSessionId: () => sessionId };
}
