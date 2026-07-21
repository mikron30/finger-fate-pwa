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

  const HOURLY_CYCLE = ["first", "bottomRight", "bottomLeft", "topLeft", "topRight", "last"];
  const DOT_COLORS = [
    "#2fb9c9",
    "#ed31b7",
    "#84c835",
    "#ffbd24",
    "#8365e8",
    "#2dcf99",
    "#f65b68",
    "#4d96ff",
    "#f58220",
    "#b765e8"
  ];

  const MIN_TOUCHES = 2;
  const WIN_DELAY_MS = 2550;
  const LOSER_SHRINK_MS = 330;
  const SETTINGS_HOLD_MS = 5000;
  const RESET_AFTER_RELEASE_MS = 520;
  const RESET_FADE_MS = 280;

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
    settingsHintButton: document.querySelector("#settingsHintButton"),
    helpButton: document.querySelector("#helpButton"),
    touchSurface: document.querySelector("#touchSurface"),
    startMessage: document.querySelector("#startMessage"),
    touchLayer: document.querySelector("#touchLayer"),
    winnerFill: document.querySelector("#winnerFill"),
    winnerMarker: document.querySelector("#winnerMarker")
  };

  const state = {
    selectedMode: localStorage.getItem("fingerFateMode") || "time",
    vibration: localStorage.getItem("fingerFateVibration") !== "false",
    sound: localStorage.getItem("fingerFateSound") !== "false",
    touches: new Map(),
    orderCounter: 0,
    roundLocked: false,
    roundHadMultipleTouches: false,
    winnerPointerId: null,
    winnerTimer: 0,
    revealTimer: 0,
    settingsHoldTimer: 0,
    resetTimer: 0,
    messageTimer: 0,
    deferredInstallPrompt: null,
    audioContext: null,
    reloadingForWorker: false
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
      const mode = HOURLY_CYCLE[hour % HOURLY_CYCLE.length];
      const row = document.createElement("div");
      row.className = "schedule-row";
      row.dataset.hour = String(hour);
      row.innerHTML = `<time>${hourRange(hour)}</time><span>${MODE_DEFS[mode].icon} ${MODE_DEFS[mode].label}</span>`;
      els.scheduleTable.appendChild(row);
    }
  }

  function openSettings() {
    cancelGameTimers();
    clearTouches();
    state.roundLocked = false;
    state.roundHadMultipleTouches = false;
    state.winnerPointerId = null;
    hideWinnerImmediately();
    els.gameScreen.classList.add("hidden");
    els.setupScreen.classList.remove("hidden");
    updateClockCard();
    document.exitFullscreen?.().catch(() => {});
  }

  function returnToGame() {
    els.setupScreen.classList.add("hidden");
    els.gameScreen.classList.remove("hidden");
    resetRound(true);
  }

  function resetRound(showInitialMessage = true) {
    cancelGameTimers();
    clearTouches();
    state.orderCounter = 0;
    state.roundLocked = false;
    state.roundHadMultipleTouches = false;
    state.winnerPointerId = null;
    els.gameScreen.classList.remove("playing");
    hideWinnerImmediately();
    if (showInitialMessage) showMessage("הניחו לפחות 2 אצבעות על המסך");
  }

  function cancelGameTimers() {
    window.clearTimeout(state.winnerTimer);
    window.clearTimeout(state.revealTimer);
    window.clearTimeout(state.settingsHoldTimer);
    window.clearTimeout(state.resetTimer);
    state.winnerTimer = 0;
    state.revealTimer = 0;
    state.settingsHoldTimer = 0;
    state.resetTimer = 0;
  }

  function clearTouches() {
    state.touches.forEach((touch) => touch.element?.remove());
    state.touches.clear();
    els.touchLayer.innerHTML = "";
  }

  function onPointerDown(event) {
    if (state.roundLocked || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    els.touchSurface.setPointerCapture?.(event.pointerId);
    window.clearTimeout(state.resetTimer);

    if (state.touches.has(event.pointerId)) return;

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
    els.gameScreen.classList.add("playing");
    hideMessage();
    updateRoundTimersAfterTouchChange();
  }

  function onPointerMove(event) {
    const touch = state.touches.get(event.pointerId);
    if (!touch) return;
    event.preventDefault();
    touch.x = event.clientX;
    touch.y = event.clientY;
    positionTouchDot(touch);

    if (state.roundLocked && event.pointerId === state.winnerPointerId) {
      updateWinnerPosition(touch);
    }
  }

  function onPointerUp(event) {
    const touch = state.touches.get(event.pointerId);
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();

    touch.element?.remove();
    state.touches.delete(event.pointerId);

    if (state.roundLocked) {
      if (state.touches.size === 0) scheduleWinnerReset();
      return;
    }

    updateRoundTimersAfterTouchChange();
  }

  function updateRoundTimersAfterTouchChange() {
    window.clearTimeout(state.winnerTimer);
    window.clearTimeout(state.settingsHoldTimer);
    state.winnerTimer = 0;
    state.settingsHoldTimer = 0;

    const count = state.touches.size;

    if (count === 0) {
      state.orderCounter = 0;
      state.roundHadMultipleTouches = false;
      els.gameScreen.classList.remove("playing");
      showMessage("הניחו לפחות 2 אצבעות על המסך");
      return;
    }

    if (count === 1) {
      stopTouchProgress();
      if (!state.roundHadMultipleTouches) {
        state.settingsHoldTimer = window.setTimeout(() => {
          if (!state.roundLocked && state.touches.size === 1 && !state.roundHadMultipleTouches) {
            openSettings();
          }
        }, SETTINGS_HOLD_MS);
      }
      return;
    }

    state.roundHadMultipleTouches = true;
    hideMessage();
    restartTouchProgress();
    state.winnerTimer = window.setTimeout(chooseWinner, WIN_DELAY_MS);
  }

  function createTouchDot(touch) {
    const dot = document.createElement("div");
    dot.className = "touch-dot";
    dot.style.setProperty("--dot-color", touch.color);
    dot.style.setProperty("--round-duration", `${WIN_DELAY_MS}ms`);
    dot.innerHTML = `
      <svg class="touch-progress" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="touch-progress-track" cx="60" cy="60" r="51"></circle>
        <circle class="touch-progress-value" cx="60" cy="60" r="51"></circle>
      </svg>
      <span class="touch-core"><span class="touch-center"></span></span>
    `;
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

  function restartTouchProgress() {
    state.touches.forEach((touch) => {
      const dot = touch.element;
      if (!dot) return;
      dot.classList.remove("counting", "is-loser", "is-winner");
      void dot.offsetWidth;
      dot.classList.add("counting");
    });
  }

  function stopTouchProgress() {
    state.touches.forEach((touch) => touch.element?.classList.remove("counting"));
  }

  function chooseWinner() {
    if (state.roundLocked || state.touches.size < MIN_TOUCHES) return;

    const candidates = [...state.touches.values()];
    const winner = pickWinner(candidates, getEffectiveMode());
    if (!winner) return;

    state.roundLocked = true;
    state.winnerPointerId = winner.id;
    window.clearTimeout(state.settingsHoldTimer);
    window.clearTimeout(state.winnerTimer);
    hideMessage();

    candidates.forEach((candidate) => {
      candidate.element?.classList.remove("counting");
      candidate.element?.classList.add(candidate.id === winner.id ? "is-winner" : "is-loser");
    });

    playSelectionTick();
    state.revealTimer = window.setTimeout(() => revealWinner(winner), LOSER_SHRINK_MS);
  }

  function revealWinner(winner) {
    updateWinnerPosition(winner);
    const radius = farthestCornerDistance(winner.x, winner.y) + 80;
    els.winnerFill.style.setProperty("--winner-color", winner.color);
    els.winnerFill.style.setProperty("--winner-radius", `${radius}px`);
    els.winnerFill.classList.remove("hidden", "depart", "reveal");
    void els.winnerFill.offsetWidth;
    els.winnerFill.classList.add("reveal");
    playWinFeedback();
  }

  function updateWinnerPosition(touch) {
    els.winnerFill.style.setProperty("--winner-x", `${touch.x}px`);
    els.winnerFill.style.setProperty("--winner-y", `${touch.y}px`);
  }

  function farthestCornerDistance(x, y) {
    return Math.max(
      distance(x, y, 0, 0),
      distance(x, y, window.innerWidth, 0),
      distance(x, y, 0, window.innerHeight),
      distance(x, y, window.innerWidth, window.innerHeight)
    );
  }

  function scheduleWinnerReset() {
    window.clearTimeout(state.resetTimer);
    state.resetTimer = window.setTimeout(() => {
      els.winnerFill.classList.add("depart");
      window.setTimeout(() => resetRound(true), RESET_FADE_MS);
    }, RESET_AFTER_RELEASE_MS);
  }

  function hideWinnerImmediately() {
    els.winnerFill.classList.add("hidden");
    els.winnerFill.classList.remove("reveal", "depart");
    els.winnerFill.style.removeProperty("--winner-color");
    els.winnerFill.style.removeProperty("--winner-radius");
    els.winnerFill.style.removeProperty("--winner-x");
    els.winnerFill.style.removeProperty("--winner-y");
  }

  function pickWinner(candidates, mode) {
    const reduceBy = (score) => candidates.reduce((best, item) => score(item) < score(best) ? item : best);
    switch (mode) {
      case "first": return reduceBy((touch) => touch.order);
      case "last": return reduceBy((touch) => -touch.order);
      case "rightmost": return reduceBy((touch) => -touch.x);
      case "leftmost": return reduceBy((touch) => touch.x);
      case "topmost": return reduceBy((touch) => touch.y);
      case "bottommost": return reduceBy((touch) => -touch.y);
      case "topRight": return reduceBy((touch) => distance(touch.x, touch.y, window.innerWidth, 0));
      case "topLeft": return reduceBy((touch) => distance(touch.x, touch.y, 0, 0));
      case "bottomRight": return reduceBy((touch) => distance(touch.x, touch.y, window.innerWidth, window.innerHeight));
      case "bottomLeft": return reduceBy((touch) => distance(touch.x, touch.y, 0, window.innerHeight));
      default: return candidates[0];
    }
  }

  function distance(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  function showMessage(text, duration = 0) {
    window.clearTimeout(state.messageTimer);
    els.startMessage.textContent = text;
    els.startMessage.classList.remove("hidden", "hidden-message");
    if (duration > 0) {
      state.messageTimer = window.setTimeout(hideMessage, duration);
    }
  }

  function hideMessage() {
    window.clearTimeout(state.messageTimer);
    els.startMessage.classList.add("hidden-message");
  }

  function getAudioContext() {
    state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioContext.state === "suspended") state.audioContext.resume().catch(() => {});
    return state.audioContext;
  }

  function playSelectionTick() {
    if (!state.sound) return;
    try {
      const context = getAudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(620, now);
      oscillator.frequency.exponentialRampToValueAtTime(780, now + 0.13);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.18);
    } catch (_) {
      // הצליל אופציונלי.
    }
  }

  function playWinFeedback() {
    if (state.vibration && navigator.vibrate) navigator.vibrate([65, 45, 140]);
    if (!state.sound) return;

    try {
      const context = getAudioContext();
      const start = context.currentTime;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + index * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.13, start + index * 0.09 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.09 + 0.22);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start + index * 0.09);
        oscillator.stop(start + index * 0.09 + 0.24);
      });
    } catch (_) {
      // הצליל אופציונלי.
    }
  }

  function bindEvents() {
    els.startButton.addEventListener("click", returnToGame);

    els.settingsHintButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showMessage("להגדרות: החזק אצבע אחת בלבד במשך 5 שניות", 2300);
    });

    els.helpButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showMessage("הניחו 2 אצבעות או יותר והשאירו אותן עד לבחירה", 2300);
    });

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
    window.addEventListener("blur", () => {
      if (!els.gameScreen.classList.contains("hidden")) resetRound(true);
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("./sw.js");
        registration.update();
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (state.reloadingForWorker) return;
          state.reloadingForWorker = true;
          window.location.reload();
        });
      } catch (_) {
        // האפליקציה עדיין פועלת גם ללא Service Worker.
      }
    });
  }

  renderModeGrid();
  renderSchedule();
  updateClockCard();
  bindEvents();
  registerServiceWorker();
  resetRound(true);
  window.setInterval(updateClockCard, 15_000);
})();
