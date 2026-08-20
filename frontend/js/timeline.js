// Интерактивный таймлайн: тепловая карта интересности + редактируемые сегменты.
import { formatTime, speakerColor } from './utils.js';

export class Timeline {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.layer = opts.layer;
    this.axis = opts.axis;

    this.onSeek = opts.onSeek || (() => {});
    this.onSegmentsChange = opts.onSegmentsChange || (() => {});
    this.onSelect = opts.onSelect || (() => {});
    this.onPreview = opts.onPreview || (() => {});
    this.onZoomChange = opts.onZoomChange || (() => {});

    this.duration = 0;
    this.heat = [];
    this.threshold = 0;
    this.segments = [];
    this.selected = -1;
    this.playheadTime = -1;
    this.playheadEl = null;
    this._drag = null;
    this.viewStart = 0;   // окно просмотра (для зума)
    this.viewEnd = 0;
    this.words = [];      // распознанные слова (метки на таймлайне)
    this.wordTipEl = null;

    this._buildPlayhead();
    this._buildWordTip();
    this._bind();

    this._ro = new ResizeObserver(() => this.render());
    this._ro.observe(this.layer.parentElement);
  }

  _buildPlayhead() {
    this.playheadEl = document.createElement('div');
    this.playheadEl.className = 'playhead';
    this.playheadEl.hidden = true;
    this.layer.parentElement.appendChild(this.playheadEl);
  }

  _buildWordTip() {
    this.wordTipEl = document.createElement('div');
    this.wordTipEl.className = 'word-tip';
    this.wordTipEl.hidden = true;
    this.layer.parentElement.appendChild(this.wordTipEl);
  }

  _bind() {
    this.layer.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.layer.addEventListener('dblclick', (e) => this._onDblClick(e));
    this.layer.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.layer.addEventListener('mousemove', (e) => this._updateWordTip(e));
    this.layer.addEventListener('mouseleave', () => { if (this.wordTipEl) this.wordTipEl.hidden = true; });
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', () => this._onPointerUp());
  }

  setData({ duration, heat, threshold, segments }) {
    this.duration = duration || 0;
    this.heat = heat || [];
    this.threshold = typeof threshold === 'number' ? threshold : 0;
    this.segments = segments || [];
    this.viewStart = 0;
    this.viewEnd = this.duration;
    this.render();
  }

  clear() {
    this.duration = 0;
    this.heat = [];
    this.threshold = 0;
    this.segments = [];
    this.selected = -1;
    this.viewStart = 0;
    this.viewEnd = 0;
    this.render();
  }

  setPlayhead(t) {
    this.playheadTime = t;
    this._renderPlayhead();
  }

  showPlayhead(show) {
    this.playheadEl.hidden = !show;
  }

  // --- Зум таймлайна (окно просмотра) ---
  _viewRange() {
    let s = this.viewStart;
    let e = this.viewEnd;
    if (!(e > s)) { s = 0; e = this.duration; }
    return { s, e };
  }

  _timeToX(t, W) {
    const { s, e } = this._viewRange();
    const span = Math.max(e - s, 1e-6);
    return ((t - s) / span) * W;
  }

  _xToTime(px, W) {
    const { s, e } = this._viewRange();
    const span = Math.max(e - s, 1e-6);
    return s + (px / W) * span;
  }

  isZoomed() {
    const { s, e } = this._viewRange();
    return this.duration > 0 && e - s < this.duration - 0.05;
  }

  setZoomFactor(factor) {
    if (this.duration <= 0) return;
    factor = Math.max(1, factor || 1);
    const c = this.playheadTime >= 0 ? this.playheadTime : this.duration / 2;
    const span = Math.max(Math.min(0.25, this.duration), this.duration / factor);
    let s = c - span / 2;
    let e = c + span / 2;
    if (s < 0) { e -= s; s = 0; }
    if (e > this.duration) { s -= e - this.duration; e = this.duration; }
    this.viewStart = Math.max(0, s);
    this.viewEnd = Math.min(this.duration, e);
    this.render();
  }

  zoomReset() {
    this.viewStart = 0;
    this.viewEnd = this.duration;
    this.render();
  }

  getZoomFactor() {
    const { s, e } = this._viewRange();
    if (this.duration <= 0 || (e - s) <= 0) return 1;
    return Math.max(1, this.duration / (e - s));
  }

  // Зум колесом мыши — центр масштабирования под курсором.
  _onWheel(e) {
    if (this.duration <= 0) return;
    e.preventDefault();
    const rect = this.layer.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const W = rect.width || 1;
    const cursorTime = this._xToTime(px, W);
    const { s, e: ve } = this._viewRange();
    const span = Math.max(ve - s, 1e-6);
    const factor = Math.pow(1.0015, e.deltaY);   // колёсико вверх = приближение
    const newSpan = Math.max(Math.min(0.25, this.duration), Math.min(span * factor, this.duration));
    let ns = cursorTime - (cursorTime - s) * (newSpan / span);
    let ne = ns + newSpan;
    if (ns < 0) { ne -= ns; ns = 0; }
    if (ne > this.duration) { ns -= (ne - this.duration); ne = this.duration; }
    this.viewStart = Math.max(0, ns);
    this.viewEnd = Math.min(this.duration, ne);
    this.render();
    this.onZoomChange(this.getZoomFactor());
  }

  // --- Метки распознанных слов ---
  setWords(words) {
    this.words = (words && words.length ? words : []);
    // Спикеры в порядке первого появления (для стабильных цветов).
    const spk = [];
    for (const w of this.words) {
      if (w.speaker && !spk.includes(w.speaker)) spk.push(w.speaker);
    }
    this.speakers = spk;
    this.render();
  }

  clearWords() {
    this.words = [];
    this.speakers = [];
    this.render();
  }

  _drawWords(W, H) {
    const ctx = this.ctx;
    const { s: vs, e: ve } = this._viewRange();
    const bottom = H - 5;
    const span = Math.max(ve - vs, 1e-6);
    const zoom = this.getZoomFactor();
    // Радиус точки: резкий рост на малых зумах (1x→1, 2x→3, 3x→5),
    // далее плавный (~+1 за шаг: 7x→9, 8x→10), сверху ограничен.
    const r = Math.min(12, zoom < 4 ? 1 + (zoom - 1) * 2 : 5 + (zoom - 3));
    for (const w of this.words) {
      if (w.start < vs || w.start > ve) continue;
      const x = this._timeToX(w.start, W);
      if (x < 0 || x > W) continue;
      if (w.speaker) {
        const idx = this.speakers.indexOf(w.speaker);
        ctx.fillStyle = (idx >= 0 ? speakerColor(idx) : '#22d3ee') + 'B0';
      } else {
        ctx.fillStyle = 'rgba(34, 211, 238, 0.7)';
      }
      ctx.beginPath();
      ctx.arc(x, bottom - 3, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Легенда: при диаризации — цвета и имена спикеров, иначе — просто «слова».
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    if (this.speakers.length) {
      let lx = 3;
      for (let i = 0; i < this.speakers.length; i++) {
        ctx.fillStyle = speakerColor(i);
        ctx.beginPath();
        ctx.arc(lx + 3, H - 9, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(this.speakers[i], lx + 9, H - 6);
        lx += 9 + ctx.measureText(this.speakers[i]).width + 12;
      }
    } else {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
      ctx.fillText('▍слова', 3, H - 6);
    }
  }

  _updateWordTip(e) {
    if (!this.wordTipEl) return;
    if (!this.words.length) {
      this.wordTipEl.hidden = true;
      return;
    }
    const rect = this.layer.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const W = rect.width || 1;
    const { s: vs, e: ve } = this._viewRange();
    let best = null;
    let bestDist = Infinity;
    for (const w of this.words) {
      if (w.start < vs || w.start > ve) continue;
      const x = this._timeToX(w.start, W);
      const d = Math.abs(x - px);
      if (d < bestDist) { bestDist = d; best = w; }
      if (x > px + 10) break;
    }
    if (best && bestDist < 18) {
      this.wordTipEl.hidden = false;
      this.wordTipEl.textContent = best.speaker
        ? `${best.speaker} · ${best.word} · ${formatTime(best.start)}`
        : `${best.word} · ${formatTime(best.start)}`;
      this.wordTipEl.style.left = `${Math.min(px + 12, rect.width - 120)}px`;
    } else {
      this.wordTipEl.hidden = true;
    }
  }

  render() {
    const W = this.canvas.clientWidth || 200;
    const H = this.canvas.clientHeight || 120;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(W * dpr)) this.canvas.width = Math.round(W * dpr);
    if (this.canvas.height !== Math.round(H * dpr)) this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, W, H);

    // фон
    this.ctx.fillStyle = '#0c121e';
    this.ctx.fillRect(0, 0, W, H);

    if (this.duration > 0 && this.heat.length) {
      this._drawHeat(W, H);
    } else if (this.duration > 0) {
      this._drawPlaceholder(W, H, 'Нет данных анализа');
    } else {
      this._drawPlaceholder(W, H, 'Выполните анализ, чтобы увидеть интересные моменты');
    }

    if (this.words.length) this._drawWords(W, H);

    this._renderSegments();
    this._renderAxis();
    this._renderPlayhead();
  }

  _drawPlaceholder(W, H, text) {
    this.ctx.fillStyle = '#54617a';
    this.ctx.font = '12px "Segoe UI", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, W / 2, H / 2 + 4);
  }

  _drawHeat(W, H) {
    const points = this.heat.filter((p) => isFinite(p.s));
    if (!points.length) return;
    let mn = Infinity, mx = -Infinity;
    for (const p of points) {
      if (p.s < mn) mn = p.s;
      if (p.s > mx) mx = p.s;
    }
    if (mx - mn < 1e-6) mx = mn + 1;

    const topPad = 8;
    const bottom = H - 14;
    const x = (t) => this._timeToX(t, W);
    const y = (s) => topPad + (1 - (s - mn) / (mx - mn)) * (bottom - topPad);
    const { s: vs, e: ve } = this._viewRange();
    const vis = points.filter((p) => p.t >= vs - 1e-6 && p.t <= ve + 1e-6);
    if (!vis.length) return;

    const ctx = this.ctx;

    // заливка под кривой
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    for (const p of vis) ctx.lineTo(x(p.t), y(p.s));
    ctx.lineTo(W, bottom);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, topPad, 0, bottom);
    g.addColorStop(0, 'rgba(124,92,255,0.03)');
    g.addColorStop(1, 'rgba(124,92,255,0.42)');
    ctx.fillStyle = g;
    ctx.fill();

    // линия кривой
    ctx.beginPath();
    vis.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.t), y(p.s)) : ctx.lineTo(x(p.t), y(p.s))));
    ctx.strokeStyle = '#8b6dff';
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(124,92,255,0.6)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // линия порога
    if (this.threshold > mn && this.threshold < mx) {
      const ty = y(this.threshold);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(W, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // базовая линия
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    ctx.lineTo(W, bottom);
    ctx.stroke();
  }

  _renderSegments() {
    this.layer.innerHTML = '';
    if (this.duration <= 0) return;
    const W = this.layer.clientWidth || this.canvas.clientWidth || 200;
    const { s: vs, e: ve } = this._viewRange();
    this.segments.forEach((seg, i) => {
      if (seg.end < vs || seg.start > ve) return; // вне видимой области
      const el = document.createElement('div');
      const cls = ['segment'];
      if (seg.enabled === false) cls.push('disabled');
      if (this.selected === i) cls.push('active-seg');
      el.className = cls.join(' ');
      el.dataset.index = i;

      const x1 = Math.max(0, this._timeToX(seg.start, W));
      const x2 = Math.min(W, this._timeToX(seg.end, W));
      const left = (x1 / W) * 100;
      const width = Math.max(((x2 - x1) / W) * 100, 0.35);
      el.style.left = `${left}%`;
      el.style.width = `${width}%`;

      const label = document.createElement('span');
      label.className = 'seg-label';
      label.textContent = `${formatTime(seg.start)}–${formatTime(seg.end)}`;
      el.appendChild(label);

      const hl = document.createElement('div');
      hl.className = 'seg-handle left';
      el.appendChild(hl);
      const hr = document.createElement('div');
      hr.className = 'seg-handle right';
      el.appendChild(hr);

      this.layer.appendChild(el);
    });
  }

  _renderAxis() {
    if (!this.axis) return;
    if (this.duration <= 0) {
      this.axis.innerHTML = '';
      return;
    }
    const ticks = 7;
    const { s, e } = this._viewRange();
    const span = e - s;
    let html = `<span>${formatTime(s)}</span>`;
    for (let i = 1; i < ticks; i++) {
      html += `<span>${formatTime(s + (span / ticks) * i)}</span>`;
    }
    html += `<span>${formatTime(e)}</span>`;
    this.axis.innerHTML = html;
  }

  _renderPlayhead() {
    if (!this.playheadEl) return;
    if (this.playheadTime < 0 || this.duration <= 0) {
      this.playheadEl.hidden = true;
      return;
    }
    const { s, e } = this._viewRange();
    if (this.playheadTime < s || this.playheadTime > e) {
      this.playheadEl.hidden = true;
      return;
    }
    this.playheadEl.hidden = false;
    const pct = Math.max(0, Math.min(1, (this.playheadTime - s) / (e - s))) * 100;
    this.playheadEl.style.left = `${pct}%`;
  }

  _timeFromEvent(e) {
    const rect = this.layer.getBoundingClientRect();
    return this._xToTime(e.clientX - rect.left, rect.width);
  }

  _onPointerDown(e) {
    const handle = e.target.closest('.seg-handle');
    const segEl = e.target.closest('.segment');

    if (handle) {
      const seg = handle.closest('.segment');
      const i = +seg.dataset.index;
      const side = handle.classList.contains('left') ? 'left' : 'right';
      this._drag = {
        type: 'resize', index: i, side,
        startX: e.clientX,
        origStart: this.segments[i].start, origEnd: this.segments[i].end,
        moved: false,
      };
      this.selected = i;
      this.onSelect(i);
      this.render();
      e.preventDefault();
      return;
    }

    if (segEl) {
      const i = +segEl.dataset.index;
      const seg = this.segments[i];
      this._drag = {
        type: 'move', index: i,
        startX: e.clientX,
        origStart: seg.start, origEnd: seg.end,
        moved: false,
      };
      this.selected = i;
      this.onSelect(i);
      this.render();
      e.preventDefault();
      return;
    }

    if (this.duration > 0) {
      // Пустая область: клик — перейти к позиции, перетаскивание — панорама (при зуме).
      this._drag = {
        type: 'pan',
        startX: e.clientX,
        startViewStart: this.viewStart,
        startViewEnd: this.viewEnd,
        moved: false,
      };
      e.preventDefault();
    }
  }

  _onPointerMove(e) {
    if (!this._drag) return;
    const d = this._drag;
    if (Math.abs(e.clientX - d.startX) > 3) d.moved = true;
    if (!d.moved) return;

    const rect = this.layer.getBoundingClientRect();

    if (d.type === 'pan') {
      const span = d.startViewEnd - d.startViewStart;
      const dx = ((e.clientX - d.startX) / rect.width) * span;
      let s = d.startViewStart - dx;
      let en = d.startViewEnd - dx;
      if (s < 0) { en -= s; s = 0; }
      if (en > this.duration) { s -= en - this.duration; en = this.duration; }
      this.viewStart = Math.max(0, s);
      this.viewEnd = Math.min(this.duration, en);
      this.render();
      return;
    }

    const dxSec = ((e.clientX - d.startX) / rect.width) * this.duration;
    const seg = this.segments[d.index];
    if (!seg) return;
    const minLen = 0.5;

    if (d.type === 'move') {
      const len = d.origEnd - d.origStart;
      let ns = d.origStart + dxSec;
      ns = Math.max(0, Math.min(this.duration - len, ns));
      seg.start = ns;
      seg.end = ns + len;
    } else {
      let ns = d.origStart;
      let ne = d.origEnd;
      if (d.side === 'left') {
        ns = d.origStart + dxSec;
        ns = Math.max(0, Math.min(d.origEnd - minLen, ns));
      } else {
        ne = d.origEnd + dxSec;
        ne = Math.min(this.duration, Math.max(d.origStart + minLen, ne));
      }
      seg.start = Math.round(Math.max(0, Math.min(ns, this.duration)) * 100) / 100;
      seg.end = Math.round(Math.max(0, Math.min(ne, this.duration)) * 100) / 100;
      if (seg.end - seg.start < minLen) {
        if (d.side === 'left') seg.start = seg.end - minLen;
        else seg.end = seg.start + minLen;
      }
    }

    this.render();
    this.onSegmentsChange(d.index);
  }

  _onPointerUp() {
    if (!this._drag) return;
    const d = this._drag;
    this._drag = null;
    if (d.type === 'pan') {
      if (!d.moved) {
        // Клик по пустой области — перейти к позиции.
        const rect = this.layer.getBoundingClientRect();
        const t = this._xToTime(d.startX - rect.left, rect.width);
        this.onSeek(Math.max(0, Math.min(this.duration, t)));
      }
      return;
    }
    if (!d.moved) {
      // Клик по сегменту — просто выделение
      this.onSelect(d.index);
    } else {
      this.onSegmentsChange(d.index);
    }
  }

  _onDblClick(e) {
    const segEl = e.target.closest('.segment');
    if (segEl) {
      const i = +segEl.dataset.index;
      this.onPreview(i);
    }
  }
}
