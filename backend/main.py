"""MomentCut — FastAPI-сервер: загрузка видео, анализ, монтаж, речь, проекты."""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path

# Временные файлы (в т.ч. буфер загрузки больших видео) — на диск с запасом места.
_BASE_DIR = Path(__file__).resolve().parent
_DATA_TMP = _BASE_DIR.parent / "data" / "tmp"
_DATA_TMP.mkdir(parents=True, exist_ok=True)
os.environ["TEMP"] = str(_DATA_TMP)
os.environ["TMP"] = str(_DATA_TMP)

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai_analyzer, analyzer, editor, speech
from .ffmpeg_locate import describe_engine
from .jobs import JOBS

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "output"
FRONTEND_DIR = BASE_DIR.parent / "frontend"
THUMB_DIR = DATA_DIR / "thumbs"
for d in (UPLOAD_DIR, OUTPUT_DIR, THUMB_DIR):
    d.mkdir(parents=True, exist_ok=True)

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".ts", ".flv", ".wmv", ".mpg", ".mpeg", ".3gp"}

app = FastAPI(title="MomentCut", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------
# Хранилище видео (в памяти — для локального приложения этого достаточно)
# --------------------------------------------------------------------------
VIDEOS: dict[str, dict] = {}
VIDEOS_LOCK = threading.Lock()


def _video_dir(vid: str) -> Path:
    return UPLOAD_DIR / vid


def _cleanup_upload_dir(vdir: Path) -> None:
    """Удаляет каталог загрузки (неудачная загрузка — не оставляем мусор)."""
    if not vdir.exists():
        return
    for f in vdir.iterdir():
        try:
            f.unlink(missing_ok=True)
        except OSError:
            pass
    try:
        vdir.rmdir()
    except OSError:
        pass


# --------------------------------------------------------------------------
# Персистентный кеш: загруженные видео не теряются после перезапуска сервера.
# На каждый ролик — JSON-файл в data/cache (метаданные + анализ + речь).
# --------------------------------------------------------------------------
CACHE_DIR = DATA_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _json_default(o):
    """Преобразует numpy-типы в обычные Python (для json.dump)."""
    try:
        import numpy as np  # type: ignore
    except Exception:
        return str(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def _save_cache(rec: dict) -> None:
    """Сохраняет запись видео (метаданные + анализ + речь) на диск."""
    try:
        with open(CACHE_DIR / f"{rec['id']}.json", "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, default=_json_default)
    except Exception:
        pass


def _drop_cache(vid: str) -> None:
    try:
        (CACHE_DIR / f"{vid}.json").unlink(missing_ok=True)
    except OSError:
        pass


def _load_library() -> None:
    """Восстанавливает VIDEOS из кеша (если файл на диске ещё существует)."""
    global VIDEOS
    with VIDEOS_LOCK:
        VIDEOS = {}
        if not CACHE_DIR.exists():
            return
        for p in sorted(CACHE_DIR.glob("*.json")):
            if p.name.endswith("_ai_resume.json"):
                # Контрольная точка ИИ-анализа (пауза), а не запись видео.
                continue
            try:
                rec = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(rec, dict) and rec.get("id") and Path(rec.get("path", "")).exists():
                    VIDEOS[rec["id"]] = rec
                else:
                    p.unlink(missing_ok=True)
            except Exception:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass


_load_library()


# --------------------------------------------------------------------------
# Контрольные точки ИИ-анализа (пауза).
# Пока анализ на паузе, в data/cache/{vid}_ai_resume.json лежит состояние:
# какой «фрагмент» (окно) следующим обработать, накопленные сегменты и
# параметры запроса (без API-ключа!). Это позволяет продолжить анализ с того
# же места даже после перезапуска сервера или обновления страницы.
# --------------------------------------------------------------------------
AI_RESUME: dict[str, dict] = {}


def _ai_resume_path(vid: str) -> Path:
    return CACHE_DIR / f"{vid}_ai_resume.json"


def _load_ai_resume_states() -> None:
    """Восстанавливает сохранённые паузы ИИ-анализа из кеша на диске."""
    global AI_RESUME
    AI_RESUME = {}
    if not CACHE_DIR.exists():
        return
    for p in CACHE_DIR.glob("*_ai_resume.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(d, dict) and d.get("video_id"):
                AI_RESUME[d["video_id"]] = d
            else:
                p.unlink(missing_ok=True)
        except Exception:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass


def _save_ai_resume(vid: str, state: dict) -> None:
    AI_RESUME[vid] = state
    # Пишем атомарно (во временный файл + переименование), чтобы при сбое
    # на диске не осталась частично записанная контрольная точка.
    try:
        tmp = _ai_resume_path(vid).with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, default=_json_default)
        os.replace(tmp, _ai_resume_path(vid))
    except Exception:
        pass


def _drop_ai_resume(vid: str) -> None:
    AI_RESUME.pop(vid, None)
    try:
        _ai_resume_path(vid).unlink(missing_ok=True)
    except OSError:
        pass


_load_ai_resume_states()


# --------------------------------------------------------------------------
# Модели
# --------------------------------------------------------------------------
class AnalyzeRequest(BaseModel):
    sensitivity: float = 1.0
    min_len: float = 1.0
    max_len: float = 45.0
    use_audio: bool = True
    use_scene: bool = True
    use_motion: bool = True
    engine: str = "auto"   # cpu | gpu | auto(гибрид)
    # ИИ-анализ: method='ai' включает анализ через внешний OpenAI-совместимый API.
    method: str = "signals"        # signals | ai
    ai_endpoint: str | None = None
    ai_api_key: str | None = None  # передаётся только на время запроса, в кеш НЕ пишется
    ai_model: str | None = None
    ai_system_prompt: str | None = None
    ai_input: str = "frames"       # frames | frames_speech | speech
    ai_frames: int = 10          # каждый N-й кадр видео, отправляемый в ИИ
    ai_chunk_sec: float = 0.0    # сколько секунд видео за один ИИ-запрос (0 — всё сразу)
    ai_max_segments: int = 0     # сколько всего моментов выбрать ИИ (0 — без ограничения)
    ai_merge: bool = True          # дополнять ИИ-моментами существующий анализ
    resume: bool = False           # продолжить ИИ-анализ с сохранённой паузы


class AnalysisUpdateRequest(BaseModel):
    analysis: dict   # состояние анализа (например, с очищенными моментами)


class MontageItem(BaseModel):
    video_id: str
    start: float
    end: float


class MontageRequest(BaseModel):
    items: list[MontageItem]
    height: int = 0          # 0 = авто (оригинал/максимум)
    crf: int = 20            # качество (CRF/CQ)
    engine: str = "auto"     # cpu | nvidia | amd | intel | auto(гибрид)
    fmt: str = "mp4"         # mp4 | hevc | webm | mkv
    crossfade: float = 0.0   # длительность перехода между сегментами, сек
    transition: str = "fade"   # none|fade|fadeblack|fadewhite|dissolve|wipeleft|slideright|marker
    marker_color: str = "#ff00ff"  # цвет плашки-маркера (для transition=marker)
    subs: bool = False       # вписать субтитры по распознанной речи


class TranscribeRequest(BaseModel):
    engine: str = "auto"
    language: str | None = None
    model: str = "base"       # tiny | base | small | medium | large-v3 (local)
    provider: str = "local"   # local (faster-whisper) | api (внешний endpoint)
    endpoint: str | None = None   # OpenAI-совместимый /audio/transcriptions
    api_key: str | None = None    # Bearer-ключ для endpoint
    diarize: bool = False     # разделять по голосам (pyannote.audio)
    hf_token: str | None = None   # Hugging Face токен для pyannote
    min_speakers: int | None = None
    max_speakers: int | None = None


# --------------------------------------------------------------------------
# Загрузка и управление видео
# --------------------------------------------------------------------------
@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    ext = Path(file.filename or "video.mp4").suffix.lower()
    if ext not in VIDEO_EXT:
        raise HTTPException(400, f"Неподдерживаемый формат: {ext}")

    vid = uuid.uuid4().hex
    vdir = _video_dir(vid)
    vdir.mkdir(parents=True, exist_ok=True)
    fname = f"source{ext}"
    path = vdir / fname

    with open(path, "wb") as f:
        while chunk := await file.read(8 * 1024 * 1024):
            f.write(chunk)

    try:
        info = analyzer.probe_video(str(path))
    except Exception as exc:
        # Битый/нечитаемый файл — не оставляем гигабайты на диске.
        _cleanup_upload_dir(vdir)
        raise HTTPException(400, f"Не удалось прочитать видео: {exc}")

    if info["duration"] <= 0 or info["width"] <= 0:
        _cleanup_upload_dir(vdir)
        raise HTTPException(400, "Видео не содержит валидного видеопотока")

    thumb = editor.generate_thumbnail(str(path), str(THUMB_DIR / f"{vid}.jpg"), at_frac=0.1)

    record = {
        "id": vid,
        "name": os.path.basename(file.filename or "video"),
        "path": str(path),
        "thumb": os.path.basename(thumb) if thumb else None,
        "info": info,
        "analysis": None,
        "created": True,
    }
    with VIDEOS_LOCK:
        VIDEOS[vid] = record
        _save_cache(record)
    return _public(record)


class ImportRequest(BaseModel):
    path: str


@app.post("/api/import")
def import_video(req: ImportRequest):
    """Добавляет видео по пути на диске — без копирования в каталог приложения."""
    raw = (req.path or "").strip().strip('"').strip("'")
    if not raw:
        raise HTTPException(400, "Укажите путь к видео")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = path.resolve()
    if not path.exists() or not path.is_file():
        raise HTTPException(400, f"Файл не найден: {raw}")
    ext = path.suffix.lower()
    if ext not in VIDEO_EXT:
        raise HTTPException(400, f"Неподдерживаемый формат: {ext}")

    resolved = str(path.resolve())
    with VIDEOS_LOCK:
        for rec in VIDEOS.values():
            try:
                if str(Path(rec["path"]).resolve()) == resolved:
                    return _public(rec)   # уже есть в библиотеке
            except OSError:
                pass

    try:
        info = analyzer.probe_video(str(path))
    except Exception as exc:
        raise HTTPException(400, f"Не удалось прочитать видео: {exc}")
    if info["duration"] <= 0 or info["width"] <= 0:
        raise HTTPException(400, "Видео не содержит валидного видеопотока")

    vid = uuid.uuid4().hex
    thumb = editor.generate_thumbnail(str(path), str(THUMB_DIR / f"{vid}.jpg"), at_frac=0.1)
    record = {
        "id": vid,
        "name": path.name,
        "path": resolved,
        "thumb": os.path.basename(thumb) if thumb else None,
        "info": info,
        "analysis": None,
        "external": True,   # не копировали — при удалении записи файл на диске не трогаем
        "created": True,
    }
    with VIDEOS_LOCK:
        VIDEOS[vid] = record
        _save_cache(record)
    return _public(record)


def _public(rec: dict) -> dict:
    ar = AI_RESUME.get(rec["id"])
    return {
        "id": rec["id"],
        "name": rec["name"],
        "info": rec["info"],
        "has_thumb": rec["thumb"] is not None,
        "analysis": rec.get("analysis"),
        "has_speech": bool(rec.get("speech")),
        "speech_lang": (rec.get("speech") or {}).get("language", ""),
        "speech_words": len((rec.get("speech") or {}).get("words", [])),
        "speech_speakers": len((rec.get("speech") or {}).get("speakers", [])),
        "speech_diarized": bool((rec.get("speech") or {}).get("speakers")),
        "speech_diar_error": (rec.get("speech") or {}).get("diarization_error"),
        "external": bool(rec.get("external")),
        "path": rec["path"] if rec.get("external") else None,
        # Сохранённая пауза ИИ-анализа (переживает перезапуск сервера).
        "ai_resume": None if not ar else {
            "progress": ar.get("progress", 0.0),
            "segments": len(ar.get("segments") or []),
            "pos": ar.get("ai_pos"),
            "updated": ar.get("updated"),
        },
    }


@app.get("/api/videos")
def list_videos():
    with VIDEOS_LOCK:
        items = [_public(r) for r in VIDEOS.values()]
    items.sort(key=lambda x: x["name"].lower())
    return {"videos": items}


@app.get("/api/videos/{vid}")
def get_video(vid: str):
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    return _public(rec)


@app.delete("/api/videos/{vid}")
def delete_video(vid: str):
    rec = VIDEOS.pop(vid, None)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    _drop_cache(vid)
    _drop_ai_resume(vid)
    # Превью
    if rec.get("thumb"):
        try:
            (THUMB_DIR / rec["thumb"]).unlink(missing_ok=True)
        except OSError:
            pass
    if rec.get("external"):
        # Видео взято с диска пользователя (без копирования) — исходник не удаляем.
        return {"ok": True}
    vdir = _video_dir(vid)
    if vdir.exists():
        # Windows может держать файл (стрим/ffprobe) — пробуем несколько раз.
        files = list(vdir.iterdir())
        for attempt in range(10):
            try:
                for f in files:
                    f.unlink(missing_ok=True)
                break
            except PermissionError:
                time.sleep(0.25)
                continue
        try:
            vdir.rmdir()
        except OSError:
            pass
    return {"ok": True}


@app.post("/api/videos/cleanup")
def cleanup_videos():
    """Очищает библиотеку: убирает из списка ВСЕ видео.

    Загруженные через UI видео удаляются вместе с файлами, превью, кешем и
    паузами. У видео «с диска» (импортированных по пути) удаляется только
    запись из библиотеки (плюс превью/кеш) — оригинальный файл на диске
    НЕ трогается. Дополнительно подчищаются осиротевшие каталоги загрузок.
    """
    removed, removed_external = [], []
    with VIDEOS_LOCK:
        for vid, rec in list(VIDEOS.items()):
            VIDEOS.pop(vid, None)
            _drop_cache(vid)
            _drop_ai_resume(vid)
            if rec.get("thumb"):
                try:
                    (THUMB_DIR / rec["thumb"]).unlink(missing_ok=True)
                except OSError:
                    pass
            if rec.get("external"):
                # Видео «с диска»: удаляем только запись/превью/кеш,
                # сам файл на диске пользователя не трогаем.
                removed_external.append(_public(rec))
                continue
            vdir = _video_dir(vid)
            if vdir.exists():
                files = list(vdir.iterdir())
                for _attempt in range(10):
                    try:
                        for f in files:
                            f.unlink(missing_ok=True)
                        break
                    except PermissionError:
                        time.sleep(0.25)
                        continue
                try:
                    vdir.rmdir()
                except OSError:
                    pass
            removed.append(_public(rec))
        # Осиротевшие каталоги загрузок без записей в библиотеке.
        if UPLOAD_DIR.exists():
            for d in UPLOAD_DIR.iterdir():
                if d.is_dir() and d.name not in VIDEOS:
                    for f in d.iterdir():
                        try:
                            f.unlink(missing_ok=True)
                        except OSError:
                            pass
                    try:
                        d.rmdir()
                    except OSError:
                        pass
    return {
        "removed": removed,
        "removed_external": removed_external,
        "removed_count": len(removed) + len(removed_external),
        "kept": [],
    }


@app.get("/api/videos/{vid}/stream")
def stream_video(vid: str):
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    return FileResponse(rec["path"])


@app.get("/api/videos/{vid}/thumbnail")
def video_thumbnail(vid: str):
    rec = VIDEOS.get(vid)
    if not rec or not rec["thumb"]:
        raise HTTPException(404, "Нет превью")
    return FileResponse(THUMB_DIR / rec["thumb"])


# --------------------------------------------------------------------------
# Анализ
# --------------------------------------------------------------------------
@app.post("/api/videos/{vid}/analyze")
def analyze_video(vid: str, req: AnalyzeRequest):
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")

    # Просят продолжить ИИ-анализ, и для этого видео уже есть приостановленная
    # задача в памяти (страница перезагружена, сервер жив) — просто снимаем паузу.
    if req.method == "ai" and req.resume:
        for old in JOBS.all():
            if (old.kind == "analyze" and old.video_id == vid
                    and old.status == "paused" and old.pause_event):
                old.pause_event.clear()
                JOBS.update(old.id, status="running",
                            message="ИИ-анализ продолжен…")
                return {"job_id": old.id, "resumed": True}

    job = JOBS.create("analyze", f"Анализ «{rec['name']}»")
    job.video_id = vid

    def run():
        try:
            if req.method == "ai":
                # Для способов с речью нужна предварительная расшифровка.
                words = []
                if req.ai_input in ("frames_speech", "speech"):
                    words = (rec.get("speech") or {}).get("words", [])
                    if not words:
                        raise RuntimeError(
                            "Для способа «Кадры + речь» / «Речь» нужна расшифровка "
                            "речи — сначала нажмите «🎙 Распознать речь».")

                # Контрольная точка: при продолжении берём из сохранённой паузы.
                cp = AI_RESUME.get(vid) if req.resume else None

                # Параметры запроса: при продолжении — из точки (кроме
                # API-ключа: он не хранится, передаётся в этом запросе).
                p = dict(cp.get("params") or {}) if cp else {}
                endpoint = p.get("endpoint") or req.ai_endpoint
                model = p.get("model") or req.ai_model
                system_prompt = p.get("system_prompt")
                if system_prompt is None:
                    system_prompt = req.ai_system_prompt
                ai_method = p.get("method") or req.ai_input
                frame_step = int(p.get("frame_step") or req.ai_frames
                                 or ai_analyzer.DEFAULT_FRAME_STEP)
                chunk_sec = float(p.get("chunk_sec") or req.ai_chunk_sec or 0.0)
                max_segments = int(p.get("ai_max_segments") or req.ai_max_segments or 0)
                ai_merge = bool(p.get("ai_merge", req.ai_merge))

                # Свежий запуск — старая пауза больше не нужна.
                if not cp:
                    _drop_ai_resume(vid)

                start_index = int(cp.get("window_index", 0)) if cp else 0
                initial_segments = list(cp.get("segments") or []) if cp else []
                initial_heatmap = list(cp.get("heatmap") or []) if cp else []

                pause_event = threading.Event()
                cancel_event = threading.Event()
                JOBS.update(job.id, pause_event=pause_event,
                            cancel_event=cancel_event)

                def cb(frac, pos_sec=None, seg_count=None):
                    extra = {}
                    if pos_sec is not None:
                        extra["ai_pos"] = float(pos_sec)
                    if seg_count is not None:
                        extra["ai_segments"] = int(seg_count)
                    JOBS.update(job.id, progress=frac,
                                message=f"ИИ-анализ: {int(frac * 100)}%",
                                **extra)

                def on_pause(idx, segs, total, pos_sec=None, heat=None):
                    frac = (idx / total) if total else 0.0
                    pos = float(pos_sec) if pos_sec is not None else None
                    _save_ai_resume(vid, {
                        "video_id": vid,
                        "updated": time.time(),
                        "window_index": idx,
                        "total_windows": total,
                        "progress": frac,
                        "ai_pos": pos,
                        "segments": segs,
                        "heatmap": heat or [],
                        "params": {
                            "endpoint": endpoint,
                            "model": model,
                            "system_prompt": system_prompt,
                            "method": ai_method,
                            "frame_step": frame_step,
                            "chunk_sec": chunk_sec,
                            "ai_max_segments": max_segments,
                            "ai_merge": ai_merge,
                        },
                    })
                    JOBS.update(job.id, status="paused", progress=frac,
                                ai_pos=pos, ai_segments=len(segs),
                                message=f"ИИ-анализ на паузе: {int(frac * 100)}%")

                result = ai_analyzer.analyze_with_ai(
                    rec["path"],
                    endpoint=endpoint,
                    api_key=req.ai_api_key,
                    model=model,
                    system_prompt=system_prompt,
                    method=ai_method,
                    frame_step=frame_step,
                    chunk_sec=chunk_sec,
                    words=words,
                    progress_cb=cb,
                    start_index=start_index,
                    initial_segments=initial_segments,
                    initial_heatmap=initial_heatmap,
                    pause_event=pause_event,
                    cancel_event=cancel_event,
                    pause_cb=on_pause,
                    max_segments=max_segments,
                )
                # Дополняем существующий (сигнальный) анализ, если он есть.
                existing = rec.get("analysis")
                if (ai_merge and existing and existing.get("segments")):
                    merged = ai_analyzer.merge_with_existing(
                        existing.get("segments", []), result["segments"])
                    # Тепловую карту НЕ заменяем ИИ-шной «вкл/выкл»: у
                    # сигнального анализа она непрерывная — оставляем её.
                    heat = result.get("heatmap") or []
                    if existing.get("heatmap"):
                        heat = existing["heatmap"]
                    result = {**result, "segments": merged, "heatmap": heat,
                              "options": {**result["options"], "source": "merged"}}
                _drop_ai_resume(vid)
            else:
                result = analyzer.analyze(
                    rec["path"],
                    sensitivity=req.sensitivity,
                    min_len=req.min_len,
                    max_len=req.max_len,
                    use_audio=req.use_audio,
                    use_scene=req.use_scene,
                    use_motion=req.use_motion,
                    engine=req.engine,
                )
                for seg in result["segments"]:
                    seg.setdefault("source", "signals")
                result["options"]["source"] = "signals"

            with VIDEOS_LOCK:
                rec["analysis"] = result
                _save_cache(rec)
            JOBS.update(job.id, status="done", progress=1.0,
                        message="Готово", result=result)
        except ai_analyzer.AnalysisCancelled:
            _drop_ai_resume(vid)
            JOBS.update(job.id, status="error", message="Анализ отменён",
                        error="Анализ отменён")
        except Exception as exc:
            JOBS.update(job.id, status="error", message="Ошибка анализа",
                        error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job.id}


@app.post("/api/videos/{vid}/analysis")
def save_analysis(vid: str, req: AnalysisUpdateRequest):
    """Сохраняет текущее состояние анализа видео (напр. очищенные моменты)."""
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    with VIDEOS_LOCK:
        rec["analysis"] = req.analysis
        _save_cache(rec)
    return {"ok": True}


# --------------------------------------------------------------------------
# Управление задачей анализа: пауза / продолжение / отмена
# --------------------------------------------------------------------------
@app.post("/api/jobs/{job_id}/pause")
def pause_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Задача не найдена")
    if job.kind != "analyze" or not job.pause_event:
        raise HTTPException(400, "Эту задачу нельзя поставить на паузу")
    job.pause_event.set()
    JOBS.update(job.id, status="paused", message="Пауза…")
    return {"ok": True}


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Задача не найдена")
    if job.kind != "analyze" or not job.pause_event:
        raise HTTPException(400, "Эту задачу нельзя продолжить")
    job.pause_event.clear()
    JOBS.update(job.id, status="running", message="ИИ-анализ продолжен…")
    return {"ok": True}


@app.post("/api/jobs/{job_id}/stop")
def stop_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Задача не найдена")
    if job.kind != "analyze" or not job.cancel_event:
        raise HTTPException(400, "Эту задачу нельзя остановить")
    # Ставим ТОЛЬКО cancel_event: паузу снимать НЕЛЬЗЯ, иначе поток в
    # ожидании паузы воспримет это как «продолжить» и обработает ещё окно.
    # При установленной паузе поток видит cancel_event и прерывается сразу.
    job.cancel_event.set()
    return {"ok": True}


@app.post("/api/videos/{vid}/analyze/cancel")
def cancel_ai_analysis(vid: str):
    """Отменяет ИИ-анализ видео и удаляет сохранённую паузу.

    Работает в двух случаях: задача ещё жива (браузер обновлён, сервер жив —
    останавливаем её через события) и после перезапуска сервера (осталась
    только контрольная точка на диске — просто удаляем её).
    """
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    for old in JOBS.all():
        if old.kind == "analyze" and old.video_id == vid:
            if old.cancel_event:
                # Паузу не снимаем (см. stop_job): только отменяем.
                old.cancel_event.set()
            if old.status != "error":
                JOBS.update(old.id, status="error", message="Анализ отменён",
                            error="Анализ отменён")
    _drop_ai_resume(vid)
    return {"ok": True}


# --------------------------------------------------------------------------
# Монтаж
# --------------------------------------------------------------------------
def _build_srt_lines(resolved, crossfade, transition="fade"):
    """Собирает субтитры из распознанных слов, смещая по накопленному времени монтажа.

    Если слова размечены по голосам (диаризация), реплика каждого говорящего
    выводится отдельной строкой с префиксом «Спикер N: …»; строка разбивается
    при смене спикера.
    """
    # Плашка-маркер добавляет время между частями, переходы xfade — убирают.
    gap = crossfade if transition == "marker" else -crossfade
    lines = []
    offset = 0.0
    for idx, seg in enumerate(resolved):
        start, end = seg["start"], seg["end"]
        words = [w for w in seg["words"]
                 if w.get("start") is not None and w["end"] is not None
                 and w["start"] >= start and w["end"] <= end]

        group, g_start, g_speaker = [], None, None

        def flush(me):
            nonlocal group, g_start, g_speaker
            if not group:
                return
            prefix = f"{g_speaker}: " if g_speaker else ""
            lines.append((g_start if g_start is not None else 0.0, me,
                          prefix + " ".join(group)))
            group, g_start, g_speaker = [], None, None

        for w in words:
            ms = w["start"] - start + offset
            me = w["end"] - start + offset
            spk = w.get("speaker")
            if g_start is None:
                g_start = ms
                g_speaker = spk
            elif spk != g_speaker:
                # Сменился говорящий — завершаем предыдущую реплику.
                flush(ms)
                g_start = ms
                g_speaker = spk
            group.append(w["word"])
            if (me - g_start) >= 3.5 or len(group) >= 10:
                flush(me)
        if group:
            me = (words[-1]["end"] - start + offset) if words else offset
            flush(me)
        offset += (end - start) + (gap if idx > 0 else 0)
    return lines


@app.post("/api/montage")
def create_montage(req: MontageRequest):
    if not req.items:
        raise HTTPException(400, "Нет сегментов")

    resolved = []
    for it in req.items:
        rec = VIDEOS.get(it.video_id)
        if not rec:
            raise HTTPException(400, f"Видео не найдено: {it.video_id}")
        if it.end <= it.start:
            continue
        resolved.append({
            "path": rec["path"],
            "start": max(it.start, 0.0),
            "end": min(it.end, rec["info"]["duration"]),
            "has_audio": rec["info"]["has_audio"],
            "height": rec["info"]["height"],
            "words": (rec.get("speech") or {}).get("words", []),
        })
    if not resolved:
        raise HTTPException(400, "Нет валидных сегментов для монтажа")

    # Целевая высота: явный выбор или максимум по роликам (если различаются).
    if req.height and req.height > 0:
        target_h = req.height
    else:
        heights = {r["height"] for r in resolved}
        if len(heights) == 1:
            target_h = None  # все ролики одного разрешения — оставляем как есть
        else:
            target_h = min(max(heights), 1080)

    fmt_cfg = editor.FORMATS.get(req.fmt, editor.FORMATS["mp4"])
    out_name = f"montage_{uuid.uuid4().hex[:10]}.{fmt_cfg['ext']}"
    out_path = OUTPUT_DIR / out_name

    job = JOBS.create("montage", "Сборка монтажа")

    def run():
        srt_path = None
        try:
            def cb(frac):
                JOBS.update(job.id, progress=frac,
                            message=f"Монтаж: {int(frac * 100)}%")

            if req.subs:
                lines = _build_srt_lines(resolved, req.crossfade, req.transition)
                if lines:
                    srt_path = OUTPUT_DIR / f"subs_{uuid.uuid4().hex[:10]}.srt"
                    editor.write_srt(lines, str(srt_path))

            result = editor.build_montage(
                resolved, str(out_path),
                height=target_h, crf=req.crf,
                engine=req.engine, fmt=req.fmt, crossfade=req.crossfade,
                transition=req.transition, marker_color=req.marker_color,
                srt_path=str(srt_path) if srt_path else None,
                progress_cb=cb,
            )
            result["url"] = f"/api/output/{out_name}"
            JOBS.update(job.id, status="done", progress=1.0,
                        message="Монтаж готов", result=result)
        except Exception as exc:
            JOBS.update(job.id, status="error", message="Ошибка монтажа",
                        error=str(exc))
        finally:
            if srt_path and os.path.exists(srt_path):
                try:
                    os.remove(srt_path)
                except OSError:
                    pass

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job.id}


# --------------------------------------------------------------------------
# Движки и форматы (для UI)
# --------------------------------------------------------------------------
@app.get("/api/engine")
def engine_info():
    return {
        "formats": editor.FORMATS,
        "engines": editor.ENGINES,
        "capabilities": describe_engine(),
        "speech": {
            "available": speech.available(),
            "model": speech.MODEL_NAME,
            "options": speech.MODEL_OPTIONS,
            "loaded": speech.loaded_model(),
            "diarization": speech.diarization_available(),
            "diar_device": speech.diar_device(),
        },
    }


# --------------------------------------------------------------------------
# Распознавание речи и поиск по словам
# --------------------------------------------------------------------------
@app.post("/api/videos/{vid}/transcribe")
def transcribe_video(vid: str, req: TranscribeRequest):
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    if not speech.available():
        raise HTTPException(400, "faster-whisper не установлен")
    if req.diarize and not speech.diarization_available():
        raise HTTPException(
            400, "Для разделения по голосам установите pyannote.audio: "
                 "pip install pyannote.audio torch torchaudio")

    job = JOBS.create("transcribe", f"Распознавание речи «{rec['name']}»")

    def run():
        try:
            def diar_cb(frac):
                JOBS.update(job.id, progress=0.95 + 0.05 * frac,
                            message=f"Разделение по голосам: {int(frac * 100)}%")

            if req.provider == "api":
                JOBS.update(job.id, progress=0.5, message="Распознавание (API)…")
                result = speech.api_transcribe(
                    rec["path"], endpoint=req.endpoint, api_key=req.api_key,
                    model=req.model or "whisper-1", language=req.language,
                    do_diarize=req.diarize, hf_token=req.hf_token,
                    min_speakers=req.min_speakers, max_speakers=req.max_speakers,
                    diar_cb=diar_cb)
            else:
                def cb(frac):
                    JOBS.update(job.id, progress=frac,
                                message=f"Распознавание: {int(frac * 100)}%")

                result = speech.transcribe(rec["path"], engine=req.engine,
                                           language=req.language, model=req.model,
                                           progress_cb=cb, do_diarize=req.diarize,
                                           hf_token=req.hf_token,
                                           min_speakers=req.min_speakers,
                                           max_speakers=req.max_speakers,
                                           diar_cb=diar_cb)
            with VIDEOS_LOCK:
                rec["speech"] = result
                _save_cache(rec)
            job_result = {
                "words": len(result["words"]),
                "language": result["language"],
                "model": req.model,
                "speakers": len(result.get("speakers") or []),
            }
            if result.get("diarization_error"):
                job_result["diarization_error"] = result["diarization_error"]
            msg = "Речь распознана"
            if req.diarize:
                msg = (f"Речь распознана, спикеров: "
                       f"{len(result.get('speakers') or [])}")
            JOBS.update(job.id, status="done", progress=1.0,
                        message=msg, result=job_result)
        except Exception as exc:
            JOBS.update(job.id, status="error", message="Ошибка распознавания",
                        error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job.id}


@app.get("/api/videos/{vid}/speech")
def get_speech(vid: str):
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    sp = rec.get("speech")
    if not sp:
        raise HTTPException(404, "Речь ещё не распознана")
    return sp


@app.get("/api/videos/{vid}/search")
def search_speech(vid: str, q: str = Query(..., min_length=1)):
    rec = VIDEOS.get(vid)
    if not rec:
        raise HTTPException(404, "Видео не найдено")
    sp = rec.get("speech")
    if not sp:
        return {"matches": []}
    return {"matches": speech.search_words(sp.get("words", []), q)}


# --------------------------------------------------------------------------
# Проекты (сохранение / загрузка)
# --------------------------------------------------------------------------
@app.get("/api/project")
def get_project():
    with VIDEOS_LOCK:
        videos = []
        for rec in VIDEOS.values():
            # Сохраняем только то, что нужно для восстановления.
            videos.append({
                "id": rec["id"],
                "name": rec["name"],
                "file": os.path.basename(rec["path"]),
                "external": rec.get("external", False),
                "path": rec["path"] if rec.get("external") else None,
                "thumb": rec["thumb"],
                "info": rec["info"],
                "analysis": rec.get("analysis"),
                "speech": rec.get("speech"),
            })
    return {"version": 1, "videos": videos}


class ProjectLoadRequest(BaseModel):
    project: dict


@app.post("/api/project/load")
def load_project(req: ProjectLoadRequest):
    data = req.project
    videos = data.get("videos", []) if isinstance(data, dict) else []
    if not isinstance(videos, list):
        raise HTTPException(400, "Некорректный проект")

    loaded, failed = [], []
    for item in videos:
        if not isinstance(item, dict) or "id" not in item:
            failed.append(item.get("name", "?") if isinstance(item, dict) else "?")
            continue
        vid = item["id"]
        if item.get("external"):
            path = Path(str(item.get("path") or "")).expanduser()
            if not path.is_absolute() or not path.is_file():
                failed.append(item.get("name", vid))
                continue
        else:
            path = _video_dir(vid) / os.path.basename(item.get("file") or "source.mp4")
            if not path.exists():
                failed.append(item.get("name", vid))
                continue
        record = {
            "id": vid,
            "name": item.get("name", os.path.basename(str(path))),
            "path": str(path),
            "thumb": item.get("thumb"),
            "info": item.get("info") or analyzer.probe_video(str(path)),
            "analysis": item.get("analysis"),
            "speech": item.get("speech"),
            "external": bool(item.get("external")),
        }
        with VIDEOS_LOCK:
            VIDEOS[vid] = record
            _save_cache(record)
        loaded.append(_public(record))

    return {"loaded": loaded, "failed": failed}


# --------------------------------------------------------------------------
# Задачи и скачивание
# --------------------------------------------------------------------------
@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Задача не найдена")
    return job.to_dict()


_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}


@app.get("/api/output/{fname}")
def download_output(fname: str):
    path = OUTPUT_DIR / fname
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    ext = Path(fname).suffix.lower()
    return FileResponse(path, media_type=_MEDIA_TYPES.get(ext, "application/octet-stream"),
                        filename=fname)


# --------------------------------------------------------------------------
# Статика фронтенда
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.exception_handler(Exception)
async def unhandled(request, exc):  # Starlette вызывает как (request, exc)
    return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=500)
