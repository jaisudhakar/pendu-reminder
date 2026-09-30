/* Pendu product page: download links, the visitor's OS, the hero animation
 * and the live board. */
(function () {
  "use strict";

  // Where the releases live. The release workflow (.github/workflows/release.yml)
  // uploads files with these exact names to every release.
  const REPO = "jaisudhakar/pendu-reminder";
  const GITHUB = `https://github.com/${REPO}`;
  const latest = (asset) => `${GITHUB}/releases/latest/download/${asset}`;

  const OS_NAMES = { windows: "Windows", mac: "macOS", linux: "Linux" };

  function detectOS() {
    const ua = navigator.userAgent || "";
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/android|iphone|ipad|ipod/i.test(ua)) return null;   // phones and tablets can't run it
    if (/win/i.test(platform) || /windows/i.test(ua)) return "windows";
    if (/mac/i.test(platform) || /mac os/i.test(ua)) {
      // iPads also report "MacIntel", but have a touch screen.
      return navigator.maxTouchPoints > 1 ? null : "mac";
    }
    if (/linux|x11/i.test(platform + ua)) return "linux";
    return null;
  }

  // -- download links -----------------------------------------------------

  document.querySelectorAll("[data-asset]").forEach((a) => {
    a.href = latest(a.dataset.asset);
  });
  document.querySelectorAll(".releases-link").forEach((a) => { a.href = `${GITHUB}/releases`; });
  document.querySelectorAll(".repo-link").forEach((a) => { a.href = GITHUB; });
  document.querySelectorAll(".issues-link").forEach((a) => { a.href = `${GITHUB}/issues`; });
  document.querySelectorAll(".repo-url").forEach((el) => { el.textContent = GITHUB; });

  const os = detectOS();
  if (os) {
    const card = document.querySelector(`.dl-card[data-os="${os}"]`);
    const link = card && card.querySelector("[data-asset]");
    if (link) {
      card.classList.add("yours");
      const primary = document.getElementById("primary-download");
      primary.href = link.href;
      primary.textContent = `Download for ${OS_NAMES[os]}`;
      document.getElementById("primary-meta").innerHTML =
        'Free · No account · <a href="#download">Other platforms</a>';
    }
  }

  // -- hero board -----------------------------------------------------------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const now = new Date();
  document.getElementById("mini-date").textContent =
    `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const board = document.querySelector(".mini-window");
  const notes = Array.from(document.querySelectorAll(".mini-note"));
  const progress = document.querySelector(".mini-progress");
  const setDone = (n) => progress.style.setProperty("--done", `${(n / notes.length) * 100}%`);

  if (reduced) {
    notes[3].classList.add("done");
    setDone(1);
  } else {
    board.classList.add("animated");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // Notes fly on one by one, two get ticked off, then the board starts over.
    (async function loop() {
      for (;;) {
        for (const note of notes) {
          await wait(650);
          note.classList.add("in");
        }
        await wait(1400);
        notes[3].classList.add("done"); setDone(1);
        await wait(1100);
        notes[0].classList.add("done"); setDone(2);
        await wait(3400);
        notes.forEach((n) => n.classList.remove("in", "done"));
        setDone(0);
        await wait(400);
      }
    })();
  }

  // -- live board -------------------------------------------------------------

  // Loaded on request, so visiting the page doesn't touch browser storage.
  document.getElementById("load-board").addEventListener("click", () => {
    const frame = document.createElement("iframe");
    frame.src = "app/";
    frame.title = "Pendu board";
    const body = document.getElementById("app-frame-body");
    body.replaceChildren(frame);
    frame.focus();
  });
})();
