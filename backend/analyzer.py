"""Анализ видео: поиск «интересных моментов» на основе нескольких сигналов.

Сигналы:
  - аудиоэнергия (громкость: крики, аплодисменты, музыкальные всплески)
  - смена сцен (гистограммное различие кадров)
  - интенсивность движения (различие соседних кадров)

Все сигналы нормализуются, взвешиваются и объединяются в кривую «интересности»,
после чего выделяются сегменты выше порога.
"""
from __future__ import annotations

import json
import math
import subprocess

import cv2
import numpy as np

from .ffmpeg_locate import FFPROBE, FFMPEG, cuda_decode_available

# Размер «мини-кадра» для визуального анализа (ускорение).
MINI_W, MINI_H = 48, 27


def probe_video(path: str) -> dict:
    """Возвращает метаданные видео (длительность, разрешение, fps, аудио).

    При неудаче — понятное сообщение (частая причина: битый/недописанный файл,
    например, у фрагментированных записей игр нет индекса moov).
    """
    cmd = [
        FFPROBE, "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        path,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffprobe не смог прочитать файл (таймаут). "
                           "Возможно, файл повреждён или слишком велик.")
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", "replace").strip()
        if "moov atom not found" in err.lower():
            raise RuntimeError(
                "Файл повреждён или запись не завершена: в видео отсутствует индекс "
                "moov. Попробуйте пересохранить/перезаписать видео и загрузить снова."
            )
        raise RuntimeError(f"ffprobe не смог прочитать файл: {err or 'неизвестная ошибка'}")
    info = json.loads(proc.stdout.decode("utf-8", "replace"))

    video = None
    audio = None
    for st in info.get("streams", []):
        if st.get("codec_type") == "video" and video is None:
            video = st
        elif st.get("codec_type") == "audio" and audio is None:
            audio = st

    duration = 0.0
    try:
        duration = float(info.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if video:
        try:
            duration = float(video.get("duration") or duration)
        except (TypeError, ValueError):
            pass

    fps = 30.0
    if video:
        avg = video.get("avg_frame_rate", "0/1")
        try:
            num, den = avg.split("/")
            fps = float(num) / float(den) if float(den) else 30.0
        except (ValueError, ZeroDivisionError):
            fps = 30.0
        if not math.isfinite(fps) or fps <= 0:
            fps = 30.0

    return {
        "duration": duration,
        "width": int(video.get("width", 0)) if video else 0,
        "height": int(video.get("height", 0)) if video else 0,
        "fps": round(fps, 3),
        "has_audio": audio is not None,
        "video_codec": (video or {}).get("codec_name", ""),
        "audio_codec": (audio or {}).get("codec_name", ""),
    }


def extract_audio_energy(path: str, sr: int = 8000, hop_s: float = 0.5):
    """Извлекает энергию аудио (RMS) по окнам hop_s с помощью ffmpeg.

    Возвращает (rms: np.ndarray, hop_s).
    """
    cmd = [FFMPEG, "-v", "error", "-i", path,
           "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              check=False)
    except FileNotFoundError:
        return np.zeros(0), hop_s
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if data.size == 0:
        return np.zeros(0), hop_s
    chunk = int(sr * hop_s)
    n = (data.size // chunk) * chunk
    if n == 0:
        return np.zeros(1), hop_s
    frames = data[:n].reshape(-1, chunk)
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    return rms, hop_s


def compute_visual_signals(path: str, sample_fps: float = 2.0, duration: float = 0.0):
    """Вычисляет сигналы смены сцен и движения по видео.

    Возвращает (times, scene, motion) — np.ndarray одинаковой длины.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return np.zeros(0), np.zeros(0), np.zeros(0)

    nframes = max(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), 0)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0
    if not duration or duration <= 0:
        duration = nframes / fps if nframes else 0.0

    # Ограничиваем число сэмплов, чтобы не утонуть на очень длинных видео.
    max_samples = 30000
    if duration * sample_fps > max_samples:
        sample_fps = max(0.5, max_samples / duration)

    step = 1.0 / sample_fps
    n_samp = max(1, int(duration / step))
    times = np.arange(n_samp) * step

    # Кадры будем читать последовательно, обрабатывая каждый N-й (эффективнее seek).
    frame_interval = max(1, round(fps * step))
    target_step_frames = max(1, int(round(fps * step)))

    scene = []
    motion = []
    prev = None
    frame_idx = 0
    next_frame = 0
    col = np.zeros((MINI_H, MINI_W), dtype=np.float32)

    while frame_idx < n_samp:
        cap.set(cv2.CAP_PROP_POS_FRAMES, next_frame)
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (MINI_W, MINI_H), interpolation=cv2.INTER_AREA)
        gray = gray.astype(np.float32)

        if prev is None:
            scene.append(0.0)
            motion.append(0.0)
        else:
            # Гистограммное различие (смена сцены).
            h1 = cv2.calcHist([gray], [0], None, [32], [0, 256])
            h2 = cv2.calcHist([prev], [0], None, [32], [0, 256])
            d = float(cv2.compareHist(h1, h2, cv2.HISTCMP_BHATTACHARYYA))
            scene.append(d)
            # Различие кадров (движение).
            m = float(np.mean(np.abs(gray - prev)) / 255.0)
            motion.append(m)
        prev = gray
        frame_idx += 1
        next_frame += target_step_frames

    cap.release()
    n = min(len(times), len(scene), len(motion))
    return times[:n], np.array(scene[:n], dtype=np.float64), np.array(motion[:n], dtype=np.float64)


def _bhattacharyya(a, b):
    """Бхаттачарья-расстояние между двумя гистограммами (0..1)."""
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    sa, sb = a.sum(), b.sum()
    if sa <= 0 or sb <= 0:
        return 1.0
    a /= sa
    b /= sb
    bc = float(np.sum(np.sqrt(a * b)))
    if bc <= 0:
        return 1.0
    return float(np.sqrt(max(0.0, 1.0 - bc)))


def compute_visual_signals_ffmpeg(path: str, sample_fps: float = 2.0,
                                  duration: float = 0.0,
                                  hwaccel: str | None = None):
    """Визуальный анализ через ffmpeg (единый путь для CPU и GPU).

    hwaccel='cuda' включает аппаратное декодирование (NVDEC), иначе —
    программное. В обоих случаях выбор кадров и их обработка идентичны,
    поэтому результаты анализа CPU и GPU совпадают.
    Возвращает (times, scene, motion) — np.ndarray.
    """
    max_samples = 30000
    if duration * sample_fps > max_samples:
        sample_fps = max(0.5, max_samples / duration)

    cmd = [FFMPEG, "-v", "error"]
    if hwaccel:
        cmd += ["-hwaccel", hwaccel]
    cmd += [
        "-i", path,
        "-vf", f"fps={sample_fps},scale={MINI_W}:{MINI_H},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    frame_bytes = MINI_W * MINI_H
    times = []
    scene = []
    motion = []
    prev = None
    t = 0.0
    try:
        while True:
            raw = proc.stdout.read(frame_bytes)
            if len(raw) < frame_bytes:
                break
            gray = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
            gray = gray.reshape(MINI_H, MINI_W)
            if prev is None:
                scene.append(0.0)
                motion.append(0.0)
            else:
                h1, _ = np.histogram(gray, bins=32, range=(0, 256))
                h2, _ = np.histogram(prev, bins=32, range=(0, 256))
                scene.append(_bhattacharyya(h1, h2))
                motion.append(float(np.mean(np.abs(gray - prev)) / 255.0))
            prev = gray
            times.append(t)
            t += 1.0 / sample_fps
    finally:
        proc.stdout.close()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

    n = min(len(times), len(scene), len(motion))
    return (np.array(times[:n], dtype=np.float64),
            np.array(scene[:n], dtype=np.float64),
            np.array(motion[:n], dtype=np.float64))


def _normalize(x: np.ndarray) -> np.ndarray:
    """Нормализация сигнала: вычитаем медиану, масштабируем по 95-му перцентилю."""
    if x.size == 0:
        return x
    x = x - np.median(x)
    p = float(np.percentile(x, 95))
    if p <= 1e-9:
        return np.zeros_like(x)
    return x / p


def _smooth(x: np.ndarray, win: int) -> np.ndarray:
    if x.size == 0 or win <= 1:
        return x
    win = int(win)
    kernel = np.ones(win, dtype=np.float64) / win
    return np.convolve(x, kernel, mode="same")


def extract_segments(score: np.ndarray, times: np.ndarray, duration: float,
                     threshold: float, min_len: float, max_len: float,
                     merge_gap: float = 0.8, pad: float = 0.3):
    """Выделяет сегменты из кривой интересности выше порога."""
    if score.size == 0 or times.size == 0:
        return []

    mask = score > threshold
    step = (times[-1] - times[0]) / max(1, len(times) - 1) if len(times) > 1 else 1.0

    # Группируем по индексам.
    runs = []
    start = None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(mask) - 1))

    if not runs:
        return []

    # Превращаем в интервалы и склеиваем близкие.
    segs = []
    for s, e in runs:
        t0 = times[s]
        t1 = times[e] + step
        segs.append([t0, t1])

    merged = [list(segs[0])]
    for t0, t1 in segs[1:]:
        if t0 - merged[-1][1] <= merge_gap:
            merged[-1][1] = t1
        else:
            merged.append([t0, t1])

    # Разрезаем слишком длинные, отбрасываем слишком короткие, добавляем отступы.
    result = []
    for t0, t1 in merged:
        length = t1 - t0
        if length < min_len:
            continue
        if length <= max_len:
            chunks = [(t0, t1)]
        else:
            chunks = []
            cur = t0
            while cur + max_len < t1:
                chunks.append((cur, cur + max_len))
                cur += max_len
            chunks.append((cur, t1))
        for a, b in chunks:
            a = max(0.0, a - pad)
            b = min(duration, b + pad)
            if b - a >= min_len:
                result.append([a, b])

    # Сортируем по времени и присваиваем пиковую оценку.
    result.sort(key=lambda x: x[0])
    out = []
    for a, b in result:
        idx = np.searchsorted(times, (a + b) / 2)
        idx = min(max(idx, 0), len(score) - 1)
        peak = float(np.max(score[max(0, idx - 2): idx + 3])) if score.size else 0.0
        out.append({
            "start": round(a, 3),
            "end": round(b, 3),
            "score": round(float(score[idx]), 4),
            "peak": round(peak, 4),
        })
    return out


def _visual_signals(path: str, sample_fps: float, duration: float, engine: str):
    """Выбор пути анализа: GPU (аппаратное декодирование) или CPU (ffmpeg).

    Оба пути используют один и тот же ffmpeg-конвейер с одинаковой выборкой
    кадров, поэтому результаты идентичны — разница только в скорости декодирования.
    """
    hwaccel = None
    if engine in ("gpu", "auto", "hybrid") and cuda_decode_available():
        hwaccel = "cuda"

    try:
        v = compute_visual_signals_ffmpeg(path, sample_fps, duration, hwaccel)
        if v[0].size > 0:
            return v
    except Exception:
        pass

    # Аппаратное декодирование не сработало (например, кодек не поддержан NVDEC).
    if hwaccel:
        try:
            v = compute_visual_signals_ffmpeg(path, sample_fps, duration, None)
            if v[0].size > 0:
                return v
        except Exception:
            pass

    # Последний рубеж — OpenCV.
    return compute_visual_signals(path, sample_fps, duration)


def analyze(path: str, *, sensitivity: float = 1.0, min_len: float = 1.0,
            max_len: float = 45.0, use_audio: bool = True, use_scene: bool = True,
            use_motion: bool = True, sample_fps: float = 4.0,
            engine: str = "auto") -> dict:
    """Полный анализ видео. Возвращает метаданные, кривую интересности и сегменты."""
    info = probe_video(path)
    duration = info["duration"]

    times = np.arange(0, max(duration, 0.001), 0.5)
    score = np.zeros(len(times), dtype=np.float64)
    used = 0.0

    # --- Визуальные сигналы (GPU или CPU) ---
    v_times, scene, motion = _visual_signals(path, sample_fps, duration, engine)

    if use_scene and v_times.size:
        s_scene = _smooth(_normalize(scene), int(sample_fps * 1.5))
        score += np.interp(times, v_times, s_scene) * 0.35
        used += 0.35
    if use_motion and v_times.size:
        s_motion = _smooth(_normalize(motion), int(sample_fps * 2.0))
        score += np.interp(times, v_times, s_motion) * 0.30
        used += 0.30

    # --- Аудиоэнергия ---
    if use_audio and info["has_audio"]:
        rms, hop = extract_audio_energy(path)
        if rms.size:
            a_times = np.arange(rms.size) * hop
            s_audio = _smooth(_normalize(rms), max(2, int(1.0 / hop)))
            score += np.interp(times, a_times, s_audio) * 0.35
            used += 0.35

    if used > 0:
        score /= used

    # Сглаживаем итог.
    score = _smooth(score, max(2, int(sample_fps)))

    mean = float(np.mean(score))
    std = float(np.std(score))
    threshold = mean + sensitivity * std

    segments = extract_segments(
        score, times, duration,
        threshold=threshold,
        min_len=min_len,
        max_len=max_len,
    )

    # Кривая для тепловой карты (прореживаем до ~1 значения/сек).
    heat = []
    heat_step = max(0.5, duration / 1200.0)
    ht = 0.0
    while ht <= duration:
        idx = int(round(ht / 0.5))
        idx = min(max(idx, 0), len(score) - 1)
        heat.append({"t": round(ht, 2), "s": round(float(score[idx]), 4)})
        ht += heat_step

    return {
        "info": info,
        "threshold": round(threshold, 4),
        "segments": segments,
        "heatmap": heat,
        "options": {
            "sensitivity": sensitivity,
            "min_len": min_len,
            "max_len": max_len,
            "use_audio": use_audio,
            "use_scene": use_scene,
            "use_motion": use_motion,
            "engine": engine,
        },
    }
