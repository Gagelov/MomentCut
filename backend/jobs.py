"""Простое потокобезопасное хранилище фоновых задач (анализ/монтаж)."""
from __future__ import annotations

import threading
import uuid


class Job:
    def __init__(self, kind: str, label: str):
        self.id = uuid.uuid4().hex
        self.kind = kind
        self.label = label
        self.status = "running"   # running | paused | done | error
        self.progress = 0.0       # 0..1
        self.message = "Подготовка…"
        self.result = None
        self.error = None
        # Для ИИ-анализа: управление паузой/отменой и привязка к видео
        # (threading.Event; сессионные — не переживают перезапуск сервера).
        self.pause_event = None   # set = «пауза», clear = «продолжить»
        self.cancel_event = None  # set = «отменить»
        self.video_id = None      # id видео (для поиска приостановленного анализа)
        # ИИ-анализ: живые показатели для UI (просмотрено секунд видео и
        # сколько моментов уже найдено).
        self.ai_pos = None        # float | None — до какой секунды просмотрено
        self.ai_segments = None   # int | None — найдено моментов на данный момент

    def to_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "label": self.label,
            "status": self.status,
            "progress": round(self.progress, 4),
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "paused": self.status == "paused",
            "ai_pos": self.ai_pos,
            "ai_segments": self.ai_segments,
        }


class JobStore:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, kind: str, label: str) -> Job:
        job = Job(kind, label)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs):
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for k, v in kwargs.items():
                setattr(job, k, v)

    def all(self) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())


JOBS = JobStore()
