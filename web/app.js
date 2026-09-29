/* Pendu web board: today's tasks pinned to a cork board as sticky notes.
 *
 * A browser port of pendu/app.py. Notes are laid out on a grid like the
 * desktop board, and the same animations drive them: a new note floats up
 * from the input bar and sways to its place, its pin drops in with a little
 * burst, and notes that change places slide over.
 */
(function () {
  "use strict";

  const { TaskStore, COLORS, today } = window.Pendu;

  const NOTE_W = 210, NOTE_H = 180;
  const GAP = 26;
  const MARGIN = 30;
  const MARGIN_TOP = 48;   // room above the first row for a pin dropping in

  // Animation timings. A new note floats up from the input bar to its place
  // (FLY_MS), then its pin drops in (PIN_MS). Notes that change place slide.
  // When the board opens (or comes back), notes settle onto it (APPEAR_MS).
  const FLY_MS = 1200;
  const PIN_MS = 420;
  const SLIDE_MS = 380;
  const APPEAR_MS = 520;
  const APPEAR_STAGGER_MS = 70;
  const REORDER_MS = 450;  // lets you see the tick before a note moves to the end

  // Check for a new day every so often; replay the opening when the tab was
  // away for a while, like the desktop board coming back after sleep.
  const TICK_MS = 10_000;
  const WAKE_GAP_MS = 60_000;
  const AWAY_MS = 5 * 60_000;

  const EMPTY = "__empty__";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
                  "September", "October", "November", "December"];

  const $ = (id) => document.getElementById(id);
  const wrap = $("wrap");
  const board = $("board");
  const entry = $("entry");
  const dailyBox = $("daily");
  const swatchBox = $("swatches");
  const menu = $("menu");
  const toast = $("toast");
  const progressText = $("progress-text");
  const progressFill = $("progress-fill");

  const store = new TaskStore();
  let day = today();
  let newColor = COLORS[0];

  const els = new Map();      // task id -> note element on the board
  let slots = {};             // task id -> {x, y}, centre of its place on the board
  const flights = new Map();  // task id -> animation of a note on the move
  let frame = null;
  let reorderTimer = null;
  let pendingToggle = null;

  // -- small helpers ---------------------------------------------------------

  const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;
  // Overshoots a little past 1 before settling, like paper pressed flat.
  const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

  function shorten(text, limit = 110) {
    return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
  }

  // Stable, slightly different tilt for every note.
  function tilt(id) {
    if (id === EMPTY) return -2;
    const n = parseInt(id.slice(0, 4), 16);
    return Number.isFinite(n) ? ((n % 9) - 4) * 0.9 : 0;
  }

  function parseDay(d) {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd);
  }

  function formatDay(d) {
    const date = parseDay(d);
    const dd = String(date.getDate()).padStart(2, "0");
    return `${WEEKDAYS[date.getDay()]}, ${dd} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  function findTask(id) {
    return store.tasks.find((t) => t.id === id) || null;
  }

  function restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;  // reflow so the animation runs again
    el.classList.add(cls);
  }

  // -- notes -----------------------------------------------------------------

  const NOTE_HTML = `
    <div class="note-body">
      <div class="sheet"><div class="paper">
        <div class="strip"></div><div class="fold"></div><div class="veil"></div>
        <p class="text"><span></span></p>
        <button class="check" type="button" tabindex="-1" aria-hidden="true">
          <svg viewBox="0 0 22 22"><path d="M5 12 L9 17 L17 6"/></svg>
        </button>
        <span class="label"></span>
        <button class="close" type="button" tabindex="-1" aria-label="Remove note">×</button>
      </div></div>
      <div class="pin"><i class="pin-shadow"></i><i class="pin-head"></i></div>
      <div class="burst"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;

  function createNote(task) {
    const el = document.createElement("div");
    el.className = "note";
    el.dataset.id = task.id;
    el.tabIndex = 0;
    el.setAttribute("role", "checkbox");
    el.innerHTML = NOTE_HTML;
    return el;
  }

  function createEmptyNote() {
    const el = document.createElement("div");
    el.className = "note empty";
    el.dataset.id = EMPTY;
    el.dataset.color = "yellow";
    el.innerHTML = NOTE_HTML;
    el.querySelector(".check").remove();
    el.querySelector(".close").remove();
    el.querySelector(".text span").textContent =
      "Nothing on the board.\n\nWrite today's tasks below and stick them here.";
    return el;
  }

  function updateNote(el, task) {
    const done = store.isDone(task, day);
    el.dataset.color = COLORS.includes(task.color) ? task.color : "yellow";
    el.classList.toggle("done", done);
    el.setAttribute("aria-checked", String(done));
    if (!el.classList.contains("editing")) {
      el.querySelector(".text span").textContent = shorten(task.text);
    }
    let label = "";
    if (task.daily) label = "every day";
    else if (store.isCarriedOver(task, day)) label = "from " + task.date.slice(5).replace("-", "/");
    el.querySelector(".label").textContent = label;
    el.setAttribute("aria-label", task.text + (label ? ` (${label})` : ""));
  }

  function setPose(el, id, p) {
    const angle = tilt(id) + (p.spin || 0);
    const scale = p.scale == null ? 1 : p.scale;
    el.style.transform =
      `translate(${p.x - NOTE_W / 2}px, ${p.y - NOTE_H / 2}px) rotate(${angle}deg) scale(${scale})`;
    el.style.setProperty("--lift", (p.lift || 0).toFixed(3));
    el.style.setProperty("--pin", (p.pin || 0).toFixed(3));
    el.style.opacity = p.opacity == null ? "" : String(p.opacity);
  }

  function placeStatic(id) {
    const el = els.get(id);
    el.classList.remove("flying", "moving");
    setPose(el, id, slots[id]);
  }

  // -- layout ----------------------------------------------------------------

  /** Lay the board out again. Notes that moved slide over (unless `animate`
   *  is false); with `intro`, every note settles onto the board afresh. */
  function render({ animate = true, intro = false } = {}) {
    const now = performance.now();
    const width = Math.max(wrap.clientWidth, NOTE_W + 2 * MARGIN);
    const cols = Math.max(1, Math.floor((width - 2 * MARGIN + GAP) / (NOTE_W + GAP)));
    const left = Math.floor((width - (cols * NOTE_W + (cols - 1) * GAP)) / 2);

    const tasks = store.tasksFor(day);
    const rows = Math.max(1, Math.ceil(tasks.length / cols));
    const height = Math.max(wrap.clientHeight, MARGIN_TOP + rows * (NOTE_H + GAP) + MARGIN);
    board.style.height = height + "px";

    const next = {};
    tasks.forEach((task, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      next[task.id] = {
        x: left + col * (NOTE_W + GAP) + NOTE_W / 2,
        y: MARGIN_TOP + row * (NOTE_H + GAP) + NOTE_H / 2,
      };
    });
    if (!tasks.length) next[EMPTY] = { x: width / 2, y: MARGIN_TOP + NOTE_H / 2 + 20 };

    // Notes that left the board flutter away.
    let leaving = 0;
    for (const [id, el] of els) {
      if (next[id]) continue;
      els.delete(id);
      flights.delete(id);
      leave(el, leaving++ * 60);
    }

    // New notes settle in; every note does when the board (re)opens.
    const ids = Object.keys(next);
    ids.forEach((id, i) => {
      let el = els.get(id);
      const task = id === EMPTY ? null : findTask(id);
      if (!el) {
        el = task ? createNote(task) : createEmptyNote();
        els.set(id, el);
        board.appendChild(el);
        if (!flights.has(id)) startAppear(id, now, i);
      } else if (intro) {
        startAppear(id, now, i);
      }
      if (task) updateNote(el, task);
    });

    // Notes whose place changed slide over; one already flying in just
    // heads for its new place.
    for (const id of ids) {
      const flight = flights.get(id);
      if (flight && flight.kind !== "slide") continue;
      const old = flight ? pose(id, flight, now).p : slots[id];
      const target = next[id];
      if (old && (old.x !== target.x || old.y !== target.y) && animate && !REDUCED) {
        flights.set(id, { kind: "slide", start: now, from: { x: old.x, y: old.y } });
      } else if (flight && !animate) {
        flights.delete(id);
      }
    }

    slots = next;
    for (const id of ids) if (!flights.has(id)) placeStatic(id);
    step(now);
    run();
    updateHeader();
  }

  function startAppear(id, now, i) {
    if (REDUCED) return;
    flights.set(id, { kind: "appear", start: now, delay: i * APPEAR_STAGGER_MS,
                      side: Math.random() < 0.5 ? -1 : 1 });
  }

  function leave(el, delay) {
    el.classList.remove("flying", "moving", "editing");
    el.style.setProperty("--drift", `${Math.round(Math.random() * 80 - 40)}px`);
    el.style.setProperty("--turn", `${Math.round(Math.random() * 50 - 25)}deg`);
    el.querySelector(".note-body").style.animationDelay = delay + "ms";
    el.querySelector(".pin-head").style.animationDelay = delay + "ms";
    el.classList.add("leaving");
    el.removeAttribute("tabindex");
    setTimeout(() => el.remove(), 750 + delay);
  }

  // -- animation -------------------------------------------------------------

  /** Where a new note starts: just below the visible board, above the input. */
  function launchPoint() {
    const er = entry.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    const br = board.getBoundingClientRect();
    return { x: er.left - br.left + Math.min(er.width / 3, 220), y: wr.bottom - br.top + 40 };
  }

  /** Where a moving note is at `now`, and whether it has arrived. */
  function pose(id, flight, now) {
    const { x: x2, y: y2 } = slots[id];
    const ms = now - flight.start;
    const p = { x: x2, y: y2 };

    if (flight.kind === "slide") {
      const t = Math.min(1, ms / SLIDE_MS);
      const e = easeInOut(t);
      const { x: x0, y: y0 } = flight.from;
      p.x = x0 + (x2 - x0) * e;
      p.y = y0 + (y2 - y0) * e;
      p.lift = 0.35 * Math.sin(Math.PI * t);
      p.scale = 1 + 0.04 * Math.sin(Math.PI * t);
      return { p, done: t >= 1 };
    }

    if (flight.kind === "fly") {
      if (ms >= FLY_MS) return pinIn(p, ms - FLY_MS);
      // Float up along a curve, swaying and turning like a sheet of paper,
      // growing from small to full size as it nears the board.
      const t = Math.max(0, ms) / FLY_MS;
      const e = easeInOut(t);
      const side = flight.side;
      const { x: x0, y: y0 } = launchPoint();
      const x1 = x0 + (x2 - x0) * 0.25, y1 = Math.min(y0, y2) - 90;
      p.x = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * x1 + e ** 2 * x2;
      p.y = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * y1 + e ** 2 * y2;
      p.x += side * 26 * Math.sin(2 * Math.PI * t) * (1 - t);
      p.lift = 1 - e;
      p.pin = 1;
      p.spin = side * 18 * Math.cos(2.5 * Math.PI * t) * (1 - t) ** 2;
      p.scale = 0.35 + 0.65 * easeOutBack(t);
      return { p, done: false };
    }

    // "appear": dropped onto the board from just above it, then pinned.
    const m = ms - flight.delay;
    if (m < 0) return { p: Object.assign(p, { opacity: 0, pin: 1, lift: 1, scale: 1.14 }), done: false };
    if (m >= APPEAR_MS) return pinIn(p, m - APPEAR_MS);
    const t = m / APPEAR_MS;
    const e = easeOutCubic(t);
    p.scale = 1.14 - 0.14 * e;
    p.lift = 1 - e;
    p.spin = flight.side * 6 * (1 - e);
    p.opacity = Math.min(1, t * 2.2);
    p.pin = 1;
    return { p, done: false };
  }

  // Landed: the pin falls in, and when it hits, the note gives a little
  // bump and a few lines burst out around the pin.
  function pinIn(p, ms) {
    const u = Math.min(1, ms / PIN_MS);
    const fall = Math.min(1, u / 0.55);
    p.pin = 1 - fall ** 2;
    if (fall >= 1) {
      const k = (u - 0.55) / 0.45;
      p.scale = 1 - 0.035 * Math.sin(Math.PI * k);
      p.burst = true;
    }
    return { p, done: u >= 1 };
  }

  function step(now) {
    for (const [id, flight] of flights) {
      const el = els.get(id);
      if (!el || !slots[id]) {
        flights.delete(id);
        continue;
      }
      const { p, done } = pose(id, flight, now);
      if (p.burst && !flight.burst) {
        flight.burst = true;
        restart(el, "bursting");
        setTimeout(() => el.classList.remove("bursting"), 400);
      }
      if (done) {
        flights.delete(id);
        placeStatic(id);
        continue;
      }
      el.classList.toggle("flying", flight.kind === "fly");
      el.classList.toggle("moving", flight.kind === "slide");
      setPose(el, id, p);
    }
  }

  function run() {
    if (flights.size && frame === null) frame = requestAnimationFrame(animate);
  }

  function animate() {
    frame = null;
    step(performance.now());
    run();
  }

  function scrollIntoView(y) {
    const top = wrap.scrollTop, bottom = top + wrap.clientHeight;
    if (y - NOTE_H / 2 < top || y + NOTE_H / 2 > bottom) {
      wrap.scrollTo({ top: Math.max(0, y - wrap.clientHeight / 2), behavior: REDUCED ? "auto" : "smooth" });
    }
  }

  // -- header ----------------------------------------------------------------

  function updateHeader() {
    $("date").textContent = formatDay(day);
    const [done, total] = store.progress(day);
    let text;
    if (total === 0) text = "No tasks yet";
    else if (done === total) text = `All ${total} done for today — well done!`;
    else text = `${done} of ${total} done · ${total - done} left`;
    if (progressText.textContent !== text) {
      progressText.classList.add("swap");
      setTimeout(() => {
        progressText.textContent = text;
        progressText.classList.remove("swap");
      }, REDUCED ? 0 : 160);
    }
    progressFill.style.width = total ? `${(100 * done) / total}%` : "0";
    progressFill.classList.toggle("all", total > 0 && done === total);
    document.title = total > done ? `(${total - done}) Pendu — today's notes` : "Pendu — today's notes";
  }

  function celebrate() {
    if (REDUCED) return;
    const r = progressFill.parentElement.getBoundingClientRect();
    const colors = ["#fff176", "#f8bbd0", "#c5e1a5", "#b3e5fc", "#ffcc80", "#d1c4e9", "#e53935"];
    for (let i = 0; i < 42; i++) {
      const bit = document.createElement("i");
      bit.className = "confetti";
      bit.style.left = r.left + Math.random() * r.width + "px";
      bit.style.top = r.top + r.height / 2 + "px";
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty("--dx", `${Math.round(Math.random() * 360 - 180)}px`);
      bit.style.setProperty("--dy", `${Math.round(Math.random() * 280 + 60)}px`);
      bit.style.setProperty("--rot", `${Math.round(Math.random() * 900 - 450)}deg`);
      bit.style.animationDelay = Math.random() * 120 + "ms";
      document.body.appendChild(bit);
      setTimeout(() => bit.remove(), 1700);
    }
  }

  // -- actions ---------------------------------------------------------------

  function add() {
    const text = entry.value.trim();
    if (!text) {
      restart(entry, "shake");
      entry.focus();
      return;
    }
    const task = store.add(text, day, { color: newColor, daily: dailyBox.checked });
    entry.value = "";
    // Rotate to the next colour so the board stays colourful.
    pickColor(COLORS[(COLORS.indexOf(newColor) + 1) % COLORS.length]);
    // The new note flies from the input bar to its place on the board.
    if (!REDUCED) {
      flights.set(task.id, { kind: "fly", start: performance.now(), side: Math.random() < 0.5 ? -1 : 1 });
    }
    render();
    scrollIntoView(slots[task.id].y);
  }

  function toggle(id) {
    const task = findTask(id);
    const el = els.get(id);
    if (!task || !el) return;
    const done = store.toggle(id, day);
    updateNote(el, task);
    restart(el, "pressed");
    updateHeader();
    // Wait a moment so the tick is seen before notes change places.
    clearTimeout(reorderTimer);
    reorderTimer = setTimeout(() => render(), REDUCED ? 0 : REORDER_MS);
    const [d, total] = store.progress(day);
    if (done && d === total) celebrate();
  }

  function snapshot() {
    return JSON.stringify(store.toJSON());
  }

  function restore(saved) {
    store.replaceWith(JSON.parse(saved));
    render();
  }

  function removeTask(id) {
    const task = findTask(id);
    if (!task) return;
    const saved = snapshot();
    store.delete(id);
    render();
    showToast(`Removed “${shorten(task.text, 32)}”`, () => restore(saved));
  }

  function clearDone() {
    const finished = store.tasks.filter((t) => !t.daily && store.isDone(t, day)).length;
    if (!finished) {
      showToast("No finished notes to clear");
      return;
    }
    const saved = snapshot();
    store.clearDone(day);
    render();
    showToast(finished === 1 ? "Cleared 1 finished note" : `Cleared ${finished} finished notes`,
              () => restore(saved));
  }

  function edit(id) {
    cancelPendingToggle();
    const task = findTask(id);
    const el = els.get(id);
    if (!task || !el || el.classList.contains("editing")) return;
    closeMenu();
    const span = el.querySelector(".text span");
    el.classList.add("editing");
    span.textContent = task.text;
    try {
      span.contentEditable = "plaintext-only";
    } catch (e) {
      span.contentEditable = "true";
    }
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = (save) => {
      span.removeEventListener("keydown", onKey);
      span.removeEventListener("blur", onBlur);
      span.contentEditable = "false";
      el.classList.remove("editing");
      const current = findTask(id);
      if (!current) return;
      const text = span.textContent.trim();
      if (save && text && text !== current.text) store.edit(id, { text });
      updateNote(el, current);
    };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        span.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        span.removeEventListener("blur", onBlur);
        finish(false);
        el.focus();
      }
    };
    const onBlur = () => finish(true);
    span.addEventListener("keydown", onKey);
    span.addEventListener("blur", onBlur);
  }

  function cancelPendingToggle() {
    if (pendingToggle) {
      clearTimeout(pendingToggle);
      pendingToggle = null;
    }
  }

  function pickColor(name) {
    newColor = name;
    for (const sw of swatchBox.children) {
      sw.setAttribute("aria-checked", String(sw.dataset.color === name));
    }
  }

  // -- menus and toast -------------------------------------------------------

  function openMenu(items, x, y) {
    menu.innerHTML = "";
    for (const item of items) {
      if (item === "-") {
        menu.appendChild(document.createElement("hr"));
      } else if (item.colors) {
        const row = document.createElement("div");
        row.className = "colors";
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", "Colour");
        for (const name of COLORS) {
          const sw = document.createElement("button");
          sw.type = "button";
          sw.className = "swatch";
          sw.dataset.color = name;
          sw.setAttribute("role", "menuitemradio");
          sw.setAttribute("aria-checked", String(name === item.colors));
          sw.setAttribute("aria-label", name);
          sw.addEventListener("click", () => {
            closeMenu();
            item.pick(name);
          });
          row.appendChild(sw);
        }
        menu.appendChild(row);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "menuitem");
        btn.textContent = item.label;
        if (item.danger) btn.className = "danger";
        btn.addEventListener("click", () => {
          closeMenu();
          item.action();
        });
        menu.appendChild(btn);
      }
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, innerHeight - r.height - 8));
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.setProperty("--ox", x - left + "px");
    menu.style.setProperty("--oy", y - top + "px");
    const first = menu.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!menu.hidden) menu.hidden = true;
  }

  function openNoteMenu(id, x, y) {
    const task = findTask(id);
    if (!task) return;
    const done = store.isDone(task, day);
    openMenu([
      { label: done ? "Mark not done" : "Mark done", action: () => toggle(id) },
      { label: "Edit text…", action: () => edit(id) },
      { colors: task.color, pick: (name) => {
          store.edit(id, { color: name });
          updateNote(els.get(id), task);
        } },
      { label: task.daily ? "Stop repeating" : "Repeat every day", action: () => {
          store.edit(id, { daily: !task.daily });
          render();
        } },
      "-",
      { label: "Remove", danger: true, action: () => removeTask(id) },
    ], x, y);
  }

  let toastTimer = null;
  let toastUndo = null;

  function showToast(text, undo) {
    $("toast-text").textContent = text;
    toastUndo = undo || null;
    $("toast-undo").hidden = !undo;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 6000 : 2500);
  }

  function hideToast() {
    toast.hidden = true;
    toastUndo = null;
  }

  $("toast-undo").addEventListener("click", () => {
    const undo = toastUndo;
    hideToast();
    if (undo) undo();
  });

  // -- import / export -------------------------------------------------------

  function exportNotes() {
    const blob = new Blob([JSON.stringify(store.toJSON(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notes.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const saved = snapshot();
    try {
      store.replaceWith(JSON.parse(await file.text()));
    } catch (err) {
      showToast("That file isn't a Pendu notes file");
      return;
    }
    render({ intro: true });
    const n = store.tasks.length;
    showToast(n === 1 ? "Imported 1 note" : `Imported ${n} notes`, () => restore(saved));
  });

  $("more").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu([
      { label: "Export notes (notes.json)", action: exportNotes },
      { label: "Import notes…", action: () => $("import-file").click() },
      "-",
      { label: "About Pendu", action: () => { window.location.href = "index.html"; } },
      { label: "Get the desktop app", action: () =>
          window.open("https://github.com/jaisudhakar/pendu-reminder", "_blank", "noopener") },
    ], r.right - 220, r.bottom + 6);
  });

  $("clear").addEventListener("click", clearDone);

  // -- note events -----------------------------------------------------------

  const noteOf = (target) => target.closest(".note:not(.leaving)");
  let press = null;
  let suppressClick = false;

  board.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const el = noteOf(e.target);
    if (!el) return;
    const id = el.dataset.id;
    if (id === EMPTY) {
      entry.focus();
      return;
    }
    if (el.classList.contains("editing")) return;
    if (e.target.closest(".close")) {
      removeTask(id);
      return;
    }
    if (e.target.closest(".check")) {
      cancelPendingToggle();
      toggle(id);
      return;
    }
    // Toggle on click anywhere on the note; wait briefly so a double-click
    // (edit) doesn't also toggle.
    if (pendingToggle) {
      cancelPendingToggle();
      return;
    }
    pendingToggle = setTimeout(() => {
      pendingToggle = null;
      toggle(id);
    }, 250);
  });

  board.addEventListener("dblclick", (e) => {
    const el = noteOf(e.target);
    if (el && el.dataset.id !== EMPTY && !e.target.closest(".close, .check")) edit(el.dataset.id);
  });

  board.addEventListener("contextmenu", (e) => {
    const el = noteOf(e.target);
    if (!el || el.dataset.id === EMPTY || el.classList.contains("editing")) return;
    e.preventDefault();
    clearPress();
    openNoteMenu(el.dataset.id, e.clientX, e.clientY);
  });

  board.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!el.classList || !el.classList.contains("note") || el.dataset.id === EMPTY) return;
    const id = el.dataset.id;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeTask(id);
    } else if (e.key === "F2") {
      e.preventDefault();
      edit(id);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      openNoteMenu(id, r.left + r.width / 2, r.top + r.height / 2);
    }
  });

  // Long-press on touch screens opens the note's menu.
  function clearPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  board.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (e.pointerType !== "touch") return;
    const el = noteOf(e.target);
    if (!el || el.dataset.id === EMPTY || el.classList.contains("editing")) return;
    const { clientX: x, clientY: y } = e;
    press = { x, y, timer: setTimeout(() => {
      press = null;
      suppressClick = true;
      cancelPendingToggle();
      openNoteMenu(el.dataset.id, x, y);
    }, 550) };
  });

  board.addEventListener("pointermove", (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearPress();
  });
  board.addEventListener("pointerup", clearPress);
  board.addEventListener("pointercancel", clearPress);

  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (menu.hidden) return;
    const items = [...menu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      closeMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      items[(i + d + items.length) % items.length].focus();
    }
  });

  wrap.addEventListener("scroll", closeMenu, { passive: true });
  window.addEventListener("blur", closeMenu);

  // -- composer --------------------------------------------------------------

  for (const name of COLORS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch";
    sw.dataset.color = name;
    sw.setAttribute("role", "radio");
    sw.setAttribute("aria-label", name);
    sw.addEventListener("click", () => pickColor(name));
    swatchBox.appendChild(sw);
  }
  pickColor(COLORS[0]);

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    add();
  });

  // -- the cork ----------------------------------------------------------------

  function corkTexture() {
    const size = 360;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // Same speckles as the desktop board, from a fixed seed.
    let seed = 7;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const dots = ["#b58a5c", "#d2aa7e", "#a97f53"];
    for (let i = 0; i < (size * size) / 900; i++) {
      const x = rnd() * size, y = rnd() * size, r = 0.8 + rnd() * 1.4;
      ctx.fillStyle = dots[Math.floor(rnd() * dots.length)];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    board.style.setProperty("--dots", `url(${canvas.toDataURL()})`);
  }

  // -- a new day, and coming back --------------------------------------------

  let lastTick = Date.now();
  let hiddenAt = null;
  let comeBackPending = false;

  function comeBack() {
    if (document.hidden) {
      comeBackPending = true;
      return;
    }
    comeBackPending = false;
    store.load();
    render({ intro: true });
  }

  function tick() {
    const now = Date.now();
    const woke = now - lastTick > WAKE_GAP_MS;
    lastTick = now;
    const newDay = today() !== day;
    if (newDay) day = today();
    if (newDay || woke) comeBack();
  }

  setInterval(tick, TICK_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      closeMenu();
      return;
    }
    const away = hiddenAt !== null && Date.now() - hiddenAt > AWAY_MS;
    hiddenAt = null;
    tick();
    if (comeBackPending || away) comeBack();
  });

  // Another tab changed the notes: show the same board here.
  window.addEventListener("storage", (e) => {
    if (e.key !== store.key) return;
    store.load();
    render();
  });

  let resizeFrame = null;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      render();
    });
  }).observe(wrap);

  corkTexture();
  render({ intro: true });
  if (window.matchMedia("(pointer: fine)").matches) entry.focus({ preventScroll: true });
})();
