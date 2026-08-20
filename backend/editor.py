"""Монтаж: нарезка сегментов и склейка в итоговое видео через ffmpeg.

Поддержка:
  - движков обработки: CPU (libx264/x265/vp9) и аппаратных (NVENC/AMF/QSV),
    включая «гибрид» (аппаратный с фолбэком на CPU);
  - форматов экспорта: MP4 (H.264/HEVC), WebM (VP9), MKV;
  - кроссфейдов между сегментами (xfade + acrossfade);
  - контроля качества (CRF).
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

from .ffmpeg_locate import (
    FFMPEG,
    FFPROBE,
    CPU_ENCODERS,
    available_hw_encoders,
)

# Единые параметры для всех клипов, чтобы их можно было склеить без перекодировки.
OUT_FPS = 30
AUDIO_SR = 48000
AUDIO_CH = 2
AUDIO_BITRATE = "160k"

# Форматы экспорта: id -> конфигурация.
FORMATS: dict[str, dict] = {
    "mp4": {
        "label": "MP4 (H.264)", "ext": "mp4", "family": "h264",
        "acodec": "aac", "faststart": True,
    },
    "hevc": {
        "label": "MP4 (HEVC H.265)", "ext": "mp4", "family": "hevc",
        "acodec": "aac", "faststart": True,
    },
    "webm": {
        "label": "WebM (VP9)", "ext": "webm", "family": "vp9",
        "acodec": "libopus", "faststart": False,
    },
    "mkv": {
        "label": "MKV (H.264)", "ext": "mkv", "family": "h264",
        "acodec": "aac", "faststart": True,
    },
}

# Движки: id -> отображаемое имя
ENGINES = {
    "auto": "Гибрид (авто)",
    "cpu": "CPU (программный)",
    "nvidia": "NVIDIA (NVENC)",
    "amd": "AMD (AMF)",
    "intel": "Intel (QSV)",
}


def resolve_encoder(family: str, engine: str) -> tuple[str, bool]:
    """Возвращает (имя_энкодера, аппаратный_ли) с фолбэком на CPU."""
    cpu = CPU_ENCODERS[family]
    hw = available_hw_encoders(family)          # [(vendor, encoder)]
    vendor_map = dict(hw)

    if engine == "cpu":
        return cpu, False

    if engine in vendor_map:
        return vendor_map[engine], True

    if engine in ("auto", "hybrid"):
        if hw:
            return hw[0][1], True
        return cpu, False

    # Запрошенный GPU недоступен в этом ffmpeg — фолбэк на CPU.
    return cpu, False


def video_encoder_args(enc: str, family: str, crf: int) -> list[str]:
    """Аргументы кодера для выбранного энкодера."""
    if enc == "libx264":
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf)]
    if enc == "libx265":
        return ["-c:v", "libx265", "-preset", "veryfast", "-crf", str(crf),
                "-x265-params", "log-level=error"]
    if enc == "libvpx-vp9":
        return ["-c:v", "libvpx-vp9", "-crf", str(crf), "-b:v", "0",
                "-row-mt", "1", "-cpu-used", "5"]
    if enc == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr",
                "-cq", str(crf), "-b:v", "0"]
    if enc == "hevc_nvenc":
        return ["-c:v", "hevc_nvenc", "-preset", "p5", "-rc", "vbr",
                "-cq", str(crf), "-b:v", "0"]
    if enc in ("h264_amf", "hevc_amf"):
        return ["-c:v", enc, "-quality", "balanced", "-rc", "cqp",
                "-qp_i", str(crf), "-qp_p", str(crf)]
    if enc in ("h264_qsv", "hevc_qsv", "vp9_qsv"):
        return ["-c:v", enc, "-global_quality", str(crf)]
    # Неизвестный энкодер — пробуем как есть.
    return ["-c:v", enc]


def audio_encoder_args(fmt: dict) -> list[str]:
    if fmt["acodec"] == "libopus":
        return ["-c:a", "libopus", "-b:a", "128k", "-ar", str(AUDIO_SR), "-ac", str(AUDIO_CH)]
    return ["-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", str(AUDIO_SR), "-ac", str(AUDIO_CH)]


def _probe_duration(path: str) -> float:
    try:
        out = subprocess.check_output(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stderr=subprocess.DEVNULL,
        ).decode("utf-8", "replace").strip()
        return float(out) if out else 0.0
    except Exception:
        return 0.0


def _probe_size(path: str) -> tuple[int, int]:
    """Возвращает (width, height) первого видеопотока (0,0 при ошибке)."""
    try:
        out = subprocess.check_output(
            [FFPROBE, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x",
             path],
            stderr=subprocess.DEVNULL,
        ).decode("utf-8", "replace").strip()
        w, h = out.split("x")
        return int(w), int(h)
    except Exception:
        return 0, 0


def _run_ffmpeg(cmd: list, progress_cb=None, total_seconds: float = 0.0) -> int:
    """Запуск ffmpeg с парсингом -progress pipe:1 для оценки прогресса.

    stderr пишется во временный файл (чтобы не было дедлока по pipe).
    """
    import tempfile as _tf
    err_fd, err_path = _tf.mkstemp(suffix=".txt", prefix="ffmpeg_err_")
    os.close(err_fd)

    cmd = [FFMPEG, "-hide_banner", "-nostats", "-y", *cmd]
    if progress_cb:
        cmd += ["-progress", "pipe:1"]

    try:
        with open(err_path, "wb") as errf:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=errf,
            )
            if progress_cb and total_seconds > 0:
                last = 0.0
                for line in proc.stdout:
                    line = line.decode("utf-8", "replace").strip()
                    m = re.match(r"out_time_us=(\d+)", line)
                    if m:
                        us = int(m.group(1))
                        frac = min(us / 1e6 / total_seconds, 1.0)
                        if frac >= last:
                            last = frac
                            progress_cb(frac)
            else:
                proc.stdout.close()
            ret = proc.wait()
    finally:
        _err_tail = ""
        try:
            with open(err_path, "rb") as f:
                data = f.read()
            _err_tail = data.decode("utf-8", "replace")[-400:]
        except OSError:
            pass
        try:
            os.remove(err_path)
        except OSError:
            pass

    if ret != 0:
        # Для диагностики кладём хвост stderr в атрибут (удобно для тестов).
        globals()["_LAST_FFMPEG_ERR"] = _err_tail
    return ret


def _segment_cmd(input_path: str, start: float, end: float, output_path: str,
                 target_h: int | None, fps: int, venc_args: list,
                 has_audio: bool, fmt: dict) -> list:
    """Собирает команду нарезки одного сегмента."""
    duration = max(end - start, 0.05)
    vf = [f"fps={fps}", "format=yuv420p"]
    if target_h:
        vf.insert(0, f"scale=-2:{target_h}:flags=lanczos")
    vfilter = ",".join(vf)

    cmd = ["-ss", f"{start:.3f}", "-i", input_path, "-t", f"{duration:.3f}",
           "-vf", vfilter, *venc_args, "-map", "0:v:0"]
    if has_audio:
        cmd += ["-map", "0:a:0?", *audio_encoder_args(fmt)]
    else:
        # Добавляем тишину, чтобы все клипы имели аудиодорожку одинакового формата.
        cmd += ["-f", "lavfi", "-t", f"{duration:.3f}",
                "-i", f"anullsrc=r={AUDIO_SR}:cl=stereo",
                "-map", "1:a:0", *audio_encoder_args(fmt)]
    cmd += ["-map_metadata", "-1", output_path]
    return cmd


def _cut_segment(input_path: str, start: float, end: float, output_path: str,
                 target_h: int | None, fps: int, crf: int, has_audio: bool,
                 fmt: dict, enc: str, is_hw: bool, progress_cb=None) -> None:
    """Нарезает один сегмент и перекодирует в единый формат."""
    duration = max(end - start, 0.05)
    venc = video_encoder_args(enc, fmt["family"], crf)

    ret = _run_ffmpeg(
        _segment_cmd(input_path, start, end, output_path, target_h, fps,
                     venc, has_audio, fmt),
        progress_cb, duration,
    )
    if ret != 0 and is_hw:
        # Аппаратный кодер не сработал — пробуем программный.
        venc_cpu = video_encoder_args(CPU_ENCODERS[fmt["family"]], fmt["family"], crf)
        ret = _run_ffmpeg(
            _segment_cmd(input_path, start, end, output_path, target_h, fps,
                         venc_cpu, has_audio, fmt),
            progress_cb, duration,
        )
    if ret != 0:
        raise RuntimeError(f"Ошибка ffmpeg при нарезке сегмента {start:.1f}-{end:.1f}с")


def write_srt(lines: list[tuple], path: str) -> None:
    """Пишет субтитры в формат SRT. lines: [(start_sec, end_sec, text), ...].

    Пишем с UTF-8 BOM (utf-8-sig) — ffmpeg/libass корректно определяют кодировку
    и кириллица отображается как надо.
    """
    def ts(sec: float) -> str:
        sec = max(sec, 0.0)
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        ms = int(round((sec % 1) * 1000))
        if ms >= 1000:
            ms = 999
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    with open(path, "w", encoding="utf-8-sig") as f:
        for i, (s, e, text) in enumerate(lines, 1):
            f.write(f"{i}\n{ts(s)} --> {ts(e)}\n{text}\n\n")


def srt_filter_path(path: str) -> str:
    """Экранирует Windows-путь для фильтра subtitles=filename='...'."""
    return path.replace("\\", "/").replace(":", "\\:").replace("'", "\\\\'")


def subs_filter(srt_path: str) -> str:
    """Фильтр subtitles с поддержкой кириллицы.

    libass на Windows может не найти шрифт с кириллическими глифами — указываем
    папку системных шрифтов и конкретный шрифт (Arial поддерживает кириллицу).
    """
    filename = srt_filter_path(srt_path)
    fontsdir = "C\\:/Windows/Fonts"
    return (f"subtitles=filename='{filename}':fontsdir='{fontsdir}'"
            f":force_style='FontName=Arial,FontSize=16'")


def _join_with_crossfade(seg_files: list[str], output_path: str, fmt: dict,
                         enc: str, is_hw: bool, crf: int, crossfade: float,
                         transition: str = "fade",
                         progress_cb=None, base: float = 0.0,
                         span: float = 0.0,
                         srt_path: str | None = None) -> None:
    """Склейка сегментов с переходами (xfade + acrossfade).

    transition — имя перехода xfade: fade (кроссфейд), fadeblack (через чёрный),
    fadewhite (через белый), dissolve (растворение), wipeleft/slideright и др.
    """
    n = len(seg_files)
    durs = [_probe_duration(p) for p in seg_files]
    final_dur = max(sum(durs) - (n - 1) * crossfade, 0.1)

    vparts, apart = [], []
    prev_v, prev_a = "0:v", "0:a"
    acc = durs[0]
    for k in range(1, n):
        offset = acc - crossfade
        out_v = f"v{k}" if k < n - 1 else "vraw"
        out_a = f"a{k}" if k < n - 1 else "aout"
        vparts.append(
            f"[{prev_v}][{k}:v]xfade=transition={transition}:duration={crossfade:.3f}:offset={offset:.3f}[{out_v}]"
        )
        apart.append(f"[{prev_a}][{k}:a]acrossfade=d={crossfade:.3f}:c1=tri:c2=tri[{out_a}]")
        prev_v, prev_a = out_v, out_a
        acc = acc + durs[k] - crossfade

    # ВАЖНО: xfade по умолчанию отдаёт yuv444p (H.264 High 4:4:4), который не
    # играется в браузерах и на аппаратных декодерах — файл получается «битым».
    # Принудительно приводим финальное видео к yuv420p.
    fc = ";".join(vparts) + f";[vraw]format=yuv420p[vout]" + ";" + ";".join(apart)
    if srt_path:
        # Субтитры поверх финального видео после всех переходов.
        fc += f";[vout]{subs_filter(srt_path)}[vsub]"

    def build(venc_args: list) -> list:
        cmd = []
        for p in seg_files:
            cmd += ["-i", p]
        cmd += ["-filter_complex", fc,
                "-map", "[vsub]" if srt_path else "[vout]", "-map", "[aout]",
                *venc_args, *audio_encoder_args(fmt), "-map_metadata", "-1"]
        if fmt.get("faststart"):
            # moov в начало — иначе на больших файлах браузер не может начать
            # воспроизведение/перемотку.
            cmd += ["-movflags", "+faststart"]
        cmd += [output_path]
        return cmd

    def cb(frac):
        if progress_cb:
            progress_cb(base + span * frac)

    venc = video_encoder_args(enc, fmt["family"], crf)
    ret = _run_ffmpeg(build(venc), cb, final_dur)
    if ret != 0 and is_hw:
        venc_cpu = video_encoder_args(CPU_ENCODERS[fmt["family"]], fmt["family"], crf)
        ret = _run_ffmpeg(build(venc_cpu), cb, final_dur)
    if ret != 0:
        tail = globals().get("_LAST_FFMPEG_ERR", "")
        raise RuntimeError("Не удалось собрать монтаж с кроссфейдами (xfade)" + (f": {tail[-200:]}" if tail else ""))


def _make_marker(path: str, w: int, h: int, dur: float, color: str,
                 enc: str, fmt: dict, crf: int) -> None:
    """Создаёт короткий клип-плашку заданного цвета с тишиной (в формате сегментов)."""
    hexc = (color or "#ff00ff").lstrip("#")
    if len(hexc) == 6:
        hexc = "0x" + hexc
    dur = max(dur, 0.1)
    venc = video_encoder_args(enc, fmt["family"], crf)
    cmd = [
        FFMPEG, "-hide_banner", "-nostats", "-y",
        "-f", "lavfi", "-i",
        f"color=c={hexc}:s={w}x{h}:r={OUT_FPS}:d={dur:.3f}",
        "-f", "lavfi", "-i", f"anullsrc=r={AUDIO_SR}:cl=stereo",
        "-t", f"{dur:.3f}",
        "-vf", "format=yuv420p",
        *venc, *audio_encoder_args(fmt),
        "-map_metadata", "-1", path,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(
            "Не удалось создать плашку-маркер: "
            + (proc.stderr or b"").decode("utf-8", "replace")[-200:])


def _join_with_markers(seg_files: list[str], output_path: str, fmt: dict,
                       enc: str, is_hw: bool, crf: int, marker_dur: float,
                       marker_color: str, progress_cb=None, base: float = 0.0,
                       span: float = 0.0,
                       srt_path: str | None = None) -> None:
    """Склейка с вставкой цветных плашек-маркеров между сегментами.

    Между каждой парой сегментов вставляется сплошной цветной кадр заданной
    длительности — удобно потом в другом редакторе быстро находить и вырезать
    нужные моменты.
    """
    n = len(seg_files)
    seg_durs = [_probe_duration(p) for p in seg_files]
    total = sum(seg_durs) + (n - 1) * marker_dur
    w, h = _probe_size(seg_files[0])
    if not w or not h:
        w, h = 1280, 720

    tmp_dir = os.path.dirname(os.path.abspath(seg_files[0]))
    markers = []
    try:
        for k in range(n - 1):
            mpath = os.path.join(tmp_dir, f"marker_{k:04d}.mkv")
            _make_marker(mpath, w, h, marker_dur, marker_color, enc, fmt, crf)
            markers.append(mpath)

        ordered: list[str] = []
        for k in range(n):
            ordered.append(seg_files[k])
            if k < n - 1:
                ordered.append(markers[k])

        list_path = os.path.join(tmp_dir, "list_markers.txt")
        with open(list_path, "w", encoding="utf-8") as f:
            for p in ordered:
                f.write(f"file '{p.replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n")

        def cb(frac):
            if progress_cb:
                progress_cb(base + span * frac)

        # Пробуем склейку без перекодирования (сегменты и плашки в одном формате).
        cmd = ["-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy"]
        if fmt.get("faststart"):
            cmd += ["-movflags", "+faststart"]
        cmd += ["-map_metadata", "-1", output_path]
        ret = _run_ffmpeg(cmd, cb, total)
        if ret != 0:
            # Фолбэк: перекодирование (+ субтитры, если нужно).
            cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                   *video_encoder_args(enc, fmt["family"], crf)]
            if srt_path:
                cmd += ["-vf", subs_filter(srt_path)]
            cmd += [*audio_encoder_args(fmt)]
            if fmt.get("faststart"):
                cmd += ["-movflags", "+faststart"]
            cmd += ["-map_metadata", "-1", output_path]
            ret = _run_ffmpeg(cmd, cb, total)
            if ret != 0 and is_hw:
                cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                       *video_encoder_args(CPU_ENCODERS[fmt["family"]], fmt["family"], crf)]
                if srt_path:
                    cmd += ["-vf", subs_filter(srt_path)]
                cmd += [*audio_encoder_args(fmt)]
                if fmt.get("faststart"):
                    cmd += ["-movflags", "+faststart"]
                cmd += ["-map_metadata", "-1", output_path]
                ret = _run_ffmpeg(cmd, cb, total)
            if ret != 0:
                tail = globals().get("_LAST_FFMPEG_ERR", "")
                raise RuntimeError(
                    "Не удалось склеить монтаж с плашками-маркерами"
                    + (f": {tail[-200:]}" if tail else ""))
    finally:
        for m in markers:
            try:
                os.remove(m)
            except OSError:
                pass
        try:
            os.remove(os.path.join(tmp_dir, "list_markers.txt"))
        except OSError:
            pass


def build_montage(items: list[dict], output_path: str, *,
                  height: int | None = None, crf: int = 20,
                  engine: str = "auto", fmt: str = "mp4",
                  crossfade: float = 0.0, transition: str = "fade",
                  marker_color: str = "#ff00ff",
                  srt_path: str | None = None,
                  progress_cb=None) -> dict:
    """Склейка списка сегментов в один файл.

    items:      [{path, start, end, has_audio}, ...]
    engine:     cpu | nvidia | amd | intel | auto/hybrid
    fmt:        mp4 | hevc | webm | mkv
    crossfade:  длительность перехода (0 = без перехода)
    transition: none | fade | fadeblack | fadewhite | dissolve |
                wipeleft | slideright | marker (плашка-маркер)
    marker_color: цвет плашки-маркера (например #ff00ff)
    srt_path:   путь к .srt для вшивания субтитров (None = без субтитров)
    """
    if not items:
        raise ValueError("Нет сегментов для монтажа")

    fmt_cfg = FORMATS.get(fmt)
    if not fmt_cfg:
        fmt_cfg = FORMATS["mp4"]

    total_dur = sum(max(i["end"] - i["start"], 0) for i in items)
    if total_dur <= 0:
        raise ValueError("Суммарная длительность сегментов равна нулю")

    enc, is_hw = resolve_encoder(fmt_cfg["family"], engine)

    tmp_dir = tempfile.mkdtemp(prefix="mcut_")
    seg_files = []
    done_seconds = 0.0
    try:
        # Этап 1: нарезка сегментов (прогресс 0..0.85)
        for idx, item in enumerate(items):
            seg_path = os.path.join(tmp_dir, f"seg_{idx:04d}.mkv")
            seg_dur = max(item["end"] - item["start"], 0)

            def cb(frac, _i=idx, _seg=seg_dur):
                if progress_cb:
                    progress_cb(((done_seconds + _seg * frac) / total_dur) * 0.85)

            _cut_segment(item["path"], item["start"], item["end"], seg_path,
                         height, OUT_FPS, crf, item.get("has_audio", False),
                         fmt_cfg, enc, is_hw, cb)
            seg_files.append(seg_path)
            done_seconds += seg_dur

        # Этап 2: склейка (прогресс 0.85..1.0)
        if transition == "marker" and crossfade > 0 and len(seg_files) > 1:
            _join_with_markers(seg_files, output_path, fmt_cfg, enc, is_hw, crf,
                               crossfade, marker_color, progress_cb, 0.85, 0.15,
                               srt_path)
        elif transition != "none" and crossfade > 0 and len(seg_files) > 1:
            _join_with_crossfade(seg_files, output_path, fmt_cfg, enc, is_hw,
                                 crf, crossfade, transition, progress_cb, 0.85, 0.15,
                                 srt_path)
        else:
            list_path = os.path.join(tmp_dir, "list.txt")
            with open(list_path, "w", encoding="utf-8") as f:
                for p in seg_files:
                    f.write(f"file '{p.replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n")

            mux = []
            if fmt_cfg["faststart"]:
                mux = ["-movflags", "+faststart"]

            def cbcopy(frac):
                if progress_cb:
                    progress_cb(0.85 + 0.15 * frac)

            if srt_path:
                # Субтитры требуют перекодирования — сразу собираем с фильтром.
                cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                       "-vf", subs_filter(srt_path),
                       *video_encoder_args(enc, fmt_cfg["family"], crf),
                       *audio_encoder_args(fmt_cfg), *mux,
                       "-map_metadata", "-1", output_path]
                ret = _run_ffmpeg(cmd, cbcopy, total_dur)
                if ret != 0 and is_hw:
                    cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                           "-vf", subs_filter(srt_path),
                           *video_encoder_args(CPU_ENCODERS[fmt_cfg["family"]],
                                               fmt_cfg["family"], crf),
                           *audio_encoder_args(fmt_cfg), *mux,
                           "-map_metadata", "-1", output_path]
                    ret = _run_ffmpeg(cmd, cbcopy, total_dur)
                if ret != 0:
                    raise RuntimeError("Не удалось склеить сегменты с субтитрами (ffmpeg)")
                ret = 0
            else:
                cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                       "-c", "copy", *mux, "-map_metadata", "-1", output_path]
                ret = _run_ffmpeg(cmd, cbcopy, total_dur)
                if ret != 0:
                    # Фолбэк: склейка с перекодированием.
                    cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                           *video_encoder_args(enc, fmt_cfg["family"], crf),
                           *audio_encoder_args(fmt_cfg), *mux,
                           "-map_metadata", "-1", output_path]
                    ret = _run_ffmpeg(cmd, cbcopy, total_dur)
                    if ret != 0 and is_hw:
                        cmd = ["-f", "concat", "-safe", "0", "-i", list_path,
                               *video_encoder_args(CPU_ENCODERS[fmt_cfg["family"]],
                                                   fmt_cfg["family"], crf),
                               *audio_encoder_args(fmt_cfg), *mux,
                               "-map_metadata", "-1", output_path]
                        ret = _run_ffmpeg(cmd, cbcopy, total_dur)
                    if ret != 0:
                        raise RuntimeError("Не удалось склеить сегменты (ffmpeg concat)")
    finally:
        for p in seg_files:
            try:
                os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass

    final_dur = total_dur
    if len(seg_files) > 1 and crossfade > 0:
        if transition == "marker":
            final_dur = total_dur + (len(seg_files) - 1) * crossfade
        else:
            final_dur = total_dur - (len(seg_files) - 1) * crossfade

    if progress_cb:
        progress_cb(1.0)
    return {
        "segments": len(items),
        "duration": round(max(final_dur, 0), 2),
        "file": output_path,
        "engine": enc,
        "hw": is_hw,
    }


def generate_thumbnail(video_path: str, thumb_path: str, at_frac: float = 0.15) -> str | None:
    """Извлекает кадр-превью из видео."""
    try:
        Path(thumb_path).parent.mkdir(parents=True, exist_ok=True)
        cmd = [FFMPEG, "-hide_banner", "-nostats", "-y",
               "-ss", f"{at_frac}", "-i", video_path,
               "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4",
               thumb_path]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=60)
        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
            return thumb_path
    except Exception:
        pass
    return None
