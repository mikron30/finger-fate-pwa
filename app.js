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

  // המחזור חוזר ארבע פעמים ביממה:
  // ראשון, ימין-למטה, שמאל-למטה, שמאל-למעלה, ימין-למעלה, אחרון.
  const HOURLY_CYCLE = ["first", "bottomRight", "bottomLeft", "topLeft", "topRight", "last"];
  const DOT_COLORS = ["#7ecb20", "#ff007f", "#00b8f0", "#ffb000", "#9b5de5", "#00c49a", "#f45b69", "#4d96ff", "#ffd60a", "#c77dff"];
  const MIN_TOUCHES = 2;
  const WIN_DELAY_MS = 1900;
  const SETTINGS_HOLD_MS = 5000;
  const RESET_AFTER_RELEASE_MS = 550;

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
    winnerFill: document.querySelector("#winnerFill")
  };

  const state = {
    selectedMode: localStorage.getItem("fingerFateMode") || "time",
    vibration: localStorage.getItem("fingerFateVibration") !== "false",
    sound: localStorage.getItem("fingerFateSound") !== "false",
    touches: new Map(),
    orderCounter: 0,
    roundLocked: false,
    roundHadMultipleTouches: false,
    winnerTimer: 0,
    settingsHoldTimer: 0,
    resetTimer: 0,
    messageTimer: 0,
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
    els.winnerFill.classList.add("hidden");
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
    els.winnerFill.classList.add("hidden");
    els.winnerFill.style.background = "";
    if (showInitialMessage) {
      showMessage("הניחו לפחות 2 אצבעות על המסך");
    }
  }

  function cancelGameTimers() {
    window.clearTimeout(state.winnerTimer);
    window.clearTimeout(state.settingsHoldTimer);
    window.clearTimeout(state.resetTimer);
    state.winnerTimer = 0;
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
    hideMessage();
    updateRoundTimersAfterTouchChange();
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
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();

    touch.element?.remove();
    state.touches.delete(event.pointerId);

    if (state.roundLocked) {
      if (state.touches.size === 0) {
        state.resetTimer = window.setTimeout(() => resetRound(true), RESET_AFTER_RELEASE_MS);
      }
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
      showMessage("הניחו לפחות 2 אצבעות על המסך");
      return;
    }

    if (count === 1) {
      if (!state.roundHadMultipleTouches) {
        state.settingsHoldTimer = window.setTimeout(() => {
          if (!state.roundLocked && state.touches.size === 1 && !state.roundHadMultipleTouches) {
            openSettings();
          }
        }, SETTINGS_HOLD_MS);
      } else {
        showMessage("נדרשות לפחות 2 אצבעות", 1200);
      }
      return;
    }

    state.roundHadMultipleTouches = true;
    hideMessage();
    state.winnerTimer = window.setTimeout(chooseWinner, WIN_DELAY_MS);
  }

  function createTouchDot(touch) {
    const dot = document.createElement("div");
    dot.className = "touch-dot";
    dot.style.setProperty("--dot-color", touch.color);
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

  function chooseWinner() {
    if (state.roundLocked || state.touches.size < MIN_TOUCHES) return;

    const mode = getEffectiveMode();
    const candidates = [...state.touches.values()];
    const winner = pickWinner(candidates, mode);
    if (!winner) return;

    state.roundLocked = true;
    window.clearTimeout(state.settingsHoldTimer);
    window.clearTimeout(state.winnerTimer);
    hideMessage();

    els.winnerFill.style.background = winner.color;
    els.winnerFill.classList.remove("hidden");
    playWinFeedback();
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
    els.startMessage.classList.remove("hidden");
    if (duration > 0) {
      state.messageTimer = window.setTimeout(hideMessage, duration);
    }
  }

  function hideMessage() {
    window.clearTimeout(state.messageTimer);
    els.startMessage.classList.add("hidden");
  }

  function playWinFeedback() {
    if (state.vibration && navigator.vibrate) navigator.vibrate([80, 55, 170]);
    if (!state.sound) return;

    try {
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const context = state.audioContext;
      const start = context.currentTime;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + index * 0.11);
        gain.gain.exponentialRampToValueAtTime(0.18, start + index * 0.11 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.11 + 0.24);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start + index * 0.11);
        oscillator.stop(start + index * 0.11 + 0.26);
      });
    } catch (_) {
      // הצליל אופציונלי; דפדפנים שאינם תומכים פשוט ממשיכים בלי צליל.
    }
  }

  function bindEvents() {
    els.startButton.addEventListener("click", returnToGame);

    // לחיצה רגילה אינה פותחת את ההגדרות, כדי שהן יישארו נסתרות.
    els.settingsHintButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showMessage("להגדרות: החזק אצבע אחת על המסך 5 שניות", 2200);
    });

    els.helpButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showMessage("הניחו 2 אצבעות או יותר והשאירו אותן על המסך", 2200);
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
