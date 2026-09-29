"""Pendu window: today's tasks pinned to a cork board as sticky notes."""

import math
import queue
import random
import socket
import sys
import threading
import time
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, simpledialog

from . import autostart
from .store import COLORS, TaskStore, today

# Port used to make sure only one Pendu runs; a second launch just raises
# the existing window.
INSTANCE_PORT = 47621

# If the clock jumps by more than this between ticks, the laptop was asleep.
WAKE_GAP_SECONDS = 60
TICK_MS = 10_000

NOTE_W, NOTE_H = 210, 180
GAP = 26
MARGIN = 30

CORK = "#c49a6c"
CORK_DOT = ("#b58a5c", "#d2aa7e", "#a97f53")
INK = "#2f2a24"
FADED_INK = "#7d7468"

PAPER = {
    "yellow": ("#fff176", "#f0dc4c"),
    "pink": ("#f8bbd0", "#ec98b4"),
    "green": ("#c5e1a5", "#a6cc7f"),
    "blue": ("#b3e5fc", "#86cfee"),
    "orange": ("#ffcc80", "#f5b156"),
    "purple": ("#d1c4e9", "#b7a5d8"),
}
PIN = {"yellow": "#e53935", "pink": "#1e88e5", "green": "#e53935",
       "blue": "#fb8c00", "orange": "#3949ab", "purple": "#43a047"}

UI_FONT = ("Segoe UI", 10) if sys.platform == "win32" else ("Helvetica", 11)
# Handwriting-style fonts, first one installed wins.
HAND_FONTS = [("Segoe Print", 12), ("Ink Free", 14), ("Marker Felt", 15),
              ("Chalkboard SE", 13), ("Comic Neue", 13), ("Comic Sans MS", 12),
              ("Purisa", 12), ("Kalam", 13)]
RIGHT_CLICK = "<Button-2>" if sys.platform == "darwin" else "<Button-3>"


def _blend(hex_a, hex_b, t):
    a = [int(hex_a[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(hex_b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(a, b))


def _shorten(text, limit=110):
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


class SingleInstance:
    """Listens on a local port so later launches can ask us to show up."""

    def __init__(self):
        self.requests = queue.Queue()
        self.sock = None

    @staticmethod
    def signal_existing():
        try:
            with socket.create_connection(("127.0.0.1", INSTANCE_PORT), timeout=1) as s:
                s.sendall(b"show")
            return True
        except OSError:
            return False

    def start(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.bind(("127.0.0.1", INSTANCE_PORT))
            self.sock.listen(5)
        except OSError:
            self.sock = None
            return
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                try:
                    if conn.recv(16).startswith(b"show"):
                        self.requests.put("show")
                except OSError:
                    pass


class PenduApp:
    def __init__(self, store=None, instance=None):
        self.store = store or TaskStore()
        self.instance = instance
        self.day = today()
        self.last_tick = time.time()
        self._pending_toggle = None

        self.root = tk.Tk()
        self.root.title("Pendu — today's notes")
        self.root.configure(bg=CORK)
        self.root.minsize(520, 420)
        self._center(960, 660)
        self.root.protocol("WM_DELETE_WINDOW", self.root.iconify)
        installed = set(tkfont.families(self.root))
        self.hand_font = next((f for f in HAND_FONTS if f[0] in installed),
                              (UI_FONT[0], UI_FONT[1] + 1))

        self.new_color = tk.StringVar(value=COLORS[0])
        self.new_daily = tk.BooleanVar(value=False)
        self.autostart_on = tk.BooleanVar(value=autostart.is_installed())

        self._build_header()
        self._build_footer()
        self._build_board()
        self._first_run()

        self.redraw()
        self.root.after(TICK_MS, self._tick)
        self.root.after(500, self._poll_instance)

    # -- layout --------------------------------------------------------------

    def _center(self, w, h):
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        w, h = min(w, sw - 60), min(h, sh - 100)
        self.root.geometry(f"{w}x{h}+{(sw - w) // 2}+{max(20, (sh - h) // 3)}")

    def _build_header(self):
        bar = tk.Frame(self.root, bg="#6d4c33", padx=18, pady=10)
        bar.pack(side="top", fill="x")

        left = tk.Frame(bar, bg="#6d4c33")
        left.pack(side="left")
        tk.Label(left, text="Pendu", fg="#fff3c4", bg="#6d4c33",
                 font=(self.hand_font[0], 20, "bold")).pack(side="left")
        self.date_label = tk.Label(left, fg="#f3e2c7", bg="#6d4c33",
                                   font=(UI_FONT[0], UI_FONT[1] + 2))
        self.date_label.pack(side="left", padx=(16, 0), pady=(6, 0))

        right = tk.Frame(bar, bg="#6d4c33")
        right.pack(side="right")
        tk.Checkbutton(right, text="Open when I log in", variable=self.autostart_on,
                       command=self._toggle_autostart, fg="#f3e2c7", bg="#6d4c33",
                       selectcolor="#6d4c33", activebackground="#6d4c33",
                       activeforeground="#fff", font=UI_FONT, bd=0,
                       highlightthickness=0).pack(side="right", padx=(12, 0))
        tk.Button(right, text="Clear finished", command=self._clear_done,
                  font=UI_FONT, relief="flat", bg="#8a6446", fg="#fff",
                  activebackground="#9c7455", activeforeground="#fff",
                  padx=10, cursor="hand2").pack(side="right", padx=(12, 0))

        mid = tk.Frame(bar, bg="#6d4c33")
        mid.pack(side="right", padx=10)
        self.progress_label = tk.Label(mid, fg="#fff3c4", bg="#6d4c33", font=UI_FONT)
        self.progress_label.pack(anchor="e")
        self.progress_bar = tk.Canvas(mid, width=180, height=8, bg="#4f3524",
                                      highlightthickness=0)
        self.progress_bar.pack(anchor="e", pady=(3, 0))

    def _build_footer(self):
        bar = tk.Frame(self.root, bg="#6d4c33", padx=18, pady=10)
        bar.pack(side="bottom", fill="x")

        self.entry = tk.Entry(bar, font=(UI_FONT[0], UI_FONT[1] + 1), relief="flat",
                              bg="#fffdf5", fg=INK, insertbackground=INK)
        self.entry.pack(side="left", fill="x", expand=True, ipady=6)
        self.entry.bind("<Return>", lambda e: self._add())
        self._placeholder(self.entry, "Write a task for today and press Enter…")

        tk.Button(bar, text="Stick it", command=self._add, font=(UI_FONT[0], UI_FONT[1], "bold"),
                  relief="flat", bg="#fff176", fg=INK, activebackground="#fff59d",
                  padx=14, cursor="hand2").pack(side="right", padx=(10, 0), ipady=3)
        tk.Checkbutton(bar, text="Every day", variable=self.new_daily, fg="#f3e2c7",
                       bg="#6d4c33", selectcolor="#6d4c33", activebackground="#6d4c33",
                       activeforeground="#fff", font=UI_FONT, bd=0,
                       highlightthickness=0).pack(side="right", padx=(10, 0))

        swatches = tk.Frame(bar, bg="#6d4c33")
        swatches.pack(side="right", padx=(10, 0))
        self.swatches = {}
        for name in COLORS:
            sw = tk.Canvas(swatches, width=22, height=22, bg="#6d4c33",
                           highlightthickness=0, cursor="hand2")
            sw.pack(side="left", padx=2)
            sw.bind("<Button-1>", lambda e, n=name: self._pick_color(n))
            self.swatches[name] = sw
        self._pick_color(COLORS[0])

    def _build_board(self):
        holder = tk.Frame(self.root, bg=CORK)
        holder.pack(side="top", fill="both", expand=True)
        self.canvas = tk.Canvas(holder, bg=CORK, highlightthickness=0)
        scroll = tk.Scrollbar(holder, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.canvas.bind("<Configure>", lambda e: self.redraw())
        self.canvas.bind_all("<MouseWheel>", self._on_wheel)
        self.canvas.bind_all("<Button-4>", lambda e: self.canvas.yview_scroll(-2, "units"))
        self.canvas.bind_all("<Button-5>", lambda e: self.canvas.yview_scroll(2, "units"))

    def _placeholder(self, entry, text):
        def show(_=None):
            if not entry.get():
                entry.insert(0, text)
                entry.config(fg="#9b9186")
                entry.placeholder = True

        def hide(_=None):
            if getattr(entry, "placeholder", False):
                entry.delete(0, "end")
                entry.config(fg=INK)
                entry.placeholder = False

        entry.bind("<FocusIn>", hide)
        entry.bind("<FocusOut>", show)
        entry.placeholder_show = show
        show()

    # -- drawing -------------------------------------------------------------

    def redraw(self):
        c = self.canvas
        c.delete("all")
        width = max(c.winfo_width(), NOTE_W + 2 * MARGIN)
        cols = max(1, (width - 2 * MARGIN + GAP) // (NOTE_W + GAP))
        left = (width - (cols * NOTE_W + (cols - 1) * GAP)) // 2

        tasks = self.store.tasks_for(self.day)
        rows = max(1, math.ceil(len(tasks) / cols))
        height = max(c.winfo_height(), 2 * MARGIN + rows * (NOTE_H + GAP))
        self._draw_cork(width, height)

        if not tasks:
            self._draw_note(width // 2, MARGIN + NOTE_H // 2 + 20, None)
        for i, task in enumerate(tasks):
            col, row = i % cols, i // cols
            cx = left + col * (NOTE_W + GAP) + NOTE_W // 2
            cy = MARGIN + row * (NOTE_H + GAP) + NOTE_H // 2 + 8
            self._draw_note(cx, cy, task)

        c.configure(scrollregion=(0, 0, width, height))
        self._update_header()

    def _draw_cork(self, width, height):
        rnd = random.Random(7)
        for _ in range(int(width * height / 900)):
            x, y = rnd.uniform(0, width), rnd.uniform(0, height)
            r = rnd.uniform(0.8, 2.2)
            color = rnd.choice(CORK_DOT)
            self.canvas.create_oval(x - r, y - r, x + r, y + r, fill=color, outline="")

    def _draw_note(self, cx, cy, task):
        c = self.canvas
        if task is None:
            key, angle, paper, pin, done = "empty", -2.0, PAPER["yellow"], PIN["yellow"], False
            text = "Nothing on the board.\n\nWrite today's tasks below and stick them here."
        else:
            key = task["id"]
            # Stable, slightly different tilt for every note.
            angle = (int(key[:4], 16) % 9 - 4) * 0.9
            color = task.get("color", "yellow")
            paper, pin = PAPER.get(color, PAPER["yellow"]), PIN.get(color, "#e53935")
            done = self.store.is_done(task, self.day)
            text = _shorten(task["text"])

        fill, edge = paper
        ink = INK
        if done:
            fill, edge, ink = _blend(fill, "#ffffff", 0.45), _blend(edge, "#ffffff", 0.45), FADED_INK

        tag = f"note-{key}"
        rad = math.radians(angle)

        def pt(dx, dy):
            return (cx + dx * math.cos(rad) - dy * math.sin(rad),
                    cy + dx * math.sin(rad) + dy * math.cos(rad))

        hw, hh = NOTE_W / 2, NOTE_H / 2
        corners = [pt(-hw, -hh), pt(hw, -hh), pt(hw, hh - 14), pt(hw - 14, hh), pt(-hw, hh)]
        shadow = [(x + 4, y + 6) for x, y in corners]
        c.create_polygon(shadow, fill="#8f6c47", outline="", tags=tag)
        c.create_polygon(corners, fill=fill, outline=edge, width=1, tags=tag)
        # Folded corner.
        c.create_polygon([pt(hw, hh - 14), pt(hw - 14, hh - 14), pt(hw - 14, hh)],
                         fill=edge, outline=edge, tags=tag)
        # Sticky strip at the top.
        c.create_polygon([pt(-hw, -hh), pt(hw, -hh), pt(hw, -hh + 22), pt(-hw, -hh + 22)],
                         fill=_blend(fill, edge, 0.5), outline="", tags=tag)

        font = (*self.hand_font, "overstrike") if done else self.hand_font
        tx, ty = pt(0, 2)
        c.create_text(tx, ty, text=text, width=NOTE_W - 34, fill=ink, font=font,
                      angle=-angle, justify="center", tags=tag)

        # Push pin.
        px, py = pt(0, -hh + 10)
        c.create_oval(px - 7, py - 5, px + 9, py + 11, fill="#7a5a3a",
                      outline="", tags=tag)
        c.create_oval(px - 8, py - 8, px + 8, py + 8, fill=pin, outline=_blend(pin, "#000000", 0.3),
                      tags=tag)
        c.create_oval(px - 4, py - 5, px, py - 1, fill=_blend(pin, "#ffffff", 0.6), outline="",
                      tags=tag)

        if task is None:
            return

        # Checkbox.
        bx, by = pt(-hw + 24, hh - 22)
        box = f"box-{key}"
        c.create_rectangle(bx - 9, by - 9, bx + 9, by + 9, fill="#fffdf5",
                           outline=_blend(edge, "#000000", 0.35), width=2, tags=(tag, box))
        if done:
            c.create_line(bx - 5, by, bx - 1, by + 5, bx + 7, by - 6, fill="#2e7d32",
                          width=3, capstyle="round", tags=(tag, box))

        label = None
        if task.get("daily"):
            label = "every day"
        elif self.store.is_carried_over(task, self.day):
            label = "from " + task["date"][5:].replace("-", "/")
        if label:
            lx, ly = pt(hw - 22, hh - 22)
            c.create_text(lx, ly, text=label, anchor="e", angle=-angle, fill=_blend(ink, fill, 0.35),
                          font=(UI_FONT[0], UI_FONT[1] - 2, "italic"), tags=tag)

        # Delete button, only visible on hover.
        dx, dy = pt(hw - 14, -hh + 12)
        close = f"close-{key}"
        c.create_text(dx, dy, text="×", fill=fill, font=(UI_FONT[0], 14, "bold"),
                      tags=(tag, close))

        c.tag_bind(tag, "<Enter>", lambda e: (c.config(cursor="hand2"),
                                               c.itemconfigure(close, fill=_blend(ink, fill, 0.3))))
        c.tag_bind(tag, "<Leave>", lambda e: (c.config(cursor=""),
                                               c.itemconfigure(close, fill=fill)))
        c.tag_bind(tag, "<Button-1>", lambda e, k=key: self._on_click(e, k))
        c.tag_bind(tag, "<Double-Button-1>", lambda e, k=key: self._edit(k))
        c.tag_bind(tag, RIGHT_CLICK, lambda e, k=key: self._menu(e, k))

    def _update_header(self):
        self.date_label.config(text=self.day.strftime("%A, %d %B %Y"))
        done, total = self.store.progress(self.day)
        if total == 0:
            text = "No tasks yet"
        elif done == total:
            text = f"All {total} done for today — well done!"
        else:
            text = f"{done} of {total} done · {total - done} left"
        self.progress_label.config(text=text)
        bar = self.progress_bar
        bar.delete("all")
        if total:
            bar.create_rectangle(0, 0, 180 * done / total, 8,
                                 fill="#aed581" if done == total else "#fff176", outline="")

    def _pick_color(self, name):
        self.new_color.set(name)
        for n, sw in self.swatches.items():
            sw.delete("all")
            fill = PAPER[n][0]
            if n == name:
                sw.create_rectangle(1, 1, 21, 21, fill=fill, outline="#fff", width=2)
            else:
                sw.create_rectangle(4, 4, 18, 18, fill=fill, outline=PAPER[n][1])

    # -- actions -------------------------------------------------------------

    def _on_click(self, event, key):
        c = self.canvas
        x, y = c.canvasx(event.x), c.canvasy(event.y)
        hit = c.find_overlapping(x - 1, y - 1, x + 1, y + 1)
        tags = {t for item in hit for t in c.gettags(item)}
        if f"close-{key}" in tags:
            self._delete(key)
        else:
            # Toggle on click anywhere on the note; wait briefly so a
            # double-click (edit) doesn't also toggle.
            if self._pending_toggle:
                self.root.after_cancel(self._pending_toggle)
                self._pending_toggle = None
                return
            self._pending_toggle = self.root.after(250, lambda: self._toggle(key))

    def _toggle(self, key):
        self._pending_toggle = None
        self.store.toggle(key, self.day)
        self.redraw()

    def _add(self):
        if getattr(self.entry, "placeholder", False):
            return
        text = self.entry.get().strip()
        if not text:
            return
        self.store.add(text, self.day, color=self.new_color.get(), daily=self.new_daily.get())
        self.entry.delete(0, "end")
        # Rotate to the next colour so the board stays colourful.
        nxt = COLORS[(COLORS.index(self.new_color.get()) + 1) % len(COLORS)]
        self._pick_color(nxt)
        self.redraw()
        self.canvas.yview_moveto(1.0)

    def _edit(self, key):
        if self._pending_toggle:
            self.root.after_cancel(self._pending_toggle)
            self._pending_toggle = None
        task = self.store.get(key)
        text = simpledialog.askstring("Edit note", "Task:", initialvalue=task["text"],
                                      parent=self.root)
        if text and text.strip():
            self.store.edit(key, text=text)
            self.redraw()

    def _delete(self, key):
        task = self.store.get(key)
        if messagebox.askyesno("Remove note", f"Remove this note?\n\n{_shorten(task['text'], 80)}",
                               parent=self.root):
            self.store.delete(key)
            self.redraw()

    def _menu(self, event, key):
        task = self.store.get(key)
        menu = tk.Menu(self.root, tearoff=0)
        done = self.store.is_done(task, self.day)
        menu.add_command(label="Mark not done" if done else "Mark done",
                         command=lambda: self._toggle(key))
        menu.add_command(label="Edit text…", command=lambda: self._edit(key))
        colors = tk.Menu(menu, tearoff=0)
        for name in COLORS:
            colors.add_command(label=name.capitalize(),
                               command=lambda n=name: (self.store.edit(key, color=n), self.redraw()))
        menu.add_cascade(label="Colour", menu=colors)
        menu.add_command(label="Stop repeating" if task.get("daily") else "Repeat every day",
                         command=lambda: (self.store.edit(key, daily=not task.get("daily")),
                                          self.redraw()))
        menu.add_separator()
        menu.add_command(label="Remove", command=lambda: self._delete(key))
        menu.tk_popup(event.x_root, event.y_root)

    def _clear_done(self):
        self.store.clear_done(self.day)
        self.redraw()

    def _toggle_autostart(self):
        try:
            if self.autostart_on.get():
                autostart.install()
            else:
                autostart.remove()
        except OSError as exc:
            messagebox.showerror("Pendu", f"Could not change the login setting:\n{exc}",
                                 parent=self.root)
        self.autostart_on.set(autostart.is_installed())
        self.store.settings["autostart_offered"] = True
        self.store.save()

    def _first_run(self):
        # Enable "open when I log in" once, on the very first launch. If the
        # user switches it off later we leave it off.
        if self.store.settings.get("autostart_offered"):
            return
        try:
            autostart.install()
        except OSError:
            pass
        self.autostart_on.set(autostart.is_installed())
        self.store.settings["autostart_offered"] = True
        self.store.save()

    def _on_wheel(self, event):
        delta = event.delta if sys.platform == "darwin" else event.delta // 120
        self.canvas.yview_scroll(-delta, "units")

    # -- showing up when the laptop wakes ----------------------------------

    def show(self):
        root = self.root
        root.deiconify()
        root.lift()
        root.attributes("-topmost", True)
        root.after(1500, lambda: root.attributes("-topmost", False))
        root.focus_force()

    def _tick(self):
        now = time.time()
        woke = now - self.last_tick > WAKE_GAP_SECONDS
        self.last_tick = now
        new_day = today() != self.day
        if new_day:
            self.day = today()
            self.store.load()
        if new_day or woke:
            self.redraw()
            self.show()
        self.root.after(TICK_MS, self._tick)

    def _poll_instance(self):
        if self.instance:
            try:
                while True:
                    self.instance.requests.get_nowait()
                    self.store.load()
                    self.redraw()
                    self.show()
            except queue.Empty:
                pass
        self.root.after(500, self._poll_instance)

    def run(self):
        self.show()
        self.root.mainloop()


def main(store=None):
    if SingleInstance.signal_existing():
        return
    instance = SingleInstance()
    instance.start()
    PenduApp(store=store, instance=instance).run()
