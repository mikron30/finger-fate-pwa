(() => {
  "use strict";

  const MODE_DEFS = {
    time: { label: "לפי השעה", icon: "◷", help: "מחזור קבוע של 6 שעות" },
    first: { label: "הראשון שמניח", icon: "①", help: "האצבע הראשונה שנגעה" },
    last: { label: "האחרון שמניח", icon: "⑥", help: "האצבע האחרונה שנגעה" },
    rightmost: { label: "הימנית ביותר", icon: "→", help: "האצבע הקרובה לצד ימין" },
    leftmost: { label: "השמאלית ביותר", icon: "←", help: "האצבע הקרובה לצד שמאל" },
    topmost: { label: "העליונה ביותר", icon: "↑", help: "האצבע הקרובה לחלק העליון" },
    bottommost: { label: "התחתונה ביותר", icon: "↓", help: "האצבע הקרובה לחלק התחתון" },
    topRight: { label: "ימין־למעלה", icon: "↗", help: "הקרובה לפינה הימנית העליונה" },
    topLeft: { label: "שמאל־למעלה", icon: "↖", help: "הקרובה לפינה השמאלית העליונה" },
    bottomRight: { label: "ימין־למטה", icon: "↘", help: "הקרובה לפינה הימנית התחתונה" },
    bottomLeft: { label: "שמאל־למטה", icon: "↙", help: "הקרובה לפינה השמאלית התחתונה" }
  };

  // 00:00–01:00 first; 01:00–02:00 bottom-right; 02:00–03:00 bottom-left;
  // 03:00–04:00 top-left; 04:00–05:00 top-right; 05:00–06:00 last.
  // The same six-hour cycle repeats four times each day.
  const HOURLY_CYCLE = ["first", "bottomRight", "bottomLeft", "topLeft", "topRight", "last"];
  const DOT_COLORS = ["#22d3ee", "#f472b6", "#f59e0b", "#34d399", "#a78bfa", "#fb7185", "#60a5fa", "#facc15", "#2dd4bf", "#c084fc"];
  const COUNTDOWN_MS = 1900;

  const els = {
    setupScreen: document.querySelector("#setupScreen"),
    gameScreen: document.querySelector("#gameScreen"),
    modeGrid: document.querySelector("#modeGrid"),
    clockText: document.querySelector("#clockText"),
    activeRangeText: document.querySelector("#activeRangeText"),
    activeRuleText: document.querySelector("#activeRuleText"),
    activeRuleIcon: document.querySelector("#activeRuleIcon"),
    scheduleTable: document.querySelector("#scheduleTable"),
    vibrationToggle: document.querySelector("#vibrationToggle"),
    soundToggle: document.querySelector("#soundToggle"),
    startButton: document.querySelector("#startButton"),
    installButton: document.querySelector("#installButton"),
    backButton: document.querySelector("#backButton"),
    resetButton: document.querySelector("#resetButton"),
    nextRoundButton: document.querySelector("#nextRoundButton"),
    gameModeText: document.querySelector("#gameModeText"),
    touchSurface: document.querySelector("#touchSurface"),
    instruction: document.querySelector("#instruction"),
    countdown: document.querySelector("#countdown"),
    countdownProgress: document.querySelector("#countdownProgress"),
    touchCount: document.querySelector("#touchCount"),
    touchLayer: document.querySelector("#touchLayer"),
    winnerOverlay: document.querySelector("#winnerOverlay"),
    winnerRuleText: document.querySelector("#winnerRuleText"),
    winnerGlow: document.querySelector("#winnerGlow"),
    confetti: document.querySelector("#confetti")
  };

  const state = {
    selectedMode: localStorage.getItem("fingerFateMode") || "time",
    vibration: localStorage.getItem("fingerFateVibration") !== "false",
    sound: localStorage.getItem("fingerFateSound") !== "false",
    touches: new Map(),
    orderCounter: 0,
    roundLocked: false,
    countdownStartedAt: 0,
    countdownFrame: 0,
    deferredInstallPrompt: null,
    audioContext: null
  };

  function getHourMode(date = new Date()) {
    return HOURLY_CYCLE[date.getHours() % HOURLY_CYCLE.length];
  }

  function getEffectiveMode() {
    return state.selectedMode === "time" ? getHourMode() : state.selectedMode;
  }

  function hourRange(hour) {
    const start = String(hour).padStart(2, "0");
    const end = String((hour + 1) % 24).padStart(2, "0");
    return `${start}:00–${end}:00`;
  }

  function renderModeGrid() {
    els.modeGrid.innerHTML = "";
    Object.entries(MODE_DEFS).forEach(([key, def]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `mode-card${state.selectedMode === key ? " selected" : ""}`;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", state.selectedMode === key ? "true" : "false");
      button.dataset.mode = key;
      button.innerHTML = `
        <span class="check">✓</span>
        <span class="mode-icon" aria-hidden="true">${def.icon}</span>
        <b>${def.label}</b>
        <small>${def.help}</small>
      `;
      button.addEventListener("click", () => selectMode(key));
      els.modeGrid.appendChild(button);
    });
  }

  function selectMode(mode) {
    if (!MODE_DEFS[mode]) return;
    state.selectedMode = mode;
    localStorage.setItem("fingerFateMode", mode);
    renderModeGrid();
    updateClockCard();
  }

  function updateClockCard() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const activeMode = getHourMode(now);
    els.clockText.textContent = `${hh}:${mm}`;
    els.activeRangeText.textContent = hourRange(now.getHours());
    els.activeRuleText.textContent = MODE_DEFS[activeMode].label;
    els.activeRuleIcon.textContent = MODE_DEFS[activeMode].icon;

    document.querySelectorAll(".schedule-row").forEach((row) => {
      row.classList.toggle("current", Number(row.dataset.hour) === now.getHours());
    });
  }

  function renderSchedule() {
    els.scheduleTable.innerHTML = "";
    for (let hour = 0; hour < 24; hour += 1) {
      const mode = HOURLY_CYCLE[hour % 6];
      const row = document.createElement("div");
      row.className = "schedule-row";
      row.dataset.hour = String(hour);
      row.innerHTML = `<time>${hourRange(hour)}</time><span>${MODE_DEFS[mode].icon} ${MODE_DEFS[mode].label}</span>`;
      els.scheduleTable.appendChild(row);
    }
  }

  function startGame() {
    resetRound();
    els.setupScreen.classList.add("hidden");
    els.gameScreen.classList.remove("hidden");
    const effective = getEffectiveMode();
    els.gameModeText.textContent = state.selectedMode === "time"
      ? `לפי השעה — ${MODE_DEFS[effective].label}`
      : MODE_DEFS[effective].label;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function exitGame() {
    resetRound();
    els.gameScreen.classList.add("hidden");
    els.setupScreen.classList.remove("hidden");
    document.exitFullscreen?.().catch(() => {});
    updateClockCard();
  }

  function resetRound() {
    cancelAnimationFrame(state.countdownFrame);
    state.touches.clear();
    state.orderCounter = 0;
    state.roundLocked = false;
    state.countdownStartedAt = 0;
    els.touchLayer.innerHTML = "";
    els.confetti.innerHTML = "";
    els.winnerOverlay.classList.add("hidden");
    els.countdown.classList.add("hidden");
    els.instruction.classList.remove("faded");
    els.countdownProgress.style.strokeDashoffset = "0";
    const effective = getEffectiveMode();
    els.gameModeText.textContent = state.selectedMode === "time"
      ? `לפי השעה — ${MODE_DEFS[effective].label}`
      : MODE_DEFS[effective].label;
  }

  function onPointerDown(event) {
    if (state.roundLocked || event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    els.touchSurface.setPointerCapture?.(event.pointerId);

    const touch = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      order: ++state.orderCounter,
      color: DOT_COLORS[(state.orderCounter - 1) % DOT_COLORS.length],
      element: null
    };
    touch.element = createTouchDot(touch);
    state.touches.set(event.pointerId, touch);
    updateTouchUi();
    restartCountdown();
  }

  function onPointerMove(event) {
    const touch = state.touches.get(event.pointerId);
    if (!touch || state.roundLocked) return;
    event.preventDefault();
    touch.x = event.clientX;
    touch.y = event.clientY;
    positionTouchDot(touch);
  }

  function onPointerUp(event) {
    const touch = state.touches.get(event.pointerId);
    if (!touch || state.roundLocked) return;
    event.preventDefault();
    touch.element?.remove();
    state.touches.delete(event.pointerId);
    updateTouchUi();
    if (state.touches.size === 0) {
      cancelAnimationFrame(state.countdownFrame);
      state.countdownStartedAt = 0;
      els.countdown.classList.add("hidden");
      els.instruction.classList.remove("faded");
    } else {
      restartCountdown();
    }
  }

  function createTouchDot(touch) {
    const dot = document.createElement("div");
    dot.className = "touch-dot";
    dot.style.setProperty("--dot-color", touch.color);
    dot.innerHTML = `<span class="order">${touch.order}</span>`;
    els.touchLayer.appendChild(dot);
    positionTouchDot({ ...touch, element: dot });
    requestAnimationFrame(() => dot.classList.add("visible"));
    return dot;
  }

  function positionTouchDot(touch) {
    if (!touch.element) return;
    touch.element.style.left = `${touch.x}px`;
    touch.element.style.top = `${touch.y}px`;
  }

  function updateTouchUi() {
    els.touchCount.textContent = String(state.touches.size);
    els.instruction.classList.toggle("faded", state.touches.size > 0);
    els.countdown.classList.toggle("hidden", state.touches.size === 0);
  }

  function restartCountdown() {
    cancelAnimationFrame(state.countdownFrame);
    state.countdownStartedAt = performance.now();
    els.countdownProgress.style.strokeDashoffset = "0";
    animateCountdown();
  }

  function animateCountdown(now = performance.now()) {
    if (state.roundLocked || state.touches.size === 0) return;
    const elapsed = now - state.countdownStartedAt;
    const progress = Math.min(1, elapsed / COUNTDOWN_MS);
    els.countdownProgress.style.strokeDashoffset = String(327 * progress);
    if (progress >= 1) {
      chooseWinner();
      return;
    }
    state.countdownFrame = requestAnimationFrame(animateCountdown);
  }

  function chooseWinner() {
    if (state.roundLocked || state.touches.size === 0) return;
    state.roundLocked = true;
    const mode = getEffectiveMode();
    const candidates = [...state.touches.values()];
    const winner = pickWinner(candidates, mode);
    if (!winner) return;

    candidates.forEach((candidate) => {
      if (candidate.id !== winner.id) candidate.element.style.opacity = ".18";
    });
    winner.element.classList.add("winner");
    els.countdown.classList.add("hidden");
    els.winnerRuleText.textContent = MODE_DEFS[mode].label;
    els.winnerGlow.style.background = `radial-gradient(circle at ${winner.x}px ${winner.y}px, ${winner.color}55, transparent 42%)`;
    els.winnerOverlay.classList.remove("hidden");
    makeConfetti(winner.color);
    playWinFeedback();
  }

  function pickWinner(candidates, mode) {
    const reduceBy = (score) => candidates.reduce((best, item) => score(item) < score(best) ? item : best);
    switch (mode) {
      case "first": return reduceBy((t) => t.order);
      case "last": return reduceBy((t) => -t.order);
      case "rightmost": return reduceBy((t) => -t.x);
      case "leftmost": return reduceBy((t) => t.x);
      case "topmost": return reduceBy((t) => t.y);
      case "bottommost": return reduceBy((t) => -t.y);
      case "topRight": return reduceBy((t) => distance(t.x, t.y, window.innerWidth, 0));
      case "topLeft": return reduceBy((t) => distance(t.x, t.y, 0, 0));
      case "bottomRight": return reduceBy((t) => distance(t.x, t.y, window.innerWidth, window.innerHeight));
      case "bottomLeft": return reduceBy((t) => distance(t.x, t.y, 0, window.innerHeight));
      default: return candidates[0];
    }
  }

  function distance(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  function makeConfetti(primaryColor) {
    const colors = [primaryColor, "#22d3ee", "#f472b6", "#facc15", "#a78bfa", "#34d399"];
    els.confetti.innerHTML = "";
    for (let i = 0; i < 34; i += 1) {
      const piece = document.createElement("i");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * .35}s`;
      piece.style.animationDuration = `${1.25 + Math.random() * 1.1}s`;
      piece.style.setProperty("--drift", `${-90 + Math.random() * 180}px`);
      els.confetti.appendChild(piece);
    }
  }

  function playWinFeedback() {
    if (state.vibration && navigator.vibrate) navigator.vibrate([80, 55, 170]);
    if (!state.sound) return;
    try {
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = state.audioContext;
      const start = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + index * .11);
        gain.gain.exponentialRampToValueAtTime(.18, start + index * .11 + .02);
        gain.gain.exponentialRampToValueAtTime(.0001, start + index * .11 + .24);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(start + index * .11);
        oscillator.stop(start + index * .11 + .26);
      });
    } catch (_) {
      // Sound is optional; ignore unsupported browsers.
    }
  }

  function bindEvents() {
    els.startButton.addEventListener("click", startGame);
    els.backButton.addEventListener("click", exitGame);
    els.resetButton.addEventListener("click", resetRound);
    els.nextRoundButton.addEventListener("click", resetRound);

    els.touchSurface.addEventListener("pointerdown", onPointerDown, { passive: false });
    els.touchSurface.addEventListener("pointermove", onPointerMove, { passive: false });
    els.touchSurface.addEventListener("pointerup", onPointerUp, { passive: false });
    els.touchSurface.addEventListener("pointercancel", onPointerUp, { passive: false });
    els.touchSurface.addEventListener("contextmenu", (event) => event.preventDefault());

    els.vibrationToggle.checked = state.vibration;
    els.soundToggle.checked = state.sound;
    els.vibrationToggle.addEventListener("change", () => {
      state.vibration = els.vibrationToggle.checked;
      localStorage.setItem("fingerFateVibration", String(state.vibration));
    });
    els.soundToggle.addEventListener("change", () => {
      state.sound = els.soundToggle.checked;
      localStorage.setItem("fingerFateSound", String(state.sound));
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      els.installButton.classList.remove("hidden");
    });
    els.installButton.addEventListener("click", async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      els.installButton.classList.add("hidden");
    });
    window.addEventListener("appinstalled", () => els.installButton.classList.add("hidden"));
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    }
  }

  renderModeGrid();
  renderSchedule();
  updateClockCard();
  bindEvents();
  registerServiceWorker();
  setInterval(updateClockCard, 15_000);
})();
