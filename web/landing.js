/* Pendu landing page: the demo board in the hero, and scroll effects. */
(function () {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  $("year").textContent = new Date().getFullYear();

  // If the GitHub avatar can't load, show an "S" in its place.
  for (const img of document.querySelectorAll("img.avatar")) {
    const swap = () => {
      const s = document.createElement("span");
      s.className = img.className + " initial";
      s.textContent = "S";
      s.setAttribute("aria-hidden", "true");
      img.replaceWith(s);
    };
    if (img.complete && !img.naturalWidth) swap();
    else img.addEventListener("error", swap);
  }

  // -- nav shadow once the page scrolls --------------------------------------

  const nav = $("nav");
  const timeline = document.querySelector(".timeline");

  function onScroll() {
    nav.classList.toggle("scrolled", window.scrollY > 8);
    // The line down the timeline grows as you read through the day.
    const r = timeline.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - r.top) / r.height));
    timeline.style.setProperty("--progress", progress.toFixed(3));
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // -- scroll reveal ------------------------------------------------------------

  // Siblings come in one after another.
  const groups = new Map();
  for (const el of document.querySelectorAll(".reveal")) {
    const i = groups.get(el.parentElement) || 0;
    groups.set(el.parentElement, i + 1);
    el.style.setProperty("--delay", `${Math.min(i, 6) * 0.08}s`);
  }

  if ("IntersectionObserver" in window && !REDUCED) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  }

  // -- the demo board -------------------------------------------------------------

  const DEMO = [
    { text: "Pay electricity bill", color: "pink", tag: "from 09/28", tilt: -1.8 },
    { text: "Send the report to Ravi", color: "yellow", tilt: 1.2 },
    { text: "Drink 8 glasses of water", color: "blue", tag: "every day", tilt: -0.9 },
    { text: "Team stand-up at 10:00", color: "green", tilt: 1.6 },
  ];
  const TICK_ORDER = [3, 0, 2];

  const demo = document.querySelector(".demo");
  const board = $("demo-board");
  const typed = $("demo-typed");
  const input = $("demo-input");
  const stick = $("demo-stick");
  const count = $("demo-count");
  const fill = $("demo-fill");

  let onScreen = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(demo);
  }

  // Waits, and holds the demo while it is off screen or the tab is hidden.
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(function check() {
        if (onScreen && !document.hidden) resolve();
        else setTimeout(check, 250);
      }, ms);
    });
  }

  function setProgress(done, total) {
    if (!total) count.textContent = "No tasks yet";
    else if (done === total) count.textContent = `All ${total} done — well done!`;
    else count.textContent = `${done} of ${total} done · ${total - done} left`;
    fill.style.width = total ? `${(100 * done) / total}%` : "0";
    fill.classList.toggle("all", total > 0 && done === total);
  }

  function makeNote(item) {
    const wrap = document.createElement("div");
    wrap.className = "mini-wrap";
    wrap.dataset.color = item.color;
    wrap.innerHTML = `
      <div class="mini" style="--tilt:${item.tilt}deg">
        <div class="mini-text"><span></span></div>
        <i class="mini-box"></i>
        ${item.tag ? `<em class="mini-tag">${item.tag}</em>` : ""}
      </div>
      <i class="mini-pin"></i>`;
    wrap.querySelector(".mini-text span").textContent = item.text;
    return wrap;
  }

  // The note floats up from the input bar, sways, and gets pinned.
  function flyIn(wrap, side) {
    const from = input.getBoundingClientRect();
    const to = wrap.getBoundingClientRect();
    const dx = from.left + from.width * 0.3 - (to.left + to.width / 2);
    const dy = from.top - (to.top + to.height / 2);
    wrap.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${-14 * side}deg) scale(.3)`, opacity: 0 },
      { transform: `translate(${dx * 0.55 + 22 * side}px, ${dy * 0.45 - 30}px) rotate(${10 * side}deg) scale(.75)`,
        opacity: 1, offset: 0.4 },
      { transform: `translate(${-8 * side}px, -6px) rotate(${-4 * side}deg) scale(1.06)`, offset: 0.8 },
      { transform: "none", opacity: 1 },
    ], { duration: 1100, easing: "cubic-bezier(.45, .05, .35, 1)" });
    wrap.querySelector(".mini-pin").animate([
      { transform: "translateY(-260%) scale(1.8)", opacity: 0 },
      { transform: "translateY(-260%) scale(1.8)", opacity: 1, offset: 0.1 },
      { transform: "none", opacity: 1 },
    ], { duration: 280, delay: 1050, easing: "ease-in", fill: "backwards" });
    wrap.animate([
      { transform: "scale(1)" }, { transform: "scale(.96)" }, { transform: "scale(1)" },
    ], { duration: 200, delay: 1330 });
  }

  function flutterOff(wrap, i) {
    const drift = Math.round(Math.random() * 60 - 30);
    const a = wrap.animate([
      { transform: "none", opacity: 1 },
      { transform: "translateY(-6px) rotate(-3deg)", opacity: 1, offset: 0.18 },
      { transform: `translate(${drift}px, 130%) rotate(${drift > 0 ? 22 : -22}deg) scale(.85)`, opacity: 0 },
    ], { duration: 650, delay: i * 90, easing: "cubic-bezier(.55, 0, .75, .4)", fill: "forwards" });
    return a.finished;
  }

  async function type(text) {
    typed.textContent = "";
    for (const ch of text) {
      typed.textContent += ch;
      await sleep(40 + Math.random() * 45);
    }
  }

  async function run() {
    for (;;) {
      board.textContent = "";
      setProgress(0, 0);
      await sleep(700);

      const notes = [];
      for (let i = 0; i < DEMO.length; i++) {
        await type(DEMO[i].text);
        await sleep(250);
        stick.classList.add("press");
        await sleep(120);
        stick.classList.remove("press");
        typed.textContent = "";
        const wrap = makeNote(DEMO[i]);
        board.appendChild(wrap);
        notes.push(wrap);
        flyIn(wrap, i % 2 ? 1 : -1);
        setProgress(0, notes.length);
        await sleep(1350);
      }

      await sleep(500);
      let done = 0;
      for (const i of TICK_ORDER) {
        notes[i].classList.add("done");
        notes[i].animate([
          { transform: "scale(1)" }, { transform: "scale(.94) rotate(-1deg)" }, { transform: "scale(1)" },
        ], { duration: 360, easing: "ease-out" });
        setProgress(++done, notes.length);
        await sleep(1000);
      }

      await sleep(2200);
      await Promise.all(notes.map(flutterOff));
      await sleep(300);
    }
  }

  if (REDUCED) {
    // A still picture of the board instead of the loop.
    DEMO.forEach((item, i) => {
      const wrap = makeNote(item);
      if (TICK_ORDER.includes(i)) wrap.classList.add("done");
      board.appendChild(wrap);
    });
    setProgress(TICK_ORDER.length, DEMO.length);
  } else {
    run();
  }
})();
