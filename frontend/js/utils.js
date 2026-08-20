// Вспомогательные функции
import { t } from './i18n.js?v=2';

export function formatTime(seconds, withHundredths = false) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let out;
  if (h > 0) out = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  else out = `${m}:${String(s).padStart(2, '0')}`;
  if (withHundredths) {
    const cs = Math.floor((seconds % 1) * 100);
    out += `.${String(cs).padStart(2, '0')}`;
  }
  return out;
}

export function parseTime(str) {
  const parts = String(str).trim().split(':').map((p) => parseFloat(p.replace(',', '.')));
  if (parts.some((p) => !isFinite(p) || p < 0)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || NaN;
}

export function formatSize(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return `0 ${t('unit_b')}`;
  const units = [t('unit_b'), t('unit_kb'), t('unit_mb'), t('unit_gb')];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function toast(message, type = 'info', ms = 4000) {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Палитра цветов для спикеров (диаризация речи).
export const SPEAKER_COLORS = [
  '#22d3ee', '#f472b6', '#a78bfa', '#4ade80', '#fbbf24',
  '#fb7185', '#60a5fa', '#f97316', '#34d399', '#e879f9',
];

export function speakerColor(index) {
  return SPEAKER_COLORS[Math.abs(index) % SPEAKER_COLORS.length];
}

// Стабильный цвет по имени спикера (когда список имён недоступен).
export function speakerColorByName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return speakerColor(h);
}
