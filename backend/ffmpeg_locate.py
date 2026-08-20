"""Поиск исполняемых файлов ffmpeg/ffprobe (не полагаемся только на PATH)."""
from __future__ import annotations

import glob
import os
import shutil
import subprocess

_CACHE: dict[str, str | None] = {}


def _candidate_dirs() -> list[str]:
    dirs: list[str] = []
    for p in os.environ.get("PATH", "").split(os.pathsep):
        if p.strip():
            dirs.append(p.strip())
    # Типовые места установки ffmpeg на Windows.
    candidates = [
        r"C:\ffmpeg",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages"),
    ]
    for base in candidates:
        if os.path.isdir(base):
            dirs.append(base)
            dirs.extend(glob.glob(os.path.join(base, "*", "bin")))
            dirs.extend(glob.glob(os.path.join(base, "*", "bin", "")))
    return dirs


def find_tool(name: str) -> str | None:
    """Возвращает полный путь к утилите или None."""
    if name in _CACHE:
        return _CACHE[name]

    exe = shutil.which(name)
    if exe:
        _CACHE[name] = exe
        return exe

    if os.name == "nt":
        for d in _candidate_dirs():
            cand = os.path.join(d, f"{name}.exe")
            if os.path.isfile(cand):
                _CACHE[name] = cand
                return cand

    _CACHE[name] = None
    return None


FFMPEG = os.environ.get("FFMPEG") or find_tool("ffmpeg")
FFPROBE = os.environ.get("FFPROBE") or find_tool("ffprobe")


def ensure_available() -> None:
    missing = []
    if not FFMPEG:
        missing.append("ffmpeg")
    if not FFPROBE:
        missing.append("ffprobe")
    if missing:
        raise RuntimeError(
            "Не найдены утилиты: " + ", ".join(missing)
            + ". Установите ffmpeg и добавьте его в PATH."
        )


# --------------------------------------------------------------------------
# Детекция доступных видеокодеков (программных и аппаратных)
# --------------------------------------------------------------------------
_ENC_CACHE: set[str] | None = None


def get_available_encoders() -> set[str]:
    """Возвращает множество имён энкодеров, доступных в собранном ffmpeg."""
    global _ENC_CACHE
    if _ENC_CACHE is not None:
        return _ENC_CACHE
    encs: set[str] = set()
    exe = FFMPEG or "ffmpeg"
    try:
        out = subprocess.check_output(
            [exe, "-hide_banner", "-encoders"],
            stderr=subprocess.DEVNULL,
            timeout=20,
        ).decode("utf-8", "replace")
        for line in out.splitlines():
            parts = line.split()
            # Строка вида: " V....D h264_nvenc   NVIDIA NVENC ..." или " V....  libx264 ..."
            if len(parts) >= 2 and parts[0].strip().startswith(("V", "A")):
                encs.add(parts[1])
    except Exception:
        pass
    _ENC_CACHE = encs
    return encs


def has_encoder(name: str) -> bool:
    return name in get_available_encoders()


# Семейство кодека -> [(vendor, encoder), ...] в порядке приоритета для «гибрида».
HW_ENCODERS: dict[str, list[tuple[str, str]]] = {
    "h264": [
        ("nvidia", "h264_nvenc"),
        ("amd", "h264_amf"),
        ("intel", "h264_qsv"),
    ],
    "hevc": [
        ("nvidia", "hevc_nvenc"),
        ("amd", "hevc_amf"),
        ("intel", "hevc_qsv"),
    ],
    "vp9": [
        ("intel", "vp9_qsv"),
    ],
}

CPU_ENCODERS: dict[str, str] = {
    "h264": "libx264",
    "hevc": "libx265",
    "vp9": "libvpx-vp9",
}


def available_hw_encoders(family: str) -> list[tuple[str, str]]:
    """Список (vendor, encoder) доступных аппаратных энкодеров для семейства."""
    return [(v, e) for v, e in HW_ENCODERS.get(family, []) if has_encoder(e)]


def describe_engine() -> dict:
    """Сводка по доступным движкам для UI."""
    families = ("h264", "hevc", "vp9")
    return {
        "ffmpeg": bool(FFMPEG),
        "hw": {
            fam: [v for v, _ in available_hw_encoders(fam)]
            for fam in families
        },
        "cpu": {fam: CPU_ENCODERS[fam] for fam in families},
        "hwaccel": hwaccels(),
    }


# --------------------------------------------------------------------------
# Аппаратное декодирование (для анализа на GPU)
# --------------------------------------------------------------------------
_HWACCEL_CACHE: list[str] | None = None


def hwaccels() -> list[str]:
    """Список поддерживаемых ffmpeg аппаратных ускорителей (из -hwaccels)."""
    global _HWACCEL_CACHE
    if _HWACCEL_CACHE is not None:
        return _HWACCEL_CACHE
    items: list[str] = []
    exe = FFMPEG or "ffmpeg"
    try:
        out = subprocess.check_output(
            [exe, "-hide_banner", "-hwaccels"],
            stderr=subprocess.DEVNULL, timeout=20,
        ).decode("utf-8", "replace")
        for line in out.splitlines():
            line = line.strip()
            if line and not line.startswith("Hardware"):
                items.append(line)
    except Exception:
        pass
    _HWACCEL_CACHE = items
    return items


def has_hwaccel(name: str) -> bool:
    return name in hwaccels()


def cuda_decode_available() -> bool:
    """Можно ли декодировать видео на GPU через NVDEC (ffmpeg -hwaccel cuda)."""
    return has_hwaccel("cuda")

