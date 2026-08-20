"""ИИ-анализ видео: выбор «интересных моментов» через внешний OpenAI-совместимый API.

Модель получает кадры видео (и/или распознанную речь) и по системному промпту
возвращает JSON-список моментов с таймкодами. Результат приводится к той же
структуре, что и у сигнального анализа (analyzer.analyze), чтобы остальной
интерфейс (таймлайн, список сегментов, монтаж) работал без изменений.
"""
from __future__ import annotations

import base64
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path

from . import analyzer
from .ffmpeg_locate import FFMPEG

# Промпт по умолчанию (используется, если пользователь не задал свой).
DEFAULT_SYSTEM_PROMPT = (
    "Ты — профессиональный видеомонтажёр. Анализируешь видео по кадрам "
    "(и, возможно, расшифровке речи). Какие моменты искать — задаёт пользователь.\n"
    "СТРОГИЕ ПРАВИЛА:\n"
    "1. НЕ размышляй вслух, НЕ пиши анализ, НЕ рассуждай по шагам.\n"
    "2. Ответь СРАЗУ ТОЛЬКО одним JSON-объектом, без markdown-ограждений "
    "(без ```) и без текста до/после.\n"
    '3. Формат: {"segments":[{"start":<сек>,"end":<сек>,"reason":"..."}]}.\n'
    "4. start/end — числа в секундах, в пределах длительности видео.\n"
    "5. Сегменты не пересекаются; не выдумывай моменты, которых нет в кадрах.\n"
    '6. Если подходящих моментов нет — верни {"segments":[]}.'
)

DEFAULT_FRAME_STEP = 10   # отправлять каждый N-й кадр видео по умолчанию


class AnalysisCancelled(RuntimeError):
    """Анализ отменён пользователем (кнопка «Стоп»)."""


def extract_frames(path: str, start: float, span_sec: float, frame_step: int,
                   out_dir: str, source_fps: float = 30.0) -> list:
    """Вырезает каждый N-й кадр (frame_step) в окне [start, start+span_sec].

    Число N трактуется БУКВАЛЬНО: написано 10 — каждый 10-й кадр, 15 — каждый
    15-й и т.д.; шаг не ограничен и не масштабируется. Один проход ffmpeg с
    быстрым seek (-ss до -i). Возвращает [(абсолютное_время, путь_к_jpg)];
    пустое окно → [].
    """
    step = max(1, int(frame_step))
    src_fps = float(source_fps) if source_fps and source_fps > 0 else 30.0
    fps = src_fps / step

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    cmd = [
        FFMPEG, "-v", "error",
        "-ss", f"{max(0.0, start):.3f}",
        "-t", f"{max(0.0, span_sec):.3f}",
        "-i", path,
        "-vf", f"fps={fps},scale=480:-2",
        "-q:v", "3",
        "-f", "image2",
        str(out / "f_%05d.jpg"),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True)
    except FileNotFoundError:
        raise RuntimeError("ffmpeg не найден — не могу извлечь кадры для ИИ")
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError(f"Не удалось извлечь кадры из видео: {err[:300]}")

    files = sorted(out.glob("f_*.jpg"))
    frames = [(round(start + i / fps, 2), str(f)) for i, f in enumerate(files)]
    return frames


def _split_windows(duration: float, chunk_sec: float) -> list[tuple[float, float]]:
    """Разбивает [0, duration] на окна по chunk_sec секунд.

    chunk_sec <= 0 — одно окно на всё видео (без разбиения).
    """
    if not duration or duration <= 0:
        return [(0.0, 0.0)]
    chunk = float(chunk_sec)
    if not chunk or chunk <= 0:
        return [(0.0, float(duration))]
    windows = []
    start = 0.0
    while start < duration:
        end = min(start + chunk, duration)
        windows.append((start, end))
        start = end
    return windows


def _words_in_window(words: list[dict], w0: float, w1: float) -> list[dict]:
    """Слова речи, попадающие в окно [w0, w1)."""
    return [w for w in words
            if w.get("start") is not None
            and w0 <= float(w["start"]) < w1]


def _normalize_endpoint(endpoint: str) -> str:
    """Приводит endpoint к полному пути /chat/completions."""
    ep = (endpoint or "").strip().rstrip("/")
    if not ep:
        raise ValueError("Не указан endpoint для ИИ-анализа")
    if not ep.endswith("/chat/completions"):
        ep += "/chat/completions"
    return ep


def _chat(endpoint: str, api_key: str | None, model: str,
          messages: list, timeout: int = 900) -> str:
    """Один вызов chat/completions; возвращает текст ответа модели.

    Пробует несколько вариантов тела запроса: сначала с response_format=json_object
    и отключением режима «размышлений» (think: False — важно для qwen3-подобных
    моделей, которые иначе тратят все токены на reasoning_content). Провайдеры,
    не знающие нестандартных полей, отвечают 400 — тогда пробуем упрощённый
    вариант. Если в ответе пустой content, но есть reasoning_content — используем
    его как запасной источник для парсинга JSON.
    """
    import httpx  # type: ignore

    url = _normalize_endpoint(endpoint)
    body = {
        "model": model or "gpt-4o-mini",
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key.strip()}"

    # Варианты: полный (json_object + без размышлений) -> без response_format ->
    # базовый. Откаты нужны для локальных/строгих провайдеров.
    candidates = [
        {**body, "response_format": {"type": "json_object"}, "think": False},
        {**body, "think": False},
        body,
    ]
    resp = None
    for cand in candidates:
        try:
            resp = httpx.post(url, json=cand, headers=headers, timeout=timeout)
        except Exception as exc:
            raise RuntimeError(f"Не удалось связаться с ИИ-API: {exc}") from exc
        if resp.status_code != 400:
            break
    if resp is None or resp.status_code >= 400:
        raise RuntimeError(
            f"ИИ-API вернул ошибку {resp.status_code}: "
            f"{(resp.text[:300] if resp is not None else '')}")

    try:
        data = resp.json()
    except Exception:
        raise RuntimeError("ИИ-API вернул не-JSON ответ")

    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError(
            "ИИ-API вернул некорректный ответ (нет choices[0].message)")

    content = msg.get("content") or ""
    if not content.strip():
        # «Рассуждающие» модели иногда кладут итоговый ответ в reasoning_content.
        content = msg.get("reasoning_content") or ""
    return content


def parse_segments(text: str, duration: float, min_len: float = 1.0) -> list[dict]:
    """Разбирает ответ ИИ (JSON) в список сегментов {start,end,reason,source:'ai'}.

    Устойчиво к ```json ... ``` ограждениям и лишнему тексту вокруг JSON.
    Значения клампируются в [0, duration], сегменты сортируются по времени.
    """
    if not text:
        return []
    t = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", t, re.S | re.I)
    if fence:
        t = fence.group(1).strip()
    # Предпочитаем объект с "segments" — в «рассуждениях» модели может быть
    # много текста и лишних скобок.
    start = t.find('"segments"')
    if start >= 0:
        start = t.rfind("{", 0, start)
    if start < 0:
        start = t.find("{")
    end = t.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(t[start:end + 1])
    except Exception:
        return []

    segs = data.get("segments") if isinstance(data, dict) else data
    if not isinstance(segs, list):
        return []

    out = []
    for s in segs:
        if not isinstance(s, dict):
            continue
        try:
            a = float(s.get("start"))
            b = float(s.get("end"))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(a) or not math.isfinite(b) or b <= a:
            continue
        a = max(0.0, a)
        b = min(duration, b) if duration > 0 else b
        if b - a < min_len:
            continue
        try:
            score = float(s.get("score"))
        except (TypeError, ValueError):
            score = 0.0
        if not math.isfinite(score):
            score = 0.0
        out.append({
            "start": round(a, 3),
            "end": round(b, 3),
            "score": round(score, 1),
            "peak": 0.0,
            "reason": str(s.get("reason", "")).strip(),
            "source": "ai",
        })
    out.sort(key=lambda x: x["start"])
    return out


def _words_to_text(words: list[dict]) -> str:
    """Форматирует слова для ИИ.

    Если есть спикеры (диаризация) — группирует подряд идущие слова одного
    говорящего в реплики «Спикер N [t0-t1]: текст» (компактно, экономит токены,
    и модели видно, кто говорит). Иначе — по слову на строку с таймкодом.
    """
    if not words:
        return ""
    has_speakers = any(w.get("speaker") for w in words)
    if not has_speakers:
        lines = []
        for w in words:
            st = w.get("start")
            en = w.get("end")
            word = str(w.get("word", "")).strip()
            if word and st is not None and en is not None:
                lines.append(f"[{st:.1f}-{en:.1f}] {word}")
        return "\n".join(lines)

    parts: list[str] = []
    group_words: list[str] = []
    group_spk: str | None = None
    group_start: float | None = None
    group_end: float | None = None
    prev_end: float | None = None

    def flush():
        nonlocal group_words, group_spk, group_start, group_end
        if not group_words:
            return
        label = group_spk or "—"
        parts.append(f"{label} [{group_start:.1f}-{group_end:.1f}]: "
                     + " ".join(group_words))
        group_words, group_spk, group_start, group_end = [], None, None, None

    for w in words:
        word = str(w.get("word", "")).strip()
        st = w.get("start")
        en = w.get("end")
        if not word or st is None or en is None:
            continue
        spk = w.get("speaker") or None
        gap = (float(st) - prev_end) if prev_end is not None else 0.0
        if group_spk is not None and (spk != group_spk or gap > 2.0):
            flush()
        if group_start is None:
            group_start = float(st)
            group_spk = spk
        group_words.append(word)
        group_end = float(en)
        prev_end = float(en)
    flush()
    return "\n".join(parts)


def _build_messages(system_prompt: str, *, method: str, duration: float,
                    frames: list, words: list[dict],
                    window: tuple[float, float] | None = None,
                    max_segments: int = 0) -> list[dict]:
    """Собирает сообщения для чата: системный промпт + кадры/речь пользователя.

    window=(start, end) — если анализируется фрагмент видео, в инструкцию
    добавляется его диапазон, чтобы модель возвращала таймкоды в его пределах.
    max_segments > 0 — ограничение числа моментов на всё видео: модель просят
    проставлять score (1..100) каждому сегменту и не возвращать больше, чем
    нужно (итоговый отбор по score делает api_analyze).
    """
    if window and window[1] > window[0]:
        range_note = (
            f"Анализируй фрагмент видео с {window[0]:.1f}с по {window[1]:.1f}с. "
            f"Длительность всего видео: {duration:.1f}с.\n")
    else:
        range_note = f"Длительность видео: {duration:.1f} секунд.\n"
    has_speakers = any(w.get("speaker") for w in (words or []))
    speakers_note = (
        "В расшифровке реплики помечены спикером («Спикер N: …») — учитывай, "
        "кто говорит, при выборе моментов (реплики персонажей, диалоги).\n"
        if has_speakers else "")
    if max_segments and max_segments > 0:
        per_window = max(1, min(int(max_segments), 10))
        count_note = (
            f"Всего по ВСЕМУ видео нужно выбрать максимум {max_segments} "
            "моментов. У каждого сегмента указывай score — целое число 1..100, "
            "насколько момент важен/интересен (100 — самый важный); при отборе "
            "самых интересных учитывается score.\n"
            f"В этом фрагменте верни не более {per_window} сегментов.\n")
        seg_format = ('{"segments":[{"start":<сек>,"end":<сек>,'
                      '"reason":"...","score":<1-100>}]}')
        max_note = f"Максимум {per_window} сегментов.\n"
    else:
        count_note = ""
        seg_format = '{"segments":[{"start":<сек>,"end":<сек>,"reason":"..."}]}'
        max_note = "Максимум 10 сегментов.\n"
    instruction = (
        range_note +
        count_note +
        "НЕ размышляй вслух и не пиши никаких пояснений.\n"
        'Ответь ТОЛЬКО одним JSON-объектом без markdown-ограждений (```) и без '
        'лишнего текста: ' + seg_format + '.\n'
        "start/end — числа в секундах, в пределах фрагмента и всего видео. "
        "Сегменты не пересекаются. " + max_note +
        speakers_note +
        'Если интересных моментов нет — верни {"segments":[]}.'
    )
    content: list[dict] = [{"type": "text", "text": instruction}]

    if method in ("frames", "frames_speech"):
        for t, img in frames:
            with open(img, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            content.append({"type": "text", "text": f"Кадр в момент {t:.1f}с:"})
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })

    if method in ("frames_speech", "speech"):
        if words:
            content.append({
                "type": "text",
                "text": "Расшифровка речи с таймкодами:\n" + _words_to_text(words),
            })
        else:
            content.append({
                "type": "text",
                "text": "Расшифровка речи недоступна — оценивай только по визуалу.",
            })

    # Промпт пользователя ДОБАВЛЯЕТСЯ к основному, а не заменяет его.
    base_prompt = DEFAULT_SYSTEM_PROMPT
    user_part = (system_prompt or "").strip()
    final_system = base_prompt + ("\n\n" + user_part if user_part else "")
    return [
        {"role": "system", "content": final_system},
        {"role": "user", "content": content},
    ]


def api_analyze(path: str, *, endpoint: str, api_key: str | None, model: str,
                system_prompt: str, method: str = "frames", duration: float,
                words: list[dict] | None = None,
                frame_step: int = DEFAULT_FRAME_STEP, source_fps: float = 30.0,
                chunk_sec: float = 0.0, progress_cb=None,
                start_index: int = 0, initial_segments: list[dict] | None = None,
                pause_event=None, cancel_event=None, pause_cb=None,
                max_segments: int = 0) -> list[dict]:
    """Анализирует видео через ИИ-API. Возвращает список сегментов.

    method: 'frames' | 'frames_speech' | 'speech'.
    frame_step — каждый N-й кадр. chunk_sec — длительность фрагмента видео,
    обрабатываемого ОДНИМ запросом: кадры фрагмента отправляются, ждём ответ,
    затем следующий фрагмент (так контекст модели не переполняется).
    chunk_sec <= 0 — всё видео одним запросом.

    Пауза/возобновление: между «частями» (окнами) ответов ИИ проверяется
    pause_event (threading.Event). Когда он установлен, вызывается
    pause_cb(index, segments, total, pos_sec) — сохранение контрольной точки — и
    поток ждёт, пока событие снимут (продолжить) или установят cancel_event
    (отмена, AnalysisCancelled). start_index/initial_segments позволяют
    продолжить анализ с ранее сохранённой контрольной точки.

    progress_cb вызывается как progress_cb(frac, pos_sec, seg_count): frac —
    доля окон, pos_sec — до какой секунды видео уже «просмотрено» (конец
    текущего окна), seg_count — сколько моментов уже найдено.

    max_segments > 0 — итоговое ограничение числа моментов: у сегментов
    учитывается score (модель просят его проставлять), оставляются N самых
    высоких по score, затем сортировка по времени.
    """
    progress = progress_cb or (lambda *a: None)
    if not endpoint or not str(endpoint).strip():
        raise ValueError("Не указан endpoint для ИИ-анализа")

    windows = _split_windows(duration, chunk_sec)
    total = max(len(windows), 1)
    start_index = max(0, min(int(start_index or 0), total))
    all_segments = list(initial_segments or [])
    sent_frames = 0
    i = start_index
    while i < total:
        # Пауза/остановка между частями (окнами) ответов ИИ.
        if cancel_event is not None and cancel_event.is_set():
            raise AnalysisCancelled("Анализ отменён пользователем")
        if pause_event is not None and pause_event.is_set():
            if pause_cb:
                pause_cb(i, all_segments, total, windows[i][0])
            while pause_event.is_set():
                if cancel_event is not None and cancel_event.is_set():
                    raise AnalysisCancelled("Анализ отменён пользователем")
                pause_event.wait(0.5)

        w_start, w_end = windows[i]
        if method in ("frames", "frames_speech"):
            with tempfile.TemporaryDirectory(prefix="aiframes_") as tmp:
                progress(min(0.95, (i + 0.25) / total),
                         w_end, len(all_segments))
                frames = extract_frames(path, w_start, w_end - w_start,
                                        frame_step, tmp, source_fps)
                sent_frames += len(frames)
                if not frames:
                    i += 1
                    continue   # пустой фрагмент — нечего отправлять
                progress(min(0.95, (i + 0.45) / total),
                         w_end, len(all_segments))
                w_words = _words_in_window(words or [], w_start, w_end)
                messages = _build_messages(
                    system_prompt, method=method, duration=duration,
                    window=(w_start, w_end), frames=frames, words=w_words,
                    max_segments=max_segments)
                raw = _chat(endpoint, api_key, model, messages)
        else:  # speech
            progress(min(0.95, (i + 0.4) / total),
                     w_end, len(all_segments))
            w_words = _words_in_window(words or [], w_start, w_end)
            messages = _build_messages(
                system_prompt, method=method, duration=duration,
                window=(w_start, w_end), frames=[], words=w_words,
                max_segments=max_segments)
            raw = _chat(endpoint, api_key, model, messages)
        all_segments += parse_segments(raw, duration)
        progress(min(0.99, (i + 1) / total),
                 w_end, len(all_segments))
        i += 1

    if (method in ("frames", "frames_speech") and sent_frames == 0
            and start_index < total):
        raise RuntimeError("Не удалось извлечь кадры для ИИ-анализа")

    # Пользователь задал лимит числа моментов: оставляем N самых важных по
    # score (модель просили проставлять score; если не проставила — score=0,
    # сохраняется хронологический порядок).
    if max_segments and max_segments > 0 and len(all_segments) > max_segments:
        ranked = sorted(all_segments,
                        key=lambda s: -float(s.get("score") or 0.0))
        all_segments = sorted(ranked[:int(max_segments)],
                              key=lambda s: s["start"])

    all_segments.sort(key=lambda s: s["start"])
    return all_segments


def build_heatmap(segments: list[dict], duration: float, step: float = 0.5) -> list[dict]:
    """Тепловая карта из ИИ-сегментов (внутри сегмента — 1.0, иначе 0)."""
    heat = []
    t = 0.0
    while t <= duration:
        val = 1.0 if any(s["start"] <= t <= s["end"] for s in segments) else 0.0
        heat.append({"t": round(t, 2), "s": round(val, 4)})
        t += step
    return heat


def merge_with_existing(existing: list[dict], ai_segments: list[dict],
                        overlap_ratio: float = 0.5) -> list[dict]:
    """Добавляет ИИ-сегменты к существующим (сигнальным).

    Существующим сегментам проставляется source='signals', если его нет.
    ИИ-сегмент отбрасывается, если перекрыт существующим более чем на
    overlap_ratio — чтобы в очереди монтажа не было дублей.
    """
    base = []
    for s in existing:
        s2 = dict(s)
        s2.setdefault("source", "signals")
        base.append(s2)

    out = list(base)
    for ai in ai_segments:
        span = max(ai["end"] - ai["start"], 1e-6)
        covered = False
        for s in out:
            ov = min(ai["end"], s["end"]) - max(ai["start"], s["start"])
            if ov > 0 and ov / span > overlap_ratio:
                covered = True
                break
        if not covered:
            out.append(ai)
    out.sort(key=lambda x: x["start"])
    return out


def analyze_with_ai(path: str, *, endpoint: str, api_key: str | None, model: str,
                    system_prompt: str, method: str = "frames",
                    frame_step: int = DEFAULT_FRAME_STEP,
                    chunk_sec: float = 0.0,
                    words: list[dict] | None = None,
                    progress_cb=None, start_index: int = 0,
                    initial_segments: list[dict] | None = None,
                    pause_event=None, cancel_event=None,
                    pause_cb=None, max_segments: int = 0) -> dict:
    """Полный ИИ-анализ видео — возвращает структуру как у analyzer.analyze.

    frame_step — каждый N-й кадр. chunk_sec — сколько секунд видео уходит за
    один запрос (отправка по частям, чтобы не переполнять контекст).
    start_index/initial_segments/pause_event/cancel_event/pause_cb — поддержка
    паузы/возобновления (см. api_analyze).
    Важно: API-ключ НЕ попадает в результат/options (и, соответственно, в кеш).
    """
    info = analyzer.probe_video(path)
    duration = info["duration"]
    source_fps = info.get("fps") or 30.0
    segments = api_analyze(
        path, endpoint=endpoint, api_key=api_key, model=model,
        system_prompt=system_prompt, method=method, duration=duration,
        words=words or [], frame_step=frame_step, source_fps=source_fps,
        chunk_sec=chunk_sec, progress_cb=progress_cb,
        start_index=start_index, initial_segments=initial_segments,
        pause_event=pause_event, cancel_event=cancel_event,
        pause_cb=pause_cb, max_segments=max_segments)
    heatmap = build_heatmap(segments, duration)
    return {
        "info": info,
        "threshold": 0.0,
        "segments": segments,
        "heatmap": heatmap,
        "options": {
            "method": "ai",
            "ai_input": method,
            "ai_model": model,
            "ai_frame_step": frame_step,
            "ai_chunk_sec": chunk_sec,
            "ai_max_segments": max_segments,
            "source": "ai",
        },
    }
