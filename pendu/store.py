"""Task storage for Pendu.

Tasks live in a single JSON file (``~/.pendu/notes.json`` by default, or
``$PENDU_HOME/notes.json``). Two kinds of task exist:

* one-off tasks, planned for a single day. If they are not finished that day
  they keep showing up ("carried over") until they are checked.
* daily tasks, which show up every day from the day they were created and
  must be checked again each day.
"""

import json
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

COLORS = ["yellow", "pink", "green", "blue", "orange", "purple"]

# Daily tasks remember which days they were checked; older entries are pruned.
KEEP_DONE_DAYS = 60


def default_path():
    home = os.environ.get("PENDU_HOME") or Path.home() / ".pendu"
    return Path(home) / "notes.json"


def _iso(day):
    return day.isoformat()


class TaskStore:
    def __init__(self, path=None):
        self.path = Path(path) if path else default_path()
        self.tasks = []
        self.settings = {}
        self.load()

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            self.tasks = list(data.get("tasks", []))
            self.settings = dict(data.get("settings", {}))
        except FileNotFoundError:
            self.tasks = []
        except (OSError, ValueError):
            # Keep the unreadable file around rather than silently losing it.
            backup = self.path.with_suffix(".broken.json")
            try:
                os.replace(self.path, backup)
            except OSError:
                pass
            self.tasks = []

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"version": 1, "settings": self.settings, "tasks": self.tasks}, f, indent=2)
        os.replace(tmp, self.path)

    # -- queries -----------------------------------------------------------

    def get(self, task_id):
        for task in self.tasks:
            if task["id"] == task_id:
                return task
        raise KeyError(task_id)

    def is_done(self, task, day):
        if task.get("daily"):
            return _iso(day) in task.get("done_dates", [])
        done_on = task.get("done_on")
        return done_on is not None and done_on <= _iso(day)

    def is_carried_over(self, task, day):
        return not task.get("daily") and task["date"] < _iso(day)

    def tasks_for(self, day):
        """Tasks to show on ``day``: open ones first, then finished ones."""
        today = _iso(day)
        shown = []
        for task in self.tasks:
            if task.get("daily"):
                if task["date"] <= today:
                    shown.append(task)
            elif task["date"] == today:
                shown.append(task)
            elif task["date"] < today:
                done_on = task.get("done_on")
                # Unfinished work from earlier days stays on the board, and a
                # carried-over task checked today stays visible until tomorrow.
                if done_on is None or done_on >= today:
                    shown.append(task)
        shown.sort(key=lambda t: (self.is_done(t, day), t["date"], t["created"]))
        return shown

    def progress(self, day):
        shown = self.tasks_for(day)
        return sum(self.is_done(t, day) for t in shown), len(shown)

    # -- changes -----------------------------------------------------------

    def add(self, text, day, color=None, daily=False, now=None):
        text = text.strip()
        if not text:
            raise ValueError("task text is empty")
        task = {
            "id": uuid.uuid4().hex,
            "text": text,
            "color": color if color in COLORS else COLORS[len(self.tasks) % len(COLORS)],
            "date": _iso(day),
            "daily": bool(daily),
            "created": (now or _now_stamp()),
            "done_on": None,
            "done_dates": [],
        }
        self.tasks.append(task)
        self.save()
        return task

    def toggle(self, task_id, day):
        task = self.get(task_id)
        today = _iso(day)
        if task.get("daily"):
            dates = task.setdefault("done_dates", [])
            if today in dates:
                dates.remove(today)
            else:
                dates.append(today)
            cutoff = _iso(day - timedelta(days=KEEP_DONE_DAYS))
            task["done_dates"] = sorted(d for d in dates if d >= cutoff)
        else:
            task["done_on"] = None if task.get("done_on") else today
        self.save()
        return self.is_done(task, day)

    def edit(self, task_id, text=None, color=None, daily=None):
        task = self.get(task_id)
        if text is not None:
            text = text.strip()
            if not text:
                raise ValueError("task text is empty")
            task["text"] = text
        if color is not None and color in COLORS:
            task["color"] = color
        if daily is not None:
            task["daily"] = bool(daily)
        self.save()
        return task

    def delete(self, task_id):
        self.tasks = [t for t in self.tasks if t["id"] != task_id]
        self.save()

    def clear_done(self, day):
        """Remove one-off tasks already finished on or before ``day``."""
        self.tasks = [
            t for t in self.tasks
            if t.get("daily") or not self.is_done(t, day)
        ]
        self.save()


def _now_stamp():
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


def today():
    return date.today()
