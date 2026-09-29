/* Task storage for the Pendu web board.
 *
 * The same rules as pendu/store.py, kept in the browser's localStorage in the
 * same shape as the desktop app's notes.json, so a file can be moved between
 * the two with Export / Import. Two kinds of task exist:
 *
 * - one-off tasks, planned for a single day. If they are not finished that
 *   day they keep showing up ("carried over") until they are checked.
 * - daily tasks, which show up every day from the day they were created and
 *   must be checked again each day.
 *
 * Days are "YYYY-MM-DD" strings in local time throughout.
 */
(function (root) {
  "use strict";

  const COLORS = ["yellow", "pink", "green", "blue", "orange", "purple"];

  // Daily tasks remember which days they were checked; older entries are pruned.
  const KEEP_DONE_DAYS = 60;

  const pad = (n) => String(n).padStart(2, "0");

  function iso(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function today() {
    return iso(new Date());
  }

  function addDays(day, n) {
    const [y, m, d] = day.split("-").map(Number);
    return iso(new Date(y, m - 1, d + n));
  }

  function nowStamp() {
    const d = new Date();
    return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID().replace(/-/g, "");
    let s = "";
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  // Compares like Python tuples of (bool, str, str).
  function cmp(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  // Falls back to memory when localStorage is blocked (private mode, file://
  // in some browsers), so the board still works for the session.
  function memoryStorage() {
    const data = {};
    return {
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: (k) => { delete data[k]; },
    };
  }

  function defaultStorage() {
    try {
      const s = root.localStorage;
      const probe = "__pendu_probe__";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return s;
    } catch (e) {
      return memoryStorage();
    }
  }

  class TaskStore {
    constructor(storage, key) {
      this.storage = storage || defaultStorage();
      this.key = key || "pendu.notes";
      this.tasks = [];
      this.settings = {};
      this.load();
    }

    load() {
      let raw = null;
      try {
        raw = this.storage.getItem(this.key);
      } catch (e) {
        raw = null;
      }
      if (raw === null) {
        this.tasks = [];
        return;
      }
      try {
        const data = JSON.parse(raw);
        this.tasks = Array.isArray(data.tasks) ? data.tasks.slice() : [];
        this.settings = Object.assign({}, data.settings || {});
      } catch (e) {
        // Keep the unreadable data around rather than silently losing it.
        try {
          this.storage.setItem(this.key + ".broken", raw);
          this.storage.removeItem(this.key);
        } catch (e2) { /* nothing more we can do */ }
        this.tasks = [];
      }
    }

    toJSON() {
      return { version: 1, settings: this.settings, tasks: this.tasks };
    }

    save() {
      try {
        this.storage.setItem(this.key, JSON.stringify(this.toJSON(), null, 2));
      } catch (e) { /* storage full or blocked: keep working in memory */ }
    }

    /** Replace everything with the contents of a notes.json file. */
    replaceWith(data) {
      if (!data || !Array.isArray(data.tasks)) throw new Error("not a Pendu notes file");
      const ok = data.tasks.every((t) => t && typeof t.id === "string" && typeof t.text === "string"
        && typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date));
      if (!ok) throw new Error("not a Pendu notes file");
      this.tasks = data.tasks.map((t) => Object.assign(
        { color: "yellow", daily: false, created: t.date + "T00:00:00", done_on: null, done_dates: [] }, t));
      this.settings = Object.assign({}, data.settings || {});
      this.save();
    }

    // -- queries -----------------------------------------------------------

    get(taskId) {
      const task = this.tasks.find((t) => t.id === taskId);
      if (!task) throw new Error("no task " + taskId);
      return task;
    }

    isDone(task, day) {
      if (task.daily) return (task.done_dates || []).includes(day);
      const doneOn = task.done_on;
      return doneOn != null && doneOn <= day;
    }

    isCarriedOver(task, day) {
      return !task.daily && task.date < day;
    }

    /** Tasks to show on `day`: open ones first, then finished ones. */
    tasksFor(day) {
      const shown = [];
      for (const task of this.tasks) {
        if (task.daily) {
          if (task.date <= day) shown.push(task);
        } else if (task.date === day) {
          shown.push(task);
        } else if (task.date < day) {
          const doneOn = task.done_on;
          // Unfinished work from earlier days stays on the board, and a
          // carried-over task checked today stays visible until tomorrow.
          if (doneOn == null || doneOn >= day) shown.push(task);
        }
      }
      const key = (t) => [this.isDone(t, day) ? 1 : 0, t.date, t.created];
      shown.sort((a, b) => cmp(key(a), key(b)));
      return shown;
    }

    progress(day) {
      const shown = this.tasksFor(day);
      return [shown.filter((t) => this.isDone(t, day)).length, shown.length];
    }

    // -- changes -----------------------------------------------------------

    add(text, day, opts) {
      opts = opts || {};
      text = String(text).trim();
      if (!text) throw new Error("task text is empty");
      const task = {
        id: newId(),
        text: text,
        color: COLORS.includes(opts.color) ? opts.color : COLORS[this.tasks.length % COLORS.length],
        date: day,
        daily: Boolean(opts.daily),
        created: opts.now || nowStamp(),
        done_on: null,
        done_dates: [],
      };
      this.tasks.push(task);
      this.save();
      return task;
    }

    toggle(taskId, day) {
      const task = this.get(taskId);
      if (task.daily) {
        const dates = task.done_dates || (task.done_dates = []);
        const i = dates.indexOf(day);
        if (i >= 0) dates.splice(i, 1);
        else dates.push(day);
        const cutoff = addDays(day, -KEEP_DONE_DAYS);
        task.done_dates = dates.filter((d) => d >= cutoff).sort();
      } else {
        task.done_on = task.done_on ? null : day;
      }
      this.save();
      return this.isDone(task, day);
    }

    edit(taskId, changes) {
      const task = this.get(taskId);
      if (changes.text != null) {
        const text = String(changes.text).trim();
        if (!text) throw new Error("task text is empty");
        task.text = text;
      }
      if (changes.color != null && COLORS.includes(changes.color)) task.color = changes.color;
      if (changes.daily != null) task.daily = Boolean(changes.daily);
      this.save();
      return task;
    }

    delete(taskId) {
      this.tasks = this.tasks.filter((t) => t.id !== taskId);
      this.save();
    }

    /** Remove one-off tasks already finished on or before `day`. */
    clearDone(day) {
      this.tasks = this.tasks.filter((t) => t.daily || !this.isDone(t, day));
      this.save();
    }
  }

  const api = { TaskStore, COLORS, today, addDays, iso, memoryStorage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pendu = api;
})(typeof window !== "undefined" ? window : globalThis);
