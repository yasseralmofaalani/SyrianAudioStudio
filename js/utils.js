export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
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
  }, 3200);
}

export async function api(path, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(options.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `خطأ في الطلب (${res.status})`);
  }
  return data;
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
