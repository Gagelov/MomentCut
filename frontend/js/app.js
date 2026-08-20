// MomentCut — главный модуль приложения.
import { API } from './api.js?v=18';
import { formatTime, formatSize, parseTime, toast, speakerColor, speakerColorByName } from './utils.js?v=16';
import { Timeline } from './timeline.js?v=16';

// Основной системный промпт задаётся на сервере; поле в UI — дополнение к нему.

// ---------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------
const state = {
  videos: [],                 // список видео (с анализом)
  activeId: null,
  jobs: new Map(),            // jobId -> {videoId?, kind}
  jobData: new Map(),         // jobId -> последний ответ /api/jobs/{id} (для статуса паузы)
  queue: [],                  // очередь монтажа [{videoId, name, start, end}]
  playing: null,              // {videoId, start, end} активный предпросмотр
  engineInfo: null,           // данные /api/engine
  speechResults: [],          // последние результаты поиска по словам
  speechCache: {},            // videoId -> слова (для меток на таймлайне)
};

const $ = (id) => document.getElementById(id);

const el = {
  fileInput: $('fileInput'),
  projectFile: $('projectFile'),
  btnUpload: $('btnUpload'),
  btnUploadEmpty: $('btnUploadEmpty'),
  btnSaveProject: $('btnSaveProject'),
  btnLoadProject: $('btnLoadProject'),
  dropzone: $('dropzone'),
  videoList: $('videoList'),
  videoCount: $('videoCount'),
  btnCleanup: $('btnCleanup'),
  emptyState: $('emptyState'),
  workspaceBody: $('workspaceBody'),
  player: $('player'),
  playerArea: $('playerArea'),
  playerResize: $('playerResize'),
  speedSelect: $('speedSelect'),
  playerSegmentBadge: $('playerSegmentBadge'),
  subsOverlay: $('subsOverlay'),
  previewSubsCheck: $('previewSubsCheck'),
  sensSlider: $('sensSlider'),
  sensValue: $('sensValue'),
  useAudio: $('useAudio'),
  useScene: $('useScene'),
  useMotion: $('useMotion'),
  anEngineSelect: $('anEngineSelect'),
  btnReanalyze: $('btnReanalyze'),
  analysisStatus: $('analysisStatus'),
  aiControls: $('aiControls'),
  btnAiPause: $('btnAiPause'),
  btnAiResume: $('btnAiResume'),
  btnAiStop: $('btnAiStop'),
  tlMeta: $('tlMeta'),
  zoomSlider: $('zoomSlider'),
  btnZoomReset: $('btnZoomReset'),
  timelineCanvas: $('timelineCanvas'),
  segmentsLayer: $('segmentsLayer'),
  timelineAxis: $('timelineAxis'),
  segmentsList: $('segmentsList'),
  segEmpty: $('segEmpty'),
  btnAddSeg: $('btnAddSeg'),
  btnClearSegs: $('btnClearSegs'),
  msVideos: $('msVideos'),
  msSegments: $('msSegments'),
  msDuration: $('msDuration'),
  resSelect: $('resSelect'),
  engineSelect: $('engineSelect'),
  engineHint: $('engineHint'),
  fmtSelect: $('fmtSelect'),
  xfadeSelect: $('xfadeSelect'),
  transitionSelect: $('transitionSelect'),
  markerColorRow: $('markerColorRow'),
  markerColor: $('markerColor'),
  crfSlider: $('crfSlider'),
  crfValue: $('crfValue'),
  subsCheck: $('subsCheck'),
  montageQueue: $('montageQueue'),
  btnMontage: $('btnMontage'),
  jobProgress: $('jobProgress'),
  jobLabel: $('jobLabel'),
  jobFill: $('jobFill'),
  jobText: $('jobText'),
  montageResult: $('montageResult'),
  mrMeta: $('mrMeta'),
  btnDownload: $('btnDownload'),
  btnDropHint: $('btnDropHint'),
  importPath: $('importPath'),
  btnImport: $('btnImport'),
  helpModal: $('helpModal'),
  helpClose: $('helpClose'),
  speechPanel: $('speechPanel'),
  btnTranscribe: $('btnTranscribe'),
  speechProviderSelect: $('speechProviderSelect'),
  speechModelRow: $('speechModelRow'),
  speechModelSelect: $('speechModelSelect'),
  speechApiSettings: $('speechApiSettings'),
  speechApiEndpoint: $('speechApiEndpoint'),
  speechApiKey: $('speechApiKey'),
  speechApiModel: $('speechApiModel'),
  speechQuery: $('speechQuery'),
  btnSpeechSearch: $('btnSpeechSearch'),
  speechStatus: $('speechStatus'),
  speechResults: $('speechResults'),
  speechWordsBlock: $('speechWordsBlock'),
  showAllWordsCheck: $('showAllWordsCheck'),
  speechWords: $('speechWords'),
  speechDiarBlock: $('speechDiarBlock'),
  diarizeCheck: $('diarizeCheck'),
  speechDiarSettings: $('speechDiarSettings'),
  hfTokenInput: $('hfTokenInput'),
  minSpeakersInput: $('minSpeakersInput'),
  maxSpeakersInput: $('maxSpeakersInput'),
  speechDiarHint: $('speechDiarHint'),
  methodSelect: $('methodSelect'),
  aiSettings: $('aiSettings'),
  aiEndpoint: $('aiEndpoint'),
  aiKey: $('aiKey'),
  aiModel: $('aiModel'),
  aiInputSelect: $('aiInputSelect'),
  aiFrames: $('aiFrames'),
  aiChunkSec: $('aiChunkSec'),
  aiMaxSegments: $('aiMaxSegments'),
  aiSystemPrompt: $('aiSystemPrompt'),
  aiSpeechHint: $('aiSpeechHint'),
  segFilters: $('segFilters'),
  showSignals: $('showSignals'),
  showAi: $('showAi'),
};

const timeline = new Timeline({
  canvas: el.timelineCanvas,
  layer: el.segmentsLayer,
  axis: el.timelineAxis,
  onSeek: (t) => { el.player.currentTime = t; },
  onSegmentsChange: () => { renderSegments(); rebuildQueue(); },
  onSelect: (i) => selectSegment(i),
  onPreview: (i) => previewSegment(i),
  onZoomChange: (f) => {
    el.zoomSlider.value = String(Math.max(1, Math.round(f * 100) / 100));
  },
});

// ---------------------------------------------------------------
// Видео: активное
// ---------------------------------------------------------------
function activeVideo() {
  return state.videos.find((v) => v.id === state.activeId) || null;
}
function activeSegments() {
  return visibleSegments(activeVideo());
}

// ---------------------------------------------------------------
// Инициализация
// ---------------------------------------------------------------
async function init() {
  bindEvents();
  loadEngineInfo();
  loadSpeechSettings();
  loadAiSettings();
  syncTransitionUI();
  restorePlayerSize();
  loadPlayerSpeed();
  try {
    const { videos } = await API.videos();
    state.videos = videos;
    renderSidebar();
    if (videos.length) {
      await selectVideo(videos[0].id);
    } else {
      showEmpty();
    }
  } catch (e) {
    toast(`Не удалось связаться с сервером: ${e.message}`, 'error');
  }
  setInterval(pollJobs, 900);
}

async function loadEngineInfo() {
  try {
    state.engineInfo = await API.engine();
    configureEngineSelect();
    syncDiarUI();
  } catch { /* сервер ещё не готов — пропускаем */ }
}

function restorePlayerSize() {
  try {
    const saved = localStorage.getItem('playerHeight');
    if (saved && /^\d+px$/.test(saved)) {
      const vh = window.innerHeight;
      const h = Math.max(170, Math.min(vh - 65, parseInt(saved, 10)));
      el.playerArea.style.height = `${h}px`;
    }
  } catch { /* ignore */ }
}

// Скорость воспроизведения в плеере.
function applyPlaybackSpeed() {
  try { el.player.playbackRate = parseFloat(el.speedSelect.value) || 1; } catch { /* ignore */ }
}
function savePlayerSpeed() {
  try { localStorage.setItem('playerSpeed', el.speedSelect.value); } catch { /* ignore */ }
}
function loadPlayerSpeed() {
  try {
    const s = localStorage.getItem('playerSpeed');
    if (['0.3', '0.5', '1', '2', '4'].includes(s)) el.speedSelect.value = s;
  } catch { /* ignore */ }
  applyPlaybackSpeed();
}

// Настраиваем выпадающие списки движков под доступные возможности ffmpeg.
function configureEngineSelect() {
  if (!state.engineInfo) return;
  const caps = state.engineInfo.capabilities || {};
  const hw = caps.hw || {};
  const hwaccel = caps.hwaccel || [];
  const hints = [];
  for (const fam of Object.keys(hw)) {
    const vendors = hw[fam] || [];
    if (vendors.length) hints.push(`${fam.toUpperCase()}: ${vendors.join(', ')}`);
  }
  const sp = state.engineInfo.speech;
  if (sp && sp.available) {
    hints.push(`Речь: ${sp.loaded || sp.model || '—'}`);
    // Заполняем выбор модели распознавания речи.
    const opts = sp.options && sp.options.length ? sp.options : ['base'];
    if (!el.speechModelSelect.dataset.touched) {
      el.speechModelSelect.innerHTML = '';
      for (const m of opts) {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m;
        el.speechModelSelect.appendChild(o);
      }
      el.speechModelSelect.value = (sp.loaded || sp.model || 'base');
      el.speechModelSelect.addEventListener('change', () => {
        el.speechModelSelect.dataset.touched = '1';
      });
    }
    el.speechModelSelect.disabled = false;
  } else {
    el.speechModelSelect.disabled = true;
  }
  if (sp && sp.diarization) {
    hints.push(`Диаризация: ${sp.diar_device === 'cuda' ? 'GPU (CUDA)' : 'CPU'}`);
  }
  el.engineHint.textContent = hints.length ? `Доступно: ${hints.join(' · ')}` : 'Доступен только CPU';

  // Движок монтажа: сбрасываем на «Гибрид (авто)», если пользователь ещё не выбирал.
  if (!el.engineSelect.dataset.touched) el.engineSelect.value = 'auto';
  el.engineSelect.addEventListener('change', () => {
    el.engineSelect.dataset.touched = '1';
  }, { once: true });

  // Отключаем недоступные GPU-движки монтажа.
  const availableVendors = new Set(Object.values(hw).flat());
  for (const opt of el.engineSelect.options) {
    const val = opt.value;
    if (['auto', 'cpu'].includes(val)) continue;
    const ok = availableVendors.has(val);
    opt.disabled = !ok;
    if (!ok) opt.textContent = `${opt.textContent} (недоступно)`;
  }

  // Движок анализа: GPU доступен, если ffmpeg умеет аппаратное декодирование (NVDEC).
  const gpuOk = hwaccel.includes('cuda');
  const anGpu = el.anEngineSelect.querySelector('option[value="gpu"]');
  if (anGpu) {
    anGpu.disabled = !gpuOk;
    if (!gpuOk) anGpu.textContent = 'GPU (недоступно)';
  }
  if (!gpuOk && el.anEngineSelect.value === 'gpu') el.anEngineSelect.value = 'auto';
}

// ---------------------------------------------------------------
// События
// ---------------------------------------------------------------
function bindEvents() {
  el.btnUpload.addEventListener('click', () => el.fileInput.click());
  el.btnUploadEmpty.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', (e) => {
    uploadFiles([...e.target.files]);
    e.target.value = '';
  });

  for (const ev of ['dragenter', 'dragover']) {
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.add('drag');
    });
  }
  for (const ev of ['dragleave', 'drop']) {
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('drag');
    });
  }
  el.dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) uploadFiles([...e.dataTransfer.files]);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  el.sensSlider.addEventListener('input', () => {
    el.sensValue.textContent = parseFloat(el.sensSlider.value).toFixed(2);
  });
  el.btnReanalyze.addEventListener('click', () => startAnalysis(activeVideo()));
  el.btnAiPause.addEventListener('click', pauseActiveAnalysis);
  el.btnAiResume.addEventListener('click', resumeAnalysis);
  el.btnAiStop.addEventListener('click', stopActiveAnalysis);
  el.btnCleanup.addEventListener('click', cleanupLibrary);

  el.crfSlider.addEventListener('input', () => {
    el.crfValue.textContent = el.crfSlider.value;
  });
  el.transitionSelect.addEventListener('change', syncTransitionUI);

  el.btnAddSeg.addEventListener('click', addSegmentFromCurrent);
  el.btnClearSegs.addEventListener('click', clearSegments);

  el.player.addEventListener('timeupdate', () => {
    const v = activeVideo();
    if (v) timeline.setPlayhead(el.player.currentTime);
    updatePreviewSubs();
  });
  el.player.addEventListener('seeked', () => updatePreviewSubs());
  el.player.addEventListener('play', () => { timeline.showPlayhead(true); updatePreviewSubs(); });
  el.player.addEventListener('pause', () => timeline.showPlayhead(false));
  el.player.addEventListener('loadedmetadata', applyPlaybackSpeed);
  el.speedSelect.addEventListener('change', () => {
    applyPlaybackSpeed();
    savePlayerSpeed();
  });

  // Регулировка высоты окна предпросмотра (пропорции видео сохраняются).
  el.playerResize.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const area = el.playerArea;
    const startY = e.clientY;
    const startH = area.getBoundingClientRect().height;
    el.playerResize.classList.add('dragging');
    area.style.cursor = 'ns-resize';
    const onMove = (ev) => {
      const vh = window.innerHeight;
      let h = startH + (ev.clientY - startY);
      h = Math.max(170, Math.min(vh - 65, h));
      area.style.height = `${Math.round(h)}px`;
    };
    const onUp = () => {
      el.playerResize.classList.remove('dragging');
      area.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { localStorage.setItem('playerHeight', area.style.height); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  el.btnMontage.addEventListener('click', startMontage);

  // Зум таймлайна
  el.zoomSlider.addEventListener('input', () => {
    timeline.setZoomFactor(parseFloat(el.zoomSlider.value));
  });
  el.btnZoomReset.addEventListener('click', () => {
    el.zoomSlider.value = '1';
    timeline.zoomReset();
  });

  // Речь и поиск по словам
  el.btnTranscribe.addEventListener('click', () => startTranscribe(activeVideo()));
  el.btnSpeechSearch.addEventListener('click', () => doSpeechSearch(activeVideo()));
  el.speechQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSpeechSearch(activeVideo());
  });
  el.previewSubsCheck.addEventListener('change', () => updatePreviewSubs());
  el.showAllWordsCheck.addEventListener('change', () => {
    el.speechWords.hidden = !el.showAllWordsCheck.checked;
    saveSpeechSettings();
  });
  el.speechProviderSelect.addEventListener('change', () => {
    syncSpeechProviderUI();
    saveSpeechSettings();
  });
  for (const inp of [el.speechApiEndpoint, el.speechApiKey, el.speechApiModel]) {
    inp.addEventListener('input', saveSpeechSettings);
    inp.addEventListener('change', saveSpeechSettings);
  }
  el.diarizeCheck.addEventListener('change', () => {
    syncDiarUI();
    saveSpeechSettings();
  });
  for (const inp of [el.hfTokenInput, el.minSpeakersInput, el.maxSpeakersInput]) {
    inp.addEventListener('input', saveSpeechSettings);
    inp.addEventListener('change', saveSpeechSettings);
  }

  // ИИ-анализ
  el.methodSelect.addEventListener('change', () => { syncAiUI(); saveAiSettings(); });
  el.aiInputSelect.addEventListener('change', () => { syncAiUI(); saveAiSettings(); });
  for (const inp of [el.aiEndpoint, el.aiKey, el.aiModel, el.aiSystemPrompt]) {
    inp.addEventListener('input', saveAiSettings);
    inp.addEventListener('change', saveAiSettings);
  }
  el.aiFrames.addEventListener('change', saveAiSettings);
  el.aiChunkSec.addEventListener('change', saveAiSettings);
  el.showSignals.addEventListener('change', () => { saveAiSettings(); applySourceFilter(); });
  el.showAi.addEventListener('change', () => { saveAiSettings(); applySourceFilter(); });

  // Проекты
  el.btnSaveProject.addEventListener('click', saveProject);
  el.btnLoadProject.addEventListener('click', () => el.projectFile.click());
  el.projectFile.addEventListener('change', (e) => {
    if (e.target.files?.[0]) loadProject(e.target.files[0]);
    e.target.value = '';
  });

  el.btnDropHint.addEventListener('click', () => { el.helpModal.hidden = false; });
  el.helpClose.addEventListener('click', () => { el.helpModal.hidden = true; });
  el.helpModal.addEventListener('click', (e) => {
    if (e.target === el.helpModal) el.helpModal.hidden = true;
  });
  // Закрытие справки по Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.helpModal.hidden) el.helpModal.hidden = true;
  });

  // Импорт видео по пути с диска (без копирования)
  el.btnImport.addEventListener('click', importFromDisk);
  el.importPath.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') importFromDisk();
  });
}

// ---------------------------------------------------------------
// Загрузка файлов
// ---------------------------------------------------------------
function safePlay() {
  // play() может вернуть отклонённый промис (не готово/новый seek) —
  // не оставляем непойманное отклонение и не «зависаем» в pending-play.
  try {
    const p = el.player.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

function playAt(t) {
  // Переход к позиции и запуск. Если данные ещё не загружены (дальний seek
  // на большом видео), ждём события seeked — иначе play() остаётся pending
  // и нативная кнопка «play» перестаёт реагировать.
  el.player.currentTime = t;
  if (el.player.readyState >= 2) {
    safePlay();
  } else {
    el.player.addEventListener('seeked', safePlay, { once: true });
  }
}

async function importFromDisk() {
  const p = (el.importPath.value || '').trim();
  if (!p) return;
  const btn = el.btnImport;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const rec = await API.import(p);
    el.importPath.value = '';
    if (!state.videos.some((v) => v.id === rec.id)) state.videos.push(rec);
    renderSidebar();
    await selectVideo(rec.id);
    toast(`«${rec.name}» добавлен — файл не копировался`, 'success');
    if (!rec.analysis) startAnalysis(rec);
  } catch (e) {
    toast(`Не удалось добавить видео: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function uploadFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('video/')) {
      toast(`«${file.name}» — это не видео`, 'error');
      continue;
    }
    const toastEl = toastProgress(`Загрузка «${file.name}»…`);
    try {
      const rec = await API.upload(file, (p) => {
        toastEl.textContent = `Загрузка «${file.name}»… ${Math.round(p * 100)}%`;
      });
      toastEl.remove();
      state.videos.push(rec);
      renderSidebar();
      await selectVideo(rec.id);
      toast(`«${rec.name}» загружен (${formatSize(file.size)})`, 'success');
      startAnalysis(rec);
    } catch (e) {
      toastEl.remove();
      toast(`Не удалось загрузить «${file.name}»: ${e.message}`, 'error');
    }
  }
}

function toastProgress(text) {
  const wrap = document.getElementById('toasts');
  const el2 = document.createElement('div');
  el2.className = 'toast';
  el2.textContent = text;
  wrap.appendChild(el2);
  return el2;
}

// ---------------------------------------------------------------
// Анализ
// ---------------------------------------------------------------
function analyzeOptions() {
  const o = {
    sensitivity: parseFloat(el.sensSlider.value),
    min_len: 1.0,
    max_len: 45.0,
    use_audio: el.useAudio.checked,
    use_scene: el.useScene.checked,
    use_motion: el.useMotion.checked,
    engine: el.anEngineSelect.value,
    method: el.methodSelect.value,
  };
  if (o.method === 'ai') {
    o.ai_endpoint = el.aiEndpoint.value.trim();
    o.ai_api_key = el.aiKey.value.trim();
    o.ai_model = el.aiModel.value.trim() || 'gpt-4o-mini';
    o.ai_input = el.aiInputSelect.value;
    o.ai_frames = Math.max(1, Math.min(1000, parseInt(el.aiFrames.value, 10) || 10));
    o.ai_chunk_sec = Math.max(1, Math.min(3600, parseInt(el.aiChunkSec.value, 10) || 60));
    o.ai_max_segments = Math.max(0, Math.min(100, parseInt(el.aiMaxSegments.value, 10) || 0));
    o.ai_system_prompt = el.aiSystemPrompt.value.trim();
    o.ai_merge = true;
  }
  return o;
}

// Активная задача анализа для видео (если есть).
function analyzeJobFor(videoId) {
  for (const [jobId, meta] of state.jobs) {
    if (meta.kind === 'analyze' && meta.videoId === videoId) return { jobId, meta };
  }
  return null;
}

async function startAnalysis(video, opts = {}) {
  if (!video) return;
  const existing = analyzeJobFor(video.id);
  if (opts.resume) {
    // Продолжение: если приостановленная задача ещё жива в памяти — просто
    // снимаем с неё паузу (сервер продолжит с того же окна).
    if (existing) {
      try { await API.resumeJob(existing.jobId); }
      catch (e) { toast(`Не удалось продолжить: ${e.message}`, 'error'); return; }
      state.jobData.set(existing.jobId, {
        ...(state.jobData.get(existing.jobId) || {}),
        status: 'running',
      });
      renderAnalysisStatus();
      return;
    }
  } else if (existing) {
    return; // уже анализируется
  }
  const options = analyzeOptions();
  if (opts.resume) options.resume = true;
  try {
    const { job_id } = await API.analyze(video.id, options);
    state.jobs.set(job_id, { kind: 'analyze', videoId: video.id });
    const vi = state.videos.findIndex((v) => v.id === video.id);
    if (vi >= 0) {
      state.videos[vi]._analyzing = true;
      state.videos[vi]._aiPaused = false;
      state.videos[vi]._error = null;
    }
    renderSidebar();
    renderAnalysisStatus();
  } catch (e) {
    toast(`Ошибка запуска анализа: ${e.message}`, 'error');
  }
}

async function pauseActiveAnalysis() {
  const v = activeVideo();
  if (!v) return;
  const aj = analyzeJobFor(v.id);
  if (!aj) return;
  try {
    await API.pauseJob(aj.jobId);
    toast('ИИ-анализ на паузе — прогресс сохранён, можно продолжить', 'success');
  } catch (e) {
    toast(`Не удалось поставить на паузу: ${e.message}`, 'error');
  }
}

async function resumeAnalysis() {
  const v = activeVideo();
  if (!v) return;
  el.methodSelect.value = 'ai';
  syncAiUI();
  saveAiSettings();
  await startAnalysis(v, { resume: true });
}

async function stopActiveAnalysis() {
  const v = activeVideo();
  if (!v) return;
  const aj = analyzeJobFor(v.id);
  if (!aj) {
    // После перезапуска браузера job_id не известен — отменяем по видео.
    await cancelPausedAnalysis();
    return;
  }
  try {
    await API.stopJob(aj.jobId);
    toast('Анализ отменён', 'info');
  } catch (e) {
    toast(`Не удалось остановить: ${e.message}`, 'error');
  }
}

// Отмена приостановленного ИИ-анализа после перезапуска браузера (по видео,
// а не по задаче — task_id фронту не известен).
async function cancelPausedAnalysis() {
  const v = activeVideo();
  if (!v) return;
  try {
    await API.cancelAnalyze(v.id);
    const rec = await API.video(v.id);
    const vi = state.videos.findIndex((x) => x.id === v.id);
    if (vi >= 0) {
      state.videos[vi] = rec;
      state.videos[vi]._aiPaused = false;
    }
    renderSidebar();
    renderAnalysisStatus();
    toast('ИИ-анализ отменён', 'info');
  } catch (e) {
    toast(`Не удалось отменить: ${e.message}`, 'error');
  }
}

// Процент сохранённой паузы (для отображения в сайдбаре).
function pausedPercentFor(v) {
  if (v._aiPaused) {
    const aj = analyzeJobFor(v.id);
    const job = aj && state.jobData.get(aj.jobId);
    if (job) return job.progress || 0;
  }
  if (v.ai_resume && v.ai_resume.progress != null) return v.ai_resume.progress;
  return 0;
}

// Показ/скрытие кнопок управления ИИ-анализом.
// mode: none | running (⏸+⏹) | paused (▶+⏹) | resume-only (▶+⏹)
function setAiControls(mode) {
  const ai = el.methodSelect.value === 'ai';
  el.aiControls.hidden = !ai || mode === 'none';
  el.btnAiPause.hidden = mode !== 'running';
  el.btnAiResume.hidden = !(mode === 'paused' || mode === 'resume-only');
  el.btnAiStop.hidden = !(mode === 'running' || mode === 'paused' || mode === 'resume-only');
}

// Детали прогресса ИИ-анализа: просмотрено времени и найдено моментов.
// posSec — до какой секунды видео просмотрено, duration — длительность ролика,
// segCount — сколько моментов уже выбрано. Возвращает " · … · …" или "".
function aiProgressDetail(posSec, duration, segCount) {
  const parts = [];
  if (posSec != null && Number.isFinite(posSec) && duration) {
    const pos = Math.max(0, Math.min(posSec, duration));
    parts.push(`просмотрено ${formatTime(pos)}/${formatTime(duration)}`);
  }
  if (segCount != null && Number.isFinite(segCount)) {
    parts.push(`моментов: ${segCount}`);
  }
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

// Статус анализа активного видео: прогресс, пауза, баннер «продолжить после
// перезапуска» (ai_resume приходит с сервера из сохранённой контрольной точки).
function renderAnalysisStatus() {
  const v = activeVideo();
  if (!v) {
    el.analysisStatus.textContent = '';
    setAiControls('none');
    return;
  }
  const aj = analyzeJobFor(v.id);
  if (aj) {
    const job = state.jobData.get(aj.jobId);
    const pct = Math.round((job && job.progress || 0) * 100);
    const det = aiProgressDetail(job && job.ai_pos, v.info.duration, job && job.ai_segments);
    if (job && job.status === 'paused') {
      el.analysisStatus.innerHTML = `⏸ ИИ-анализ на паузе: <b>${pct}%</b>${det}`;
      setAiControls('paused');
      return;
    }
    if (job) {
      el.analysisStatus.innerHTML = `<span class="spin">◌</span> ИИ-анализ <b>${pct}%</b>${det}`;
      setAiControls('running');
      return;
    }
  }
  // Активной задачи нет — но есть сохранённая на сервере пауза (пережила
  // перезапуск сервера или обновление страницы). Продолжить можно зелёной
  // кнопкой ▶, отменить — ⏹ (отменяет и удаляет сохранённую паузу).
  if (v.ai_resume) {
    const pct = Math.round((v.ai_resume.progress || 0) * 100);
    const det = aiProgressDetail(v.ai_resume.pos, v.info.duration, v.ai_resume.segments);
    el.analysisStatus.innerHTML = `⏸ ИИ-анализ на паузе: <b>${pct}%</b>${det}`;
    setAiControls('resume-only');
    return;
  }
  if (v._analyzing) {
    el.analysisStatus.innerHTML = '<span class="spin">◌</span> Анализ…';
    setAiControls('none');
    return;
  }
  if (v._error) {
    el.analysisStatus.textContent = v._error === 'Анализ отменён' ? 'Анализ отменён' : 'Ошибка анализа';
    setAiControls('none');
    return;
  }
  if (v.analysis) {
    const nAi = v.analysis.segments.filter((s) => segSource(s) === 'ai').length;
    el.analysisStatus.textContent = nAi
      ? `${v.analysis.segments.length} моментов (${nAi} ИИ)`
      : `${v.analysis.segments.length} моментов`;
    setAiControls('none');
    return;
  }
  el.analysisStatus.textContent = 'Анализ ещё не выполнен';
  setAiControls('none');
}

function updateVideoProgress(videoId, job) {
  const vi = state.videos.findIndex((v) => v.id === videoId);
  if (vi < 0) return;
  const item = document.querySelector(`.video-item[data-id="${CSS.escape(videoId)}"]`);
  const fill = item?.querySelector('.pm-fill');
  if (fill) fill.style.width = `${Math.round(job.progress * 100)}%`;
  if (job.status === 'paused') return; // при паузе текст рисует renderSidebar
  const st = item?.querySelector('.video-status');
  if (st) {
    const video = state.videos[vi];
    st.textContent = job.kind === 'analyze'
      ? `Анализ… ${Math.round(job.progress * 100)}%${aiProgressDetail(job.ai_pos, video && video.info && video.info.duration, job.ai_segments)}`
      : '';
  }
}

async function pollJobs() {
  const entries = [...state.jobs.entries()];
  if (!entries.length) return;
  for (const [jobId, meta] of entries) {
    let job;
    try { job = await API.job(jobId); } catch { continue; }

    if (meta.kind === 'analyze') {
      state.jobData.set(jobId, job);
      updateVideoProgress(meta.videoId, job);
      const vi = state.videos.findIndex((v) => v.id === meta.videoId);
      if (vi < 0) continue;
      if (job.status === 'done') {
        state.jobs.delete(jobId);
        state.jobData.delete(jobId);
        state.videos[vi]._analyzing = false;
        state.videos[vi]._aiPaused = false;
        try {
          const rec = await API.video(meta.videoId);
          state.videos[vi] = rec;
        } catch { /* ignore */ }
        renderSidebar();
        rebuildQueue();
        if (state.activeId === meta.videoId) {
          renderTimeline();
          renderSegments();
          renderAnalysisStatus();
          const av = activeVideo();
          const n = av && av.analysis ? av.analysis.segments.length : 0;
          toast(`Анализ готов: найдено моментов — ${n}`, 'success');
        }
      } else if (job.status === 'error') {
        state.jobs.delete(jobId);
        state.jobData.delete(jobId);
        state.videos[vi]._analyzing = false;
        state.videos[vi]._aiPaused = false;
        if (job.error !== 'Анализ отменён') state.videos[vi]._error = job.error;
        renderSidebar();
        if (state.activeId === meta.videoId) {
          renderAnalysisStatus();
          if (job.error === 'Анализ отменён') toast('Анализ отменён', 'info');
          else toast(`Ошибка анализа: ${job.error}`, 'error');
        }
      } else if (job.status === 'paused') {
        state.videos[vi]._analyzing = true;
        if (!state.videos[vi]._aiPaused) {
          state.videos[vi]._aiPaused = true;
          renderSidebar();
        }
        if (state.activeId === meta.videoId) renderAnalysisStatus();
      } else {
        // running
        if (state.videos[vi]._aiPaused) {
          state.videos[vi]._aiPaused = false;
          renderSidebar();
        }
        if (state.activeId === meta.videoId) renderAnalysisStatus();
      }
    } else if (meta.kind === 'montage') {
      updateMontageProgress(job);
      if (job.status === 'done') {
        state.jobs.delete(jobId);
        onMontageDone(job, meta.single);
      } else if (job.status === 'error') {
        state.jobs.delete(jobId);
        el.jobProgress.hidden = true;
        toast(`Ошибка монтажа: ${job.error}`, 'error');
      }
    } else if (meta.kind === 'transcribe') {
      if (el.speechStatus) {
        el.speechStatus.innerHTML = `<span class="spin">◌</span> ${job.message || 'Распознавание…'}`;
      }
      if (job.status === 'done') {
        state.jobs.delete(jobId);
        const vi = state.videos.findIndex((v) => v.id === meta.videoId);
        if (vi >= 0) {
          try {
            const rec = await API.video(meta.videoId);
            state.videos[vi] = rec;
          } catch { /* ignore */ }
        }
        state.speechCache[meta.videoId] = null;  // сбрасываем кэш слов
        renderSidebar();
        updateSpeechPanel(activeVideo());
        loadWords(activeVideo());
        updatePreviewSubs();
        loadEngineInfo();   // обновляем «Речь: <модель>» (загруженная модель могла смениться)
        toast('Речь распознана — можно искать по словам', 'success');
      } else if (job.status === 'error') {
        state.jobs.delete(jobId);
        if (el.speechStatus) el.speechStatus.textContent = 'Ошибка распознавания';
        toast(`Ошибка распознавания: ${job.error}`, 'error');
      }
    }
  }
}

// ---------------------------------------------------------------
// Сайдбар
// ---------------------------------------------------------------
function renderSidebar() {
  el.videoCount.textContent = state.videos.length ? `(${state.videos.length})` : '';
  el.videoList.innerHTML = '';
  for (const v of state.videos) {
    const item = document.createElement('div');
    item.className = 'video-item' + (v.id === state.activeId ? ' active' : '');
    item.dataset.id = v.id;

    const thumb = document.createElement('div');
    thumb.className = 'video-thumb';
    if (v.has_thumb) {
      const img = document.createElement('img');
      img.className = 'video-thumb';
      img.src = API.thumbUrl(v.id);
      img.alt = '';
      thumb.replaceWith(img);
      item.appendChild(img);
    } else {
      thumb.textContent = '🎞️';
      item.appendChild(thumb);
    }

    const meta = document.createElement('div');
    meta.className = 'video-meta';

    const name = document.createElement('div');
    name.className = 'video-name';
    name.textContent = v.name;
    if (v.external) {
      const b = document.createElement('span');
      b.className = 'video-badge';
      b.textContent = 'с диска';
      b.title = 'Файл не копировался в папку приложения (читается по пути) — при удалении записи исходник сохранится';
      name.appendChild(b);
    }
    if (v.speech_diarized && v.speech_speakers) {
      const b = document.createElement('span');
      b.className = 'video-badge diar';
      b.textContent = `🎭 спикеры: ${v.speech_speakers}`;
      b.title = 'Речь разделена по голосам (диаризация)';
      name.appendChild(b);
    }
    meta.appendChild(name);

    const info = document.createElement('div');
    info.className = 'video-info';
    const dur = formatTime(v.info.duration);
    info.textContent = `${dur} · ${v.info.width}×${v.info.height}` + (v.info.has_audio ? ' · 🔉' : '');
    meta.appendChild(info);

    if (v._analyzing) {
      if (v._aiPaused) {
        // ИИ-анализ приостановлен (задача жива — пауза активна).
        const st = document.createElement('div');
        st.className = 'video-status paused';
        const aj = analyzeJobFor(v.id);
        const job = aj && state.jobData.get(aj.jobId);
        const det = aiProgressDetail(job && job.ai_pos, v.info.duration, job && job.ai_segments);
        st.textContent = `⏸ ИИ-анализ на паузе (${Math.round(pausedPercentFor(v) * 100)}%)${det}`;
        meta.appendChild(st);
      } else {
        const st = document.createElement('div');
        st.className = 'video-status';
        st.textContent = 'Анализ…';
        meta.appendChild(st);
        const pm = document.createElement('div');
        pm.className = 'progress-mini';
        pm.innerHTML = '<div class="pm-fill"></div>';
        meta.appendChild(pm);
      }
    } else if (v.ai_resume) {
      // Пауза сохранена на сервере (пережила перезапуск) — активной задачи нет.
      const st = document.createElement('div');
      st.className = 'video-status paused';
      const det = aiProgressDetail(v.ai_resume.pos, v.info.duration, v.ai_resume.segments);
      st.textContent = `⏸ ИИ-анализ на паузе (${Math.round(pausedPercentFor(v) * 100)}%)${det}`;
      meta.appendChild(st);
    } else if (v._error) {
      const st = document.createElement('div');
      st.className = 'video-status error';
      st.textContent = 'Ошибка: ' + v._error;
      meta.appendChild(st);
    } else if (v.analysis) {
      const st = document.createElement('div');
      st.className = 'video-status';
      const nAi = v.analysis.segments.filter((s) => segSource(s) === 'ai').length;
      st.textContent = nAi
        ? `${v.analysis.segments.length} моментов (${nAi} ИИ)`
        : `${v.analysis.segments.length} моментов`;
      meta.appendChild(st);
    }

    item.appendChild(meta);

    // Очистка найденных моментов этого видео (видна при наведении).
    if (v.analysis && v.analysis.segments && v.analysis.segments.length) {
      const cl = document.createElement('button');
      cl.className = 'video-clear';
      cl.title = 'Очистить найденные моменты этого видео';
      cl.textContent = '⌫';
      cl.addEventListener('click', async (e) => {
        e.stopPropagation();
        await clearVideoSegments(v.id);
      });
      item.appendChild(cl);
    }

    const rm = document.createElement('button');
    rm.className = 'video-remove';
    rm.title = 'Удалить видео';
    rm.textContent = '✕';
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeVideo(v.id);
    });
    item.appendChild(rm);

    item.addEventListener('click', () => selectVideo(v.id));
    el.videoList.appendChild(item);
  }
}

async function removeVideo(id) {
  // Закрываем стрим/плеер ДО удаления, иначе файл на Windows остаётся занятым.
  if (state.activeId === id) {
    el.player.pause();
    el.player.removeAttribute('src');
    el.player.load();
  }
  try {
    await API.deleteVideo(id);
  } catch (e) {
    toast(`Не удалось удалить: ${e.message}`, 'error');
    return;
  }
  const idx = state.videos.findIndex((v) => v.id === id);
  if (idx >= 0) state.videos.splice(idx, 1);
  if (state.activeId === id) {
    state.activeId = null;
    timeline.clear();
    renderSegments();
    rebuildQueue();
    if (state.videos.length) await selectVideo(state.videos[0].id);
    else showEmpty();
  }
  renderSidebar();
  rebuildQueue();
}

// Очистка библиотеки: убрать из списка ВСЕ видео. Загруженные через UI
// удаляются вместе с файлами/данными/кешем, а у видео «с диска» удаляется
// только запись — оригинальный файл на диске остаётся.
async function cleanupLibrary() {
  if (!window.confirm('Убрать все видео из библиотеки?\n\nЗагруженные через UI видео будут удалены вместе с данными и кешем.\nВидео «с диска» будут убраны из списка, но их файлы на диске останутся.')) return;
  const av = activeVideo();
  // Активное видео будет убрано из списка; освобождаем файл от стрима плеера,
  // иначе Windows держит его открытым (и загруженное нельзя будет удалить).
  if (av) {
    el.player.pause();
    el.player.removeAttribute('src');
    el.player.load();
  }
  try {
    const res = await API.cleanupVideos();
    const { videos } = await API.videos();
    state.videos = videos;
    state.activeId = null;
    state.jobs.clear();
    state.jobData.clear();
    timeline.clear();
    renderSidebar();
    rebuildQueue();
    if (videos.length) await selectVideo(videos[0].id);
    else showEmpty();
    const n = res && res.removed_count != null
      ? res.removed_count
      : (res && res.removed ? res.removed.length : 0);
    toast(n ? `Библиотека очищена: убрано видео — ${n}` : 'Список уже пуст',
          n ? 'success' : 'info');
  } catch (e) {
    toast(`Не удалось очистить: ${e.message}`, 'error');
  }
}

function showEmpty() {
  el.emptyState.hidden = false;
  el.workspaceBody.hidden = true;
  el.btnReanalyze.disabled = true;
  timeline.clearWords();
  renderAnalysisStatus();
}

async function selectVideo(id) {
  state.activeId = id;
  const v = state.videos.find((x) => x.id === id);
  if (!v) return;

  el.emptyState.hidden = true;
  el.workspaceBody.hidden = false;
  el.btnReanalyze.disabled = false;

  // сохраняем позицию активного сегмента
  el.player.pause();
  el.player.src = API.streamUrl(id);
  el.player.load();
  applyPlaybackSpeed();

  renderSidebar();
  renderTimeline();
  renderSegments();
  rebuildQueue();
  el.zoomSlider.value = '1';   // новый ролик — без зума
  timeline.zoomReset();
  loadWords(v);
  updatePreviewSubs();

  renderAnalysisStatus();

  updateSpeechPanel(v);
}

// ---------------------------------------------------------------
// Поиск по словам (распознавание речи)
// ---------------------------------------------------------------
function updateSpeechPanel(v) {
  if (!v) {
    el.speechPanel.hidden = true;
    return;
  }
  el.speechPanel.hidden = false;
  el.speechResults.innerHTML = '';
  state.speechResults = [];
  el.speechWordsBlock.hidden = !v.has_speech;
  el.speechWords.hidden = !el.showAllWordsCheck.checked;
  if (v._transcribing) {
    el.btnTranscribe.disabled = true;
    el.speechProviderSelect.disabled = true;
    el.speechModelSelect.disabled = true;
    el.speechApiEndpoint.disabled = true;
    el.speechApiKey.disabled = true;
    el.speechApiModel.disabled = true;
    el.speechQuery.disabled = true;
    el.btnSpeechSearch.disabled = true;
    el.diarizeCheck.disabled = true;
    el.hfTokenInput.disabled = true;
    el.minSpeakersInput.disabled = true;
    el.maxSpeakersInput.disabled = true;
    el.speechStatus.innerHTML = '<span class="spin">◌</span> Распознавание речи…';
    return;
  }
  el.btnTranscribe.disabled = false;
  el.speechProviderSelect.disabled = false;
  el.diarizeCheck.disabled = false;
  el.hfTokenInput.disabled = false;
  el.minSpeakersInput.disabled = false;
  el.maxSpeakersInput.disabled = false;
  syncSpeechProviderUI();
  syncDiarUI();
  if (v.has_speech) {
    el.speechQuery.disabled = false;
    el.btnSpeechSearch.disabled = false;
    const lang = v.speech_lang ? ` · язык: ${v.speech_lang}` : '';
    let msg = `Распознано слов: ${v.speech_words}${lang}.`;
    if (v.speech_diarized && v.speech_speakers) {
      msg = `Распознано слов: ${v.speech_words}${lang} · 🎭 спикеров: ${v.speech_speakers}. Цвет слов на таймлайне — говорящий.`;
    } else if (v.speech_diar_error) {
      msg = `Распознано слов: ${v.speech_words}${lang} · ⚠ разделение по голосам не выполнено: ${v.speech_diar_error}`;
    } else if (el.diarizeCheck.checked) {
      msg = `Распознано слов: ${v.speech_words}${lang} · включено разделение по голосам — нажмите «🎙 Распознать речь», чтобы разметить спикеров.`;
    }
    el.speechStatus.textContent = `${msg} Введите слово для поиска.`;
  } else {
    el.speechQuery.disabled = true;
    el.btnSpeechSearch.disabled = true;
    el.speechStatus.textContent = 'Речь не распознана. Нажмите «🎙 Распознать речь» (модель скачается при первом запуске).';
  }
}

// Источник распознавания: локальная модель или внешний API.
function syncSpeechProviderUI() {
  const api = el.speechProviderSelect.value === 'api';
  el.speechApiSettings.hidden = !api;
  el.speechModelRow.hidden = api;
}

// Блок «Разделять по голосам»: подсказки о pyannote.audio и токене HF.
function syncDiarUI() {
  const on = el.diarizeCheck.checked;
  el.speechDiarSettings.hidden = !on;
  // Подсказки показываем только когда функция включена.
  if (!on) {
    el.speechDiarHint.hidden = true;
    return;
  }
  const avail = !!(state.engineInfo && state.engineInfo.speech
                   && state.engineInfo.speech.diarization);
  if (!avail) {
    el.speechDiarHint.textContent =
      '⚠ Не установлен pyannote.audio: pip install pyannote.audio torch torchaudio';
    el.speechDiarHint.hidden = false;
  } else if (!el.hfTokenInput.value.trim()) {
    el.speechDiarHint.textContent =
      'Нужен токен Hugging Face (huggingface.co/settings/tokens) и принятые условия модели pyannote/speaker-diarization-3.1';
    el.speechDiarHint.hidden = false;
  } else {
    el.speechDiarHint.hidden = true;
  }
}

function loadSpeechSettings() {
  try {
    const prov = localStorage.getItem('speechProvider');
    if (prov === 'local' || prov === 'api') el.speechProviderSelect.value = prov;
    el.speechApiEndpoint.value = localStorage.getItem('speechApiEndpoint') || '';
    el.speechApiKey.value = localStorage.getItem('speechApiKey') || '';
    el.speechApiModel.value = localStorage.getItem('speechApiModel') || '';
    if (localStorage.getItem('showAllWords') === '0') el.showAllWordsCheck.checked = false;
    el.diarizeCheck.checked = localStorage.getItem('diarize') === '1';
    el.hfTokenInput.value = localStorage.getItem('hfToken') || '';
    el.minSpeakersInput.value = localStorage.getItem('diarMin') || '';
    el.maxSpeakersInput.value = localStorage.getItem('diarMax') || '';
  } catch { /* ignore */ }
  syncSpeechProviderUI();
  syncDiarUI();
  el.speechWords.hidden = !el.showAllWordsCheck.checked;
}

function saveSpeechSettings() {
  try {
    localStorage.setItem('speechProvider', el.speechProviderSelect.value);
    localStorage.setItem('speechApiEndpoint', el.speechApiEndpoint.value.trim());
    localStorage.setItem('speechApiKey', el.speechApiKey.value.trim());
    localStorage.setItem('speechApiModel', el.speechApiModel.value.trim());
    localStorage.setItem('showAllWords', el.showAllWordsCheck.checked ? '1' : '0');
    localStorage.setItem('diarize', el.diarizeCheck.checked ? '1' : '0');
    localStorage.setItem('hfToken', el.hfTokenInput.value.trim());
    localStorage.setItem('diarMin', el.minSpeakersInput.value.trim());
    localStorage.setItem('diarMax', el.maxSpeakersInput.value.trim());
  } catch { /* ignore */ }
}

// ---------- Настройки ИИ-анализа (localStorage; ключ только в браузере) ----------
function loadAiSettings() {
  try {
    const m = localStorage.getItem('aiMethod');
    if (m === 'signals' || m === 'ai') el.methodSelect.value = m;
    el.aiEndpoint.value = localStorage.getItem('aiEndpoint') || '';
    el.aiKey.value = localStorage.getItem('aiKey') || '';
    el.aiModel.value = localStorage.getItem('aiModel') || '';
    const input = localStorage.getItem('aiInput');
    if (['frames', 'frames_speech', 'speech'].includes(input)) el.aiInputSelect.value = input;
    const fr = parseInt(localStorage.getItem('aiFrames'), 10);
    if (fr >= 1 && fr <= 1000) el.aiFrames.value = String(fr);
    const cs = parseInt(localStorage.getItem('aiChunkSec'), 10);
    if (cs >= 1 && cs <= 3600) el.aiChunkSec.value = String(cs);
    const ms = parseInt(localStorage.getItem('aiMaxSegments'), 10);
    if (ms >= 0 && ms <= 100) el.aiMaxSegments.value = String(ms);
    el.aiSystemPrompt.value = localStorage.getItem('aiSystemPrompt') || '';
    if (localStorage.getItem('showSignals') === '0') el.showSignals.checked = false;
    if (localStorage.getItem('showAi') === '0') el.showAi.checked = false;
  } catch { /* ignore */ }
  syncAiUI();
}

function saveAiSettings() {
  try {
    localStorage.setItem('aiMethod', el.methodSelect.value);
    localStorage.setItem('aiEndpoint', el.aiEndpoint.value.trim());
    localStorage.setItem('aiKey', el.aiKey.value.trim());
    localStorage.setItem('aiModel', el.aiModel.value.trim());
    localStorage.setItem('aiInput', el.aiInputSelect.value);
    localStorage.setItem('aiFrames', el.aiFrames.value);
    localStorage.setItem('aiChunkSec', el.aiChunkSec.value);
    localStorage.setItem('aiMaxSegments', el.aiMaxSegments.value);
    localStorage.setItem('aiSystemPrompt', el.aiSystemPrompt.value);
    localStorage.setItem('showSignals', el.showSignals.checked ? '1' : '0');
    localStorage.setItem('showAi', el.showAi.checked ? '1' : '0');
  } catch { /* ignore */ }
}

function syncAiUI() {
  const ai = el.methodSelect.value === 'ai';
  el.aiSettings.hidden = !ai;
  const needsSpeech = ai && (el.aiInputSelect.value === 'frames_speech' || el.aiInputSelect.value === 'speech');
  el.aiSpeechHint.hidden = !needsSpeech;
}

// Показываем выбор цвета плашки только для перехода «Плашка-маркер».
function syncTransitionUI() {
  el.markerColorRow.hidden = el.transitionSelect.value !== 'marker';
}

// ---------- Фильтр источников моментов (Алгоритм / ИИ) ----------
function segSource(seg) {
  return seg && seg.source === 'ai' ? 'ai' : 'signals';
}

function sourceVisible(seg) {
  return segSource(seg) === 'ai' ? el.showAi.checked : el.showSignals.checked;
}

function visibleSegments(v) {
  if (!v || !v.analysis) return [];
  return v.analysis.segments.filter(sourceVisible);
}

function updateSegFilters() {
  const v = activeVideo();
  const hasAi = !!(v && v.analysis && v.analysis.segments.some((s) => segSource(s) === 'ai'));
  el.segFilters.hidden = !hasAi;
}

function applySourceFilter() {
  renderTimeline();
  renderSegments();
  rebuildQueue();
}

// Подгружает слова распознанной речи и показывает их метками на таймлайне.
async function loadWords(v) {
  if (!v || !v.has_speech) {
    timeline.clearWords();
    renderAllWords(v);
    return;
  }
  if (state.speechCache[v.id]) {
    const sp = state.speechCache[v.id];
    timeline.setWords(sp.words || []);
    renderAllWords(v);
    return;
  }
  try {
    const sp = await API.videoSpeech(v.id);
    state.speechCache[v.id] = sp;   // полный объект: слова + спикеры
    timeline.setWords(sp.words || []);
    renderAllWords(v);
    updatePreviewSubs();
  } catch { /* ignore */ }
}

// Список всех распознанных слов рядом с панелью распознавания.
function renderAllWords(v) {
  const box = el.speechWords;
  box.innerHTML = '';
  if (!v || !v.has_speech) return;
  const sp = state.speechCache[v.id];
  const words = (sp && sp.words) || [];
  const speakers = (sp && sp.speakers) || [];
  if (!words.length) return;
  const frag = document.createDocumentFragment();
  for (const w of words) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'word-chip';
    const spkIdx = w.speaker ? speakers.indexOf(w.speaker) : -1;
    if (spkIdx >= 0) {
      const dot = document.createElement('span');
      dot.className = 'word-chip-dot';
      dot.style.background = speakerColor(spkIdx);
      chip.appendChild(dot);
    }
    chip.appendChild(document.createTextNode(`${formatTime(w.start)} ${w.word}`));
    chip.title = `${w.speaker ? w.speaker + ' · ' : ''}${w.word} · ${formatTime(w.start)}–${formatTime(w.end)}`;
    chip.addEventListener('click', () => {
      playAt(w.start);
      el.playerSegmentBadge.hidden = false;
      el.playerSegmentBadge.textContent = `«${w.word}»: ${formatTime(w.start)}`;
    });
    frag.appendChild(chip);
  }
  box.appendChild(frag);
}

// Субтитры при просмотре: показывает текущую распознанную фразу на видео.
function updatePreviewSubs() {
  const ov = el.subsOverlay;
  if (!el.previewSubsCheck || !el.previewSubsCheck.checked) { ov.hidden = true; return; }
  const v = activeVideo();
  if (!v || !v.has_speech) { ov.hidden = true; return; }
  const sp = state.speechCache[v.id];
  const words = (sp && sp.words) || [];
  const speakers = (sp && sp.speakers) || [];
  if (!words.length) { ov.hidden = true; return; }
  const t = el.player.currentTime;
  // ищем слово, в которое попадает текущее время
  let i = 0;
  while (i < words.length && words[i].end < t) i++;
  if (i >= words.length || words[i].start > t) { ov.hidden = true; return; }
  // собираем фразу: пока паузы < 0.4с и общая длина < 3с
  const parts = [words[i].word];
  let j = i + 1;
  while (j < words.length) {
    const gap = words[j].start - words[j - 1].end;
    const span = words[j].end - words[i].start;
    if (gap > 0.4 || span > 3.0) break;
    parts.push(words[j].word);
    j++;
  }
  ov.textContent = '';
  const lead = words[i];
  if (lead.speaker) {
    const idx = speakers.indexOf(lead.speaker);
    const lbl = document.createElement('span');
    lbl.style.color = idx >= 0 ? speakerColor(idx) : speakerColorByName(lead.speaker);
    lbl.textContent = `${lead.speaker}: `;
    ov.appendChild(lbl);
  }
  ov.appendChild(document.createTextNode(parts.join(' ')));
  ov.hidden = false;
}

async function startTranscribe(v) {
  if (!v) return;
  if (v._transcribing) return;
  const prev = [...state.jobs.values()].find((j) => j.kind === 'transcribe' && j.videoId === v.id);
  if (prev) return;
  const engine = el.engineSelect.value;
  const provider = el.speechProviderSelect.value;
  let opts = { engine, provider };
  if (provider === 'api') {
    opts.endpoint = el.speechApiEndpoint.value.trim();
    opts.api_key = el.speechApiKey.value.trim();
    opts.model = el.speechApiModel.value.trim() || 'whisper-1';
  } else {
    opts.model = el.speechModelSelect.value || 'base';
  }
  // Разделение по голосам (диаризация).
  opts.diarize = el.diarizeCheck.checked;
  if (opts.diarize) {
    opts.hf_token = el.hfTokenInput.value.trim() || null;
    if (!opts.hf_token) {
      toast('Для разделения по голосам укажите токен Hugging Face (поле в панели распознавания)', 'error');
      syncDiarUI();
      return;
    }
    const mn = parseInt(el.minSpeakersInput.value, 10);
    const mx = parseInt(el.maxSpeakersInput.value, 10);
    if (mn > 1) opts.min_speakers = mn;
    if (mx > 1) opts.max_speakers = mx;
  }
  try {
    const { job_id } = await API.transcribe(v.id, opts);
    const vi = state.videos.findIndex((x) => x.id === v.id);
    if (vi >= 0) state.videos[vi]._transcribing = true;
    state.jobs.set(job_id, { kind: 'transcribe', videoId: v.id });
    updateSpeechPanel(v);
  } catch (e) {
    toast(`Не удалось запустить распознавание: ${e.message}`, 'error');
  }
}

async function doSpeechSearch(v) {
  if (!v || !v.has_speech) return;
  const q = el.speechQuery.value.trim();
  if (!q) return;
  el.speechStatus.textContent = 'Поиск…';
  try {
    const { matches } = await API.search(v.id, q);
    state.speechResults = matches;
    renderSpeechResults(matches, q);
  } catch (e) {
    el.speechStatus.textContent = 'Ошибка поиска';
    toast(`Ошибка поиска: ${e.message}`, 'error');
  }
}

function renderSpeechResults(matches, q) {
  el.speechResults.innerHTML = '';
  if (!matches.length) {
    const d = document.createElement('div');
    d.className = 'sp-empty';
    d.textContent = `Слово «${q}» не найдено.`;
    el.speechResults.appendChild(d);
    el.speechStatus.textContent = `Найдено: 0`;
    return;
  }
  el.speechStatus.textContent = `Найдено: ${matches.length}`;
  matches.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'sp-result';

    const word = document.createElement('span');
    word.className = 'sp-word';
    word.textContent = m.word;
    row.appendChild(word);

    const time = document.createElement('span');
    time.className = 'sp-time';
    time.textContent = formatTime(m.start);
    row.appendChild(time);

    if (m.speaker) {
      const sp = document.createElement('span');
      sp.className = 'sp-speaker';
      sp.textContent = m.speaker;
      sp.style.color = speakerColorByName(m.speaker);
      row.appendChild(sp);
    }

    const ctx = document.createElement('span');
    ctx.className = 'sp-ctx';
    const escaped = m.context.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const hl = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ctx.innerHTML = escaped.replace(new RegExp(`(${hl})`, 'ig'), '<b>$1</b>');
    row.appendChild(ctx);

    const play = document.createElement('button');
    play.className = 'icon-btn play';
    play.textContent = '▶';
    play.title = 'Посмотреть';
    play.addEventListener('click', (e) => {
      e.stopPropagation();
      playAt(m.start);
      el.playerSegmentBadge.hidden = false;
      el.playerSegmentBadge.textContent = `Слово «${m.word}»: ${formatTime(m.start)}`;
    });
    row.appendChild(play);

    const add = document.createElement('button');
    add.className = 'icon-btn';
    add.textContent = '＋';
    add.title = 'Добавить в моменты';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      addSegmentFromWord(m);
      toast(`Добавлено: «${m.word}» в ${formatTime(m.start)}`, 'success');
    });
    row.appendChild(add);

    el.speechResults.appendChild(row);
  });
}

function addSegmentFromWord(m) {
  const v = activeVideo();
  if (!v) return;
  if (!v.analysis) v.analysis = { segments: [], heatmap: [], threshold: 0, info: v.info };
  const pad = 1.0;
  const s = Math.max(0, m.start - pad);
  const e = Math.min(v.info.duration, m.end + pad);
  v.analysis.segments.push({ start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100, score: 0, peak: 0, enabled: true });
  v.analysis.segments.sort((a, b) => a.start - b.start);
  renderTimeline();
  renderSegments();
  rebuildQueue();
}

// ---------------------------------------------------------------
// Таймлайн и сегменты
// ---------------------------------------------------------------
function renderTimeline() {
  const v = activeVideo();
  updateSegFilters();
  if (!v) {
    timeline.clear();
    timeline.clearWords();
    el.tlMeta.textContent = '';
    return;
  }
  if (!v.analysis) {
    if (v.has_speech) {
      // Слова должны быть видны даже без анализа/моментов — «прямой» таймлайн.
      timeline.setData({
        duration: v.info.duration,
        heat: [],
        threshold: 0,
        segments: [],
      });
      el.tlMeta.textContent = `${formatTime(v.info.duration)} · речь распознана`;
    } else {
      timeline.clear();
      timeline.clearWords();
      el.tlMeta.textContent = `${formatTime(v.info.duration)} · нет анализа`;
    }
    return;
  }
  timeline.setData({
    duration: v.info.duration,
    heat: v.analysis.heatmap,
    threshold: v.analysis.threshold,
    segments: visibleSegments(v),
  });
  const n = v.analysis.segments.length;
  const nAi = v.analysis.segments.filter((s) => segSource(s) === 'ai').length;
  el.tlMeta.textContent = `${formatTime(v.info.duration)} · ${n} моментов` + (nAi ? ` (${nAi} ИИ)` : '');
}

function renderSegments() {
  const segs = activeSegments();
  el.segmentsList.innerHTML = '';
  if (!activeVideo()?.analysis) {
    el.segmentsList.appendChild(emptyRow('Анализ ещё не выполнен. Нажмите «Пересчитать».'));
    return;
  }
  if (!segs.length) {
    el.segmentsList.appendChild(emptyRow('Интересные моменты не найдены. Попробуйте снизить строгость отбора.'));
    return;
  }

  segs.forEach((seg, i) => {
    const row = document.createElement('div');
    row.className = 'seg-row' + (timeline.selected === i ? ' active-seg' : '');
    row.dataset.index = i;

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'seg-check';
    chk.checked = seg.enabled !== false;
    chk.title = 'Включить в монтаж';
    chk.addEventListener('change', () => {
      seg.enabled = chk.checked;
      timeline.render();
      rebuildQueue();
    });
    row.appendChild(chk);

    const time = document.createElement('div');
    time.className = 'seg-time';
    const inpS = document.createElement('input');
    inpS.value = formatTime(seg.start, true);
    inpS.title = 'Начало (м:сс)';
    const inpE = document.createElement('input');
    inpE.value = formatTime(seg.end, true);
    inpE.title = 'Конец (м:сс)';
    const sep = document.createElement('span');
    sep.textContent = '–';
    const dur = document.createElement('span');
    dur.className = 'seg-dur';
    dur.textContent = `(${formatTime(seg.end - seg.start)})`;

    const commit = (which) => {
      const val = parseTime(inpS.value);
      const valE = parseTime(inpE.value);
      const v = activeVideo();
      if (!v) return;
      let s = isFinite(val) ? val : seg.start;
      let e = isFinite(valE) ? valE : seg.end;
      if (which === 'start') { s = Math.max(0, Math.min(s, e - 0.5)); }
      else { e = Math.min(v.info.duration, Math.max(e, s + 0.5)); }
      seg.start = Math.round(s * 100) / 100;
      seg.end = Math.round(e * 100) / 100;
      inpS.value = formatTime(seg.start, true);
      inpE.value = formatTime(seg.end, true);
      dur.textContent = `(${formatTime(seg.end - seg.start)})`;
      timeline.render();
      rebuildQueue();
    };
    inpS.addEventListener('change', () => commit('start'));
    inpE.addEventListener('change', () => commit('end'));
    inpS.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit('start'); inpS.blur(); } });
    inpE.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit('end'); inpE.blur(); } });

    time.appendChild(inpS);
    time.appendChild(sep);
    time.appendChild(inpE);
    time.appendChild(dur);
    row.appendChild(time);

    const src = document.createElement('span');
    const srcVal = segSource(seg);
    src.className = 'seg-source ' + (srcVal === 'ai' ? 'ai' : 'alg');
    src.textContent = srcVal === 'ai' ? 'ИИ' : 'АЛГ';
    src.title = srcVal === 'ai' && seg.reason ? `ИИ: ${seg.reason}` : 'Найден сигнальным анализом';
    row.appendChild(src);

    const score = document.createElement('span');
    score.className = 'seg-score';
    score.textContent = `⚡ ${Math.round(seg.peak * 100)}`;
    score.title = 'Оценка интересности';
    row.appendChild(score);

    const btns = document.createElement('div');
    btns.className = 'seg-btns';
    const play = document.createElement('button');
    play.className = 'icon-btn play';
    play.textContent = '▶';
    play.title = 'Посмотреть момент';
    play.addEventListener('click', (e) => {
      e.stopPropagation();
      previewSegment(i);
    });
    const dl = document.createElement('button');
    dl.className = 'icon-btn';
    dl.textContent = '⬇';
    dl.title = 'Скачать этот момент отдельным файлом';
    dl.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSegment(i);
    });
    const del = document.createElement('button');
    del.className = 'icon-btn del';
    del.textContent = '🗑';
    del.title = 'Удалить момент';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      // Удаляем по ссылке из полного массива (активный список может быть отфильтрован).
      const v = activeVideo();
      const target = activeSegments()[i];
      if (v && v.analysis && target) {
        const fi = v.analysis.segments.indexOf(target);
        if (fi >= 0) v.analysis.segments.splice(fi, 1);
      }
      timeline.selected = -1;
      renderTimeline();
      renderSegments();
      rebuildQueue();
    });
    btns.appendChild(play);
    btns.appendChild(dl);
    btns.appendChild(del);
    row.appendChild(btns);

    row.addEventListener('click', (e) => {
      // Клики по интерактивным элементам (чекбокс, поля, кнопки) не выделяют строку.
      if (e.target.closest('input, button')) return;
      timeline.selected = i;
      timeline.render();
      applyRowActive(i);
    });
    el.segmentsList.appendChild(row);
  });

  applyRowActive(timeline.selected);
}

// Подсветка выбранной строки без пересоздания DOM (важно: не ломает клики по чекбоксу).
function applyRowActive(selected) {
  const rows = el.segmentsList.querySelectorAll('.seg-row');
  rows.forEach((r, idx) => r.classList.toggle('active-seg', idx === selected));
}

function emptyRow(text) {
  const d = document.createElement('div');
  d.className = 'seg-empty';
  d.textContent = text;
  return d;
}

function selectSegment(i) {
  timeline.selected = i;
  timeline.render();
  applyRowActive(i);
  const segs = activeSegments();
  if (segs[i]) el.player.currentTime = segs[i].start;
}

function previewSegment(i) {
  const segs = activeSegments();
  const seg = segs[i];
  if (!seg) return;
  timeline.selected = i;
  timeline.render();
  applyRowActive(i);
  playAt(seg.start);
  el.playerSegmentBadge.hidden = false;
  el.playerSegmentBadge.textContent = `Момент ${i + 1}: ${formatTime(seg.start)}–${formatTime(seg.end)}`;
  state.playing = { videoId: state.activeId, start: seg.start, end: seg.end };
}

function addSegmentFromCurrent() {
  const v = activeVideo();
  if (!v) return;
  const t = el.player.currentTime || 0;
  const half = 2.0;
  let s = Math.max(0, t - half);
  let e = Math.min(v.info.duration, t + half);
  if (e - s < 1) { s = Math.max(0, t - 1); e = Math.min(v.info.duration, t + 1); }
  if (e - s < 0.5) return;
  if (!v.analysis) v.analysis = { segments: [], heatmap: [], threshold: 0, info: v.info };
  v.analysis.segments.push({ start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100, score: 0, peak: 0, enabled: true });
  v.analysis.segments.sort((a, b) => a.start - b.start);
  renderTimeline();
  renderSegments();
  rebuildQueue();
  toast('Момент добавлен — отрегулируйте границы', 'info');
}

// Очистить все найденные моменты видео (с сохранением на сервере, чтобы
// очистка пережила перезагрузку страницы).
async function clearVideoSegments(id) {
  const vi = state.videos.findIndex((v) => v.id === id);
  const v = vi >= 0 ? state.videos[vi] : null;
  if (!v || !v.analysis) return;
  v.analysis.segments = [];
  if (state.activeId === id) timeline.selected = -1;
  try {
    await API.saveAnalysis(id, v.analysis);
  } catch { /* сервер мог быть недоступен — оставляем очистку хотя бы локально */ }
  renderTimeline();
  renderSegments();
  renderSidebar();
  if (state.activeId === id) renderAnalysisStatus();
  rebuildQueue();
  toast('Моменты очищены', 'info');
}

function clearSegments() {
  const v = activeVideo();
  if (!v) return;
  clearVideoSegments(v.id);
}

// ---------------------------------------------------------------
// Очередь монтажа
// ---------------------------------------------------------------
function rebuildQueue() {
  state.queue = [];
  for (const v of state.videos) {
    if (!v.analysis) continue;
    for (const seg of v.analysis.segments) {
      if (seg.enabled === false) continue;
      if (!sourceVisible(seg)) continue;
      state.queue.push({ videoId: v.id, name: v.name, start: seg.start, end: seg.end, seg });
    }
  }
  renderQueue();
  el.msVideos.textContent = new Set(state.queue.map((q) => q.videoId)).size;
  el.msSegments.textContent = state.queue.length;
  const total = state.queue.reduce((a, q) => a + (q.end - q.start), 0);
  el.msDuration.textContent = formatTime(total);
  el.btnMontage.disabled = state.queue.length === 0;
}

function renderQueue() {
  el.montageQueue.innerHTML = '';
  if (!state.queue.length) {
    const d = document.createElement('div');
    d.className = 'mq-empty';
    d.textContent = 'Включите моменты в сборку — отмечайте их галочками в списке.';
    el.montageQueue.appendChild(d);
    return;
  }
  state.queue.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'mq-item';
    item.title = 'Открыть в плеере';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'seg-check';
    chk.checked = q.seg.enabled !== false;
    chk.title = 'Включить/выключить момент в монтаже';
    chk.addEventListener('change', (ev) => {
      ev.stopPropagation();
      q.seg.enabled = chk.checked;
      rebuildQueue();
      renderTimeline();
      renderSegments();
    });
    item.appendChild(chk);

    const left = document.createElement('span');
    left.innerHTML = `<b>${i + 1}.</b> ${formatTime(q.start)}–${formatTime(q.end)}`;
    const name = document.createElement('span');
    name.textContent = truncate(q.name, 16);
    item.appendChild(left);
    item.appendChild(name);
    item.addEventListener('click', () => jumpTo(q.videoId, q.start, q.end));
    el.montageQueue.appendChild(item);
  });
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function jumpTo(videoId, start, end) {
  if (state.activeId !== videoId) {
    await selectVideo(videoId);
  }
  playAt(start);
  el.playerSegmentBadge.hidden = false;
  el.playerSegmentBadge.textContent = `Сборка: ${formatTime(start)}–${formatTime(end)}`;
  state.playing = { videoId, start, end };
}

// ---------------------------------------------------------------
// Монтаж
// ---------------------------------------------------------------
// Скачивание одного момента отдельным файлом (с текущими настройками экспорта).
async function downloadSegment(i) {
  const v = activeVideo();
  const segs = activeSegments();
  const seg = segs[i];
  if (!v || !seg) return;

  el.montageResult.hidden = true;
  el.jobProgress.hidden = false;
  el.jobFill.style.width = '0%';
  el.jobText.textContent = '0%';
  el.jobLabel.textContent = `Скачивание момента ${i + 1}…`;

  const items = [{ video_id: v.id, start: seg.start, end: seg.end }];
  try {
    const { job_id } = await API.montage({
      items,
      height: parseInt(el.resSelect.value, 10) || 0,
      crf: parseInt(el.crfSlider.value, 10) || 20,
      engine: el.engineSelect.value,
      fmt: el.fmtSelect.value,
      crossfade: 0,
      transition: el.transitionSelect.value,
      marker_color: el.markerColor.value,
      subs: el.subsCheck.checked,
    });
    state.jobs.set(job_id, { kind: 'montage', single: { index: i, videoId: v.id } });
  } catch (e) {
    el.jobProgress.hidden = true;
    toast(`Не удалось запустить скачивание: ${e.message}`, 'error');
  }
}

async function startMontage() {
  if (!state.queue.length) return;
  el.montageResult.hidden = true;
  el.jobProgress.hidden = false;
  el.jobFill.style.width = '0%';
  el.jobText.textContent = '0%';
  el.jobLabel.textContent = 'Подготовка…';
  el.btnMontage.disabled = true;

  const items = state.queue.map((q) => ({ video_id: q.videoId, start: q.start, end: q.end }));
  try {
    const { job_id } = await API.montage({
      items,
      height: parseInt(el.resSelect.value, 10) || 0,
      crf: parseInt(el.crfSlider.value, 10) || 20,
      engine: el.engineSelect.value,
      fmt: el.fmtSelect.value,
      crossfade: parseFloat(el.xfadeSelect.value) || 0,
      transition: el.transitionSelect.value,
      marker_color: el.markerColor.value,
      subs: el.subsCheck.checked,
    });
    state.jobs.set(job_id, { kind: 'montage' });
  } catch (e) {
    el.jobProgress.hidden = true;
    el.btnMontage.disabled = false;
    toast(`Не удалось запустить монтаж: ${e.message}`, 'error');
  }
}

function updateMontageProgress(job) {
  el.jobProgress.hidden = false;
  el.jobLabel.textContent = job.label || 'Монтаж';
  el.jobFill.style.width = `${Math.round(job.progress * 100)}%`;
  el.jobText.textContent = `${Math.round(job.progress * 100)}%`;
}

function onMontageDone(job, single) {
  el.jobProgress.hidden = true;
  el.btnMontage.disabled = false;
  const r = job.result;
  const ext = (r.url.split('.').pop() || 'mp4').toLowerCase();

  if (single) {
    // Скачивание отдельного момента — сразу запускаем загрузку файла.
    const a = document.createElement('a');
    a.href = r.url;
    a.download = `moment_${single.index + 1}_${r.duration.toFixed(1)}s.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`Момент ${single.index + 1} скачан (${formatTime(r.duration)})`, 'success');
    return;
  }

  el.montageResult.hidden = false;
  const engineTag = r.hw ? ` · ${r.engine}` : ` · CPU`;
  el.mrMeta.textContent = `${r.segments} моментов · ${formatTime(r.duration)}${engineTag}`;
  el.btnDownload.href = r.url;
  el.btnDownload.download = `momentcut_${Date.now()}.${ext}`;
  toast('Монтаж готов!', 'success');
}

// ---------------------------------------------------------------
// Проекты: сохранение / загрузка
// ---------------------------------------------------------------
async function saveProject() {
  try {
    const data = await API.project();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `momentcut_project_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast(`Проект сохранён (${state.videos.length} видео)`, 'success');
  } catch (e) {
    toast(`Не удалось сохранить проект: ${e.message}`, 'error');
  }
}

async function loadProject(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.videos)) {
      throw new Error('Некорректный файл проекта');
    }
    const res = await API.loadProject(data);
    state.videos = [...res.loaded];
    renderSidebar();
    rebuildQueue();
    if (state.videos.length) {
      await selectVideo(state.videos[0].id);
    } else {
      showEmpty();
    }
    const msg = `Проект загружен: ${res.loaded.length} видео` +
      (res.failed.length ? `, ${res.failed.length} не найдено` : '');
    toast(msg, res.failed.length ? 'error' : 'success');
  } catch (e) {
    toast(`Не удалось загрузить проект: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------
// Старт
// ---------------------------------------------------------------
init();
