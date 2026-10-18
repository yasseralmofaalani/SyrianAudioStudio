import { CLOUD_API } from './config.js';

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

/** أساس طلبات API — فارغ يعني نفس أصل الصفحة (خادم Node) */
export function getApiBase() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('api');
  if (fromQuery) return fromQuery.replace(/\/$/, '');
  try {
    const stored = localStorage.getItem('sas_api');
    if (stored) return stored.replace(/\/$/, '');
  } catch { /* ignore */ }
  if (CLOUD_API) return String(CLOUD_API).replace(/\/$/, '');
  return '';
}

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBase()}${p}`;
}

export function formatBytes(n = 0) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  let x = v;
  do { x /= 1024; i += 1; } while (x >= 1024 && i < u.length - 1);
  return `${x.toFixed(x >= 10 ? 1 : 2)} ${u[i]}`;
}

export function formatDuration(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '—';
  const s = Math.max(0, Math.floor(Number(sec)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function toast(message, type = 'info') {
  const host = $('#toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 280);
  }, 4200);
}

export async function api(path, options = {}) {
  const { timeoutMs: customTimeout, ...rest } = options;
  const opts = { ...rest };
  opts.headers = { ...(options.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  const timeoutMs = customTimeout ?? (isStaticHost() ? 2500 : 15000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  opts.signal = ctrl.signal;

  try {
    const res = await fetch(apiUrl(path), opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `خطأ في الطلب (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بالخادم');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function statusBadge(status) {
  const map = {
    pending: 'بالانتظار',
    queued: 'في الطابور',
    processing: 'جارٍ التحويل',
    done: 'مكتمل',
    failed: 'فشل',
    cancelled: 'أُلغي',
  };
  return `<span class="badge badge--${status}">${map[status] || status}</span>`;
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function isStaticHost() {
  return /github\.io$/i.test(location.hostname)
    || location.protocol === 'file:';
}
