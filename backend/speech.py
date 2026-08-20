"""Распознавание речи (faster-whisper) для поиска по словам.

Модель загружается лениво при первом запросе (скачивается с Hugging Face).
Можно выбрать размер модели; при смене модели предыдущая выгружается из памяти.
Использует CUDA, если доступен движок GPU, иначе CPU (int8).
"""
from __future__ import annotations

import gc
import os
import shutil
import subprocess
import tempfile
import threading

try:
    from faster_whisper import WhisperModel  # type: ignore
    _AVAILABLE = True
except Exception:  # pragma: no cover
    _AVAILABLE = False

# Доступные модели (faster-whisper). Больше — качественнее, но медленнее и тяжелее.
MODEL_OPTIONS = ["tiny", "base", "small", "medium", "large-v3"]
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base")
MODEL_NAME = DEFAULT_MODEL  # совместимость: модель по умолчанию

_MODEL: object | None = None
_MODEL_NAME: str | None = None   # какая модель загружена сейчас
_MODEL_LOCK = threading.Lock()
_CUDA_FAILED = False   # помним, что CUDA недоступна (например, нет cuBLAS)

# Диаризация (разделение по голосам) через pyannote.audio — ОПЦИОНАЛЬНО.
# Если пакет не установлен, распознавание работает как раньше (без спикеров).
try:
    from pyannote.audio import Pipeline as _PyannotePipeline  # type: ignore
    _DIAR_AVAILABLE = True
except Exception:  # pragma: no cover
    _DIAR_AVAILABLE = False

_DIAR_MODEL_ID = "pyannote/speaker-diarization-3.1"
_DIAR_PIPELINE: object | None = None
_DIAR_LOCK = threading.Lock()
_DIAR_CUDA_FAILED = False   # помним, что CUDA для диаризации недоступна/упала

# Все закрытые (gated) модели, которые нужны пайплайну диаризации.
# Для доступа на huggingface.co нужно принять условия (Agree and access).
# ВАЖНО: модель эмбеддингов называется ровно wespeaker-voxceleb-resnet34-LM
# (с суффиксом -LM) — без суффикса страницы нет (404).
_DIAR_GATED_MODELS = [
    "pyannote/speaker-diarization-3.1",
    "pyannote/segmentation-3.0",
    "pyannote/speaker-diarization-community-1",
    "pyannote/wespeaker-voxceleb-resnet34-LM",
]


def _friendly_diar_error(exc: Exception) -> str:
    """Превращает сырую ошибку диаризации в понятное сообщение.

    Ошибки «403/gated/нет доступа» — это почти всегда непринятые условия
    закрытых моделей Hugging Face. Их переводим в инструкцию; остальное
    показываем как есть.
    """
    msg = str(exc)
    low = msg.lower()
    if any(k in low for k in ("403", "gated", "authorized", "restricted",
                              "access", "conditions")):
        links = "\n".join(f"• https://huggingface.co/{m}" for m in _DIAR_GATED_MODELS)
        return (
            "Нет доступа к закрытым моделям диаризации на Hugging Face. "
            "Откройте каждую модель по ссылке и нажмите «Agree and access "
            "repository» (примите условия), затем повторите распознавание:\n"
            + links
        )
    return msg

# torchcodec (декодирование аудио в pyannote 4.x и torchaudio 2.9+) требует
# shared-сборку FFmpeg (DLL avcodec-*.dll и т.п.). Ищем её под C:\ffmpeg.
def _find_shared_ffmpeg_bin() -> str | None:
    import glob
    for d in glob.glob(r"C:\ffmpeg\**\bin", recursive=True):
        if glob.glob(os.path.join(d, "avcodec-*.dll")):
            return d
    return None


def _ensure_ffmpeg_shared_path() -> None:
    """Подключает shared-FFmpeg (DLL) для torchcodec: PATH + add_dll_directory.

    На Windows Python 3.8+ для поиска зависимых DLL надёжнее os.add_dll_directory,
    PATH одного может не хватить после импорта torch/pyannote.
    """
    b = _find_shared_ffmpeg_bin()
    if not b:
        return
    cur = os.environ.get("PATH", "")
    if b not in cur.split(os.pathsep):
        os.environ["PATH"] = b + os.pathsep + cur
    try:
        os.add_dll_directory(b)
    except Exception:
        pass


_ensure_ffmpeg_shared_path()


def available() -> bool:
    return _AVAILABLE


def loaded_model() -> str:
    """Имя загруженной в данный момент модели ('' — не загружена)."""
    return _MODEL_NAME or ""


def _collect() -> None:
    """Собирает мусор и пытается освободить память GPU (если есть PyTorch/CUDA)."""
    gc.collect()
    try:
        import torch  # type: ignore
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def unload_model() -> None:
    """Выгружает текущую модель из памяти (CPU+VRAM)."""
    global _MODEL, _MODEL_NAME
    with _MODEL_LOCK:
        _MODEL = None
        _MODEL_NAME = None
        _collect()


def _unload_diar() -> None:
    """Выгружает пайплайн диаризации из памяти (CPU+VRAM)."""
    global _DIAR_PIPELINE
    with _DIAR_LOCK:
        _DIAR_PIPELINE = None
        _collect()


def diarization_available() -> bool:
    """Доступна ли диаризация (установлен pyannote.audio)."""
    return _DIAR_AVAILABLE


def _diar_use_cuda() -> bool:
    """Можно ли запускать диаризацию на GPU (torch CUDA, без прошлых сбоев)."""
    if _DIAR_CUDA_FAILED:
        return False
    try:
        import torch  # type: ignore
        return torch.cuda.is_available()
    except Exception:
        return False


def diar_device() -> str:
    """Устройство для диаризации: 'cuda' | 'cpu'."""
    return "cuda" if _diar_use_cuda() else "cpu"


def _get_diar_pipeline(hf_token: str | None):
    """Возвращает загруженный пайплайн диаризации (ленивая инициализация).

    Первый запуск скачивает модели с Hugging Face (нужен токен и принятые
    условия модели pyannote/speaker-diarization-3.1).
    """
    global _DIAR_PIPELINE
    with _DIAR_LOCK:
        if _DIAR_PIPELINE is not None:
            return _DIAR_PIPELINE
        if not hf_token or not str(hf_token).strip():
            raise RuntimeError(
                "Для разделения по голосам укажите токен Hugging Face "
                "(huggingface.co/settings/tokens) и примите условия модели "
                f"{_DIAR_MODEL_ID}.")
        token = str(hf_token).strip()
        try:
            _DIAR_PIPELINE = _PyannotePipeline.from_pretrained(
                _DIAR_MODEL_ID, token=token)
        except TypeError as exc:
            # Старые версии pyannote.audio (3.x) принимают use_auth_token.
            if "token" in str(exc).lower():
                _DIAR_PIPELINE = _PyannotePipeline.from_pretrained(
                    _DIAR_MODEL_ID, use_auth_token=token)
            else:
                raise
        if _diar_use_cuda():
            try:
                import torch  # type: ignore
                _DIAR_PIPELINE = _DIAR_PIPELINE.to(torch.device("cuda"))
            except Exception:
                # GPU не поднялся — оставляем пайплайн на CPU.
                _DIAR_CUDA_FAILED = True
        return _DIAR_PIPELINE


def _load_audio_waveform(path: str) -> tuple:
    """Извлекает аудио из видео/аудио через ffmpeg и читает через soundfile.

    Возвращает (waveform[1, N] float32, sample_rate). Нужно, чтобы НЕ
    декодировать аудио через torchcodec (на Windows нестабилен на mp4:
    'json.loads ... not tuple'), а отдавать pyannote готовый waveform.
    """
    import numpy as np  # type: ignore
    import soundfile  # type: ignore
    import torch  # type: ignore
    from .ffmpeg_locate import FFMPEG

    tmp = tempfile.mkdtemp(prefix="diaraudio_")
    try:
        wav = os.path.join(tmp, "audio.wav")
        cmd = [FFMPEG, "-y", "-v", "error", "-i", path,
               "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0 or not os.path.isfile(wav):
            err = (proc.stderr or b"").decode("utf-8", "replace").strip()
            raise RuntimeError(
                f"Не удалось извлечь аудио для диаризации: {err[:200]}")
        data, sr = soundfile.read(wav, dtype="float32")
        if data.ndim == 1:
            data = data[None, :]
        waveform = torch.from_numpy(np.ascontiguousarray(data)).float()
        return waveform, int(sr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _run_diarization(pipeline, file, kwargs: dict) -> list[dict]:
    """Запускает пайплайн на файле (путь ИЛИ dict с waveform) и извлекает реплики.

    pyannote 4.x возвращает DiarizeOutput с полем speaker_diarization,
    3.x — Annotation напрямую. Оба умеют itertracks(yield_label=True).
    """
    diarization = pipeline(file, **kwargs)
    annotation = getattr(diarization, "speaker_diarization", diarization)
    turns = []
    for turn, _, label in annotation.itertracks(yield_label=True):
        turns.append({
            "start": round(float(turn.start), 2),
            "end": round(float(turn.end), 2),
            "speaker": str(label),
        })
    turns.sort(key=lambda t: t["start"])
    return turns


def diarize(path: str, hf_token: str | None = None,
            min_speakers: int | None = None, max_speakers: int | None = None,
            progress_cb=None) -> list[dict]:
    """Разделяет аудио по говорящим (pyannote.audio).

    Возвращает список реплик [{start, end, speaker}] с метками говорящих
    (SPEAKER_00, SPEAKER_01, ...). Требует установленного pyannote.audio
    и токена Hugging Face.
    """
    if not _DIAR_AVAILABLE:
        raise RuntimeError(
            "Для разделения по голосам установите pyannote.audio: "
            "pip install pyannote.audio torch torchaudio")
    _ensure_ffmpeg_shared_path()
    progress = progress_cb or (lambda f: None)
    progress(0.1)
    # Аудио отдаём пайплайну как готовый waveform (ffmpeg + soundfile),
    # чтобы обойти ненадёжный torchcodec (на Windows падает на mp4).
    waveform, sr = _load_audio_waveform(path)
    file = {"waveform": waveform, "sample_rate": sr}
    progress(0.25)
    pipeline = _get_diar_pipeline(hf_token)
    progress(0.4)
    kwargs = {}
    if min_speakers and int(min_speakers) >= 2:
        kwargs["min_speakers"] = int(min_speakers)
    if max_speakers and int(max_speakers) >= 2:
        kwargs["max_speakers"] = int(max_speakers)
    try:
        turns = _run_diarization(pipeline, file, kwargs)
    except Exception as exc:
        msg = str(exc).lower()
        used_cuda = _diar_use_cuda()
        if used_cuda and any(k in msg for k in (
                "cuda", "cublas", "cudnn", "out of memory", "nvidia")):
            # GPU упал — пересоздаём пайплайн на CPU и пробуем ещё раз.
            _DIAR_CUDA_FAILED = True
            with _DIAR_LOCK:
                _DIAR_PIPELINE = None
            _collect()
            pipeline = _get_diar_pipeline(hf_token)
            turns = _run_diarization(pipeline, file, kwargs)
        else:
            raise
    progress(1.0)
    return turns


def _friendly_speaker(raw: str) -> str:
    """SPEAKER_00 → «Спикер 1»; незнакомые метки оставляет как есть."""
    try:
        n = int(str(raw).split("_")[-1])
        return f"Спикер {n + 1}"
    except Exception:
        return str(raw)


def assign_speakers(words: list[dict],
                    turns: list[dict]) -> tuple[list[dict], list[str]]:
    """Приписывает каждому слову говорящего по пересечению с репликами.

    Слово относится к спикеру, если середина его интервала попадает в реплику
    этого спикера. Возвращает (слова с полем ``speaker``, упорядоченный список
    имён спикеров). Слова вне реплик получают speaker=None.
    """
    if not words or not turns:
        return words, []
    # «Человеческие» имена по порядку первого появления в репликах.
    order: list[str] = []
    raw_order: list[str] = []
    for t in turns:
        raw = t["speaker"]
        if raw not in raw_order:
            raw_order.append(raw)
            order.append(_friendly_speaker(raw))
    assigned = list(words)
    for w in assigned:
        try:
            mid = (float(w.get("start", 0.0)) + float(w.get("end", 0.0))) / 2.0
        except (TypeError, ValueError):
            w["speaker"] = None
            continue
        spk = None
        for t in turns:
            if t["start"] <= mid <= t["end"]:
                spk = _friendly_speaker(t["speaker"])
                break
        w["speaker"] = spk
    return assigned, order


def _cuda_available() -> bool:
    try:
        import ctranslate2  # type: ignore
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def get_model(engine: str = "auto", model: str | None = None):
    """Возвращает загруженную модель (ленивая инициализация).

    Если запрошена другая модель, чем загружена сейчас, — прошлая выгружается
    из памяти. Пытается использовать CUDA, если она реально работает; при любой
    ошибке (например, отсутствие cuBLAS) автоматически откатывается на CPU.
    """
    global _MODEL, _MODEL_NAME, _CUDA_FAILED
    model = (model or DEFAULT_MODEL).strip().lower()
    if model not in MODEL_OPTIONS:
        model = DEFAULT_MODEL

    with _MODEL_LOCK:
        if _MODEL is not None and _MODEL_NAME == model:
            return _MODEL

        # Сменилась модель (или первая загрузка) — выгружаем прошлую и собираем мусор.
        _MODEL = None
        _MODEL_NAME = None
        _collect()

        use_cuda = (
            engine in ("auto", "hybrid", "nvidia")
            and not _CUDA_FAILED
            and _cuda_available()
        )
        if use_cuda:
            try:
                _MODEL = WhisperModel(model, device="cuda", compute_type="float16")
                _MODEL_NAME = model
            except Exception:
                _CUDA_FAILED = True
                _MODEL = None

        if _MODEL is None:
            _MODEL = WhisperModel(model, device="cpu", compute_type="int8")
            _MODEL_NAME = model
        return _MODEL


def _transcribe_once(model, path: str, language: str | None,
                     progress_cb=None) -> dict:
    """Один проход транскрибации."""
    segments, info = model.transcribe(
        path,
        word_timestamps=True,
        language=language,
        vad_filter=True,
    )
    words: list[dict] = []
    duration = getattr(info, "duration", 0.0) or 0.0
    for seg in segments:
        if progress_cb and duration > 0:
            try:
                progress_cb(min(float(seg.end) / duration, 1.0))
            except Exception:
                pass
        for w in (seg.words or []):
            word = (w.word or "").strip()
            if word:
                words.append({
                    "word": word,
                    "start": round(float(w.start), 2),
                    "end": round(float(w.end), 2),
                })
    return {
        "duration": round(duration, 2),
        "language": getattr(info, "language", None) or "",
        "words": words,
    }


def transcribe(path: str, engine: str = "auto", language: str | None = None,
               model: str | None = None, progress_cb=None,
               do_diarize: bool = False, hf_token: str | None = None,
               min_speakers: int | None = None, max_speakers: int | None = None,
               diar_cb=None) -> dict:
    """Транскрибирует видео; при сбое CUDA автоматически переходит на CPU.

    Если ``do_diarize=True`` — дополнительно разделяет речь по голосам
    (pyannote.audio) и приписывает каждому слову спикера (поле ``speaker``),
    а в результат кладёт упорядоченный список ``speakers``. Сбой диаризации
    НЕ отменяет транскрипт: ошибка попадает в поле ``diarization_error``.

    После каждого локального распознавания модель ВЫГРУЖАЕТСЯ из памяти
    (RAM/VRAM), чтобы не держать её занятой между запусками. Файлы модели
    остаются в кеше на диске — при следующем распознавании она загрузится снова.
    """
    if not _AVAILABLE:
        raise RuntimeError("faster-whisper не установлен")

    global _MODEL, _MODEL_NAME, _CUDA_FAILED
    model = (model or DEFAULT_MODEL).strip().lower()
    if model not in MODEL_OPTIONS:
        model = DEFAULT_MODEL
    mdl = get_model(engine, model)
    try:
        try:
            result = _transcribe_once(mdl, path, language, progress_cb)
        except Exception as exc:
            msg = str(exc).lower()
            if any(k in msg for k in ("cublas", "cudnn", "cuda", "gpu")):
                # CUDA заявлена, но библиотеки не загружаются — откат на CPU.
                _CUDA_FAILED = True
                unload_model()
                mdl = get_model("cpu", model)
                result = _transcribe_once(mdl, path, language, progress_cb)
            else:
                raise
    finally:
        # Выгружаем модель после распознавания (и в случае ошибки тоже).
        unload_model()

    if do_diarize:
        try:
            turns = diarize(path, hf_token=hf_token, min_speakers=min_speakers,
                            max_speakers=max_speakers, progress_cb=diar_cb)
            result["words"], result["speakers"] = assign_speakers(
                result["words"], turns)
        except Exception as exc:
            # Транскрипт сохраняем, ошибку диаризации отдаём отдельным полем.
            result["diarization_error"] = _friendly_diar_error(exc)
            result.setdefault("speakers", [])
    _unload_diar()
    return result


def api_transcribe(path: str, endpoint: str | None = None,
                   api_key: str | None = None, model: str = "whisper-1",
                   language: str | None = None, progress_cb=None,
                   do_diarize: bool = False, hf_token: str | None = None,
                   min_speakers: int | None = None, max_speakers: int | None = None,
                   diar_cb=None) -> dict:
    """Распознавание через внешний OpenAI-совместимый endpoint.

    Отправляет аудиофайл multipart-запросом в ``POST {endpoint}`` и ожидает
    ответ ``response_format=verbose_json`` (с таймкодами слов). Если endpoint
    не возвращает слова — раскладываем текст сегментов по времени равномерно.

    Если ``do_diarize=True`` — дополнительно разделяет речь по голосам локально
    (pyannote.audio) и приписывает каждому слову спикера.
    """
    if not endpoint or not str(endpoint).strip():
        raise ValueError("Не указан endpoint для распознавания")

    import httpx  # type: ignore

    progress = progress_cb or (lambda f: None)
    progress(0.05)
    endpoint = str(endpoint).strip()
    with open(path, "rb") as f:
        files = {"file": (os.path.basename(path), f, "application/octet-stream")}
        data = {"model": model or "whisper-1", "response_format": "verbose_json"}
        if language:
            data["language"] = language
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        try:
            resp = httpx.post(endpoint, files=files, data=data,
                              headers=headers, timeout=900)
        except Exception as exc:
            raise RuntimeError(f"Не удалось связаться с API: {exc}") from exc
        if resp.status_code >= 400:
            raise RuntimeError(
                f"API вернул ошибку {resp.status_code}: {resp.text[:300]}")
        try:
            payload = resp.json()
        except Exception:
            raise RuntimeError("API вернул не-JSON ответ")

    segments = payload.get("segments") or []
    words: list[dict] = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        try:
            s0 = float(seg.get("start") or 0.0)
            s1 = float(seg.get("end") or s0)
        except (TypeError, ValueError):
            continue
        wlist = seg.get("words") or []
        if wlist:
            for w in wlist:
                if not isinstance(w, dict):
                    continue
                word = (w.get("word") or "").strip()
                if word:
                    words.append({
                        "word": word,
                        "start": round(float(w.get("start", s0)), 2),
                        "end": round(float(w.get("end", s1)), 2),
                    })
        else:
            # Слов с таймкодами нет — раскладываем текст сегмента равномерно.
            parts = (seg.get("text") or "").strip().split()
            n = len(parts)
            if n and s1 > s0:
                step = (s1 - s0) / n
                for k, w in enumerate(parts):
                    words.append({
                        "word": w,
                        "start": round(s0 + k * step, 2),
                        "end": round(s0 + (k + 1) * step, 2),
                    })

    duration = 0.0
    try:
        duration = float(payload.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    lang = payload.get("language") or ""
    progress(1.0)
    result = {"duration": round(duration, 2), "language": lang or "",
              "words": words}
    if do_diarize:
        try:
            turns = diarize(path, hf_token=hf_token, min_speakers=min_speakers,
                            max_speakers=max_speakers, progress_cb=diar_cb)
            result["words"], result["speakers"] = assign_speakers(
                result["words"], turns)
        except Exception as exc:
            result["diarization_error"] = _friendly_diar_error(exc)
            result.setdefault("speakers", [])
        finally:
            _unload_diar()
    return result


def search_words(words: list[dict], query: str, limit: int = 100) -> list[dict]:
    """Поиск слова (без учёта регистра) с контекстом вокруг."""
    q = (query or "").lower().strip()
    if not q or not words:
        return []
    results = []
    n = len(words)
    for i, w in enumerate(words):
        if q in (w.get("word") or "").lower():
            ctx_words = [x.get("word", "") for x in words[max(0, i - 4): i + 5]]
            results.append({
                "word": w.get("word", ""),
                "start": w.get("start", 0),
                "end": w.get("end", 0),
                "context": " ".join(ctx_words),
                "speaker": w.get("speaker"),
                "index": i,
            })
            if len(results) >= limit:
                break
    return results
