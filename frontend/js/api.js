// Клиент для REST API бэкенда

async function req(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.error || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const API = {
  upload(file, onProgress) {
    const form = new FormData();
    form.append('file', file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Некорректный ответ сервера')); }
        } else {
          let msg = xhr.responseText;
          try { msg = JSON.parse(xhr.responseText).detail || msg; } catch { /* ignore */ }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Сетевая ошибка при загрузке'));
      xhr.send(form);
    });
  },

  videos: () => req('/api/videos'),
  video: (id) => req(`/api/videos/${id}`),
  deleteVideo: (id) => req(`/api/videos/${id}`, { method: 'DELETE' }),

  analyze: (id, opts) => req(`/api/videos/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  }),

  // Сохранить текущее состояние анализа (напр. после очистки моментов).
  saveAnalysis: (id, analysis) => req(`/api/videos/${id}/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis }),
  }),

  montage: (body) => req('/api/montage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),

  job: (id) => req(`/api/jobs/${id}`),

  // Пауза / продолжение / отмена ИИ-анализа (по задаче).
  pauseJob: (id) => req(`/api/jobs/${id}/pause`, { method: 'POST' }),
  resumeJob: (id) => req(`/api/jobs/${id}/resume`, { method: 'POST' }),
  stopJob: (id) => req(`/api/jobs/${id}/stop`, { method: 'POST' }),

  // Отмена ИИ-анализа по видео (после перезапуска браузера, когда job_id не известен).
  cancelAnalyze: (id) => req(`/api/videos/${id}/analyze/cancel`, { method: 'POST' }),

  // Очистка: удалить все загруженные видео + кеш (внешние «с диска» не трогаются).
  cleanupVideos: () => req('/api/videos/cleanup', { method: 'POST' }),

  engine: () => req('/api/engine'),

  import: (path) => req('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }),

  transcribe: (id, opts) => req(`/api/videos/${id}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  }),

  videoSpeech: (id) => req(`/api/videos/${id}/speech`),

  search: (id, q) => req(`/api/videos/${id}/search?q=${encodeURIComponent(q)}`),

  project: () => req('/api/project'),

  loadProject: (project) => req('/api/project/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  }),

  streamUrl: (id) => `/api/videos/${id}/stream`,
  thumbUrl: (id) => `/api/videos/${id}/thumbnail`,
};
