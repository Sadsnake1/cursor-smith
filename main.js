const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  enabled: true,
  cursorStyle: "Box", // "Line" | "Box" | "Underline"

  // --- appearance color controls ---
  colorDark: "#39ff14", 
  colorLight: "#333333",

  // --- CRT effect (trail + glow) ---
  crtEffect: false,
  glow: true, 

  // --- torch spotlight effect (can run alongside any cursor style) ---
  torchEffect: false,
  overlaySpareSidebars: true,
  overlayFollowMode: "caret", // caret | mouse | auto
  overlayRadius: 250,
  overlayDarkness: 0.7,
  overlayIntensity: 0.1,
  overlayColor: "#ff963c",
  overlayFlicker: false,
  overlaySpeed: 0.22, // lerp factor: how fast the torch chases its target

  // --- global caret properties ---
  caretWidthPx: 2,         
  popLetters: true,        
  flameTrail: true,        
  cursorOpacity: 1,
  energyEffect: false,
  energySpeed: 1,

  // --- shared canvas engine settings ---
  trailLength: 10, 
  trailFadeMs: 450, 
  blinkingEnabled: true,
  blinkSpeed: 1.2,       
  blinkOnOffBalance: 0.5,
  hideNativeCaret: true, 
  showChar: true, 
  moveDelayMs: 0,        
  smear: true,           
  smearStiffness: 0.6,
  smearTrailingStiffness: 0.4,
  smearDamping: 0.8,

  // --- smooth cursor global category ---
  smoothEnabled: false,
  smoothStopBlinking: true, 
  smoothness: 0.15,          // 5-30% range (0.05 - 0.30)
  catchUpSpeed: 0.55,        // 30-80% range (0.30 - 0.80)
  maxCatchUpSpeed: 0.85,     // 50-100% range (0.50 - 1.00)
  smoothAdaptive: true,      // Adaptive speed toggle
};

function hexToRgba(hex, alpha) {
  let h = (hex || "#39ff14").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const int = parseInt(h, 16) || 0;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex) {
  let h = (hex || "#ff963c").replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const n = parseInt(h, 16) || 0;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function hexToRgbTuple(hex) {
  let h = (hex || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = parseInt(h, 16) || 0;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function invertColor(colorStr) {
  const nums = (colorStr || "").match(/[\d.]+/g);
  if (!nums || nums.length < 3) return "#000000";
  const [r, g, b] = nums.map(Number);
  return `rgb(${255 - r}, ${255 - g}, ${255 - b})`;
}

function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

function blinkAlphaAt(nowMs, speed, onOffBalance = 0.5) {
  if (speed <= 0) return 1;
  const period = 2500 / speed; 
  const phase = (nowMs % period) / period; 
  const fade = 0.15; 
  const balance = Math.max(0.1, Math.min(0.9, onOffBalance));
  const hold = 1 - fade * 2; 
  const onHold = hold * balance;
  const offHold = hold * (1 - balance);
  const p1 = onHold;
  const p2 = p1 + fade;
  const p3 = p2 + offHold;
  let a;
  if (phase < p1) a = 1;
  else if (phase < p2) a = 1 - easeInOutSine((phase - p1) / fade);
  else if (phase < p3) a = 0;
  else a = easeInOutSine((phase - p3) / fade);
  return a;
}

module.exports = class CursorSmithPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    // Dynamic Multi-Window Tracking Engine
    this._cleanups = [];
    this.registeredDocuments = new Set();

    // Engine Core States
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this.trail = []; 
    this.particles = []; 
    this.flamePixels = [];
    this.lastActive = null; 
    this.pending = null; 
    this.smearQuad = null;
    this.smearCenterPrev = null;
    this.smearQuadLastT = 0;

    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;

    this.overlay = null;
    this.modalObserver = null;
    this.modalOpen = false;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;
    this.lastCaret = null;
    this.lastCaretMove = 0;
    this.mouseX = this.x;
    this.mouseY = this.y;
    this.lastMouseMove = 0;
    
    this.canvasEngineActive = false;
    this.torchEngineActive = false;
    this.canvasRaf = 0;
    this.torchRaf = 0;

    this.addCommand({
      id: "toggle-cursor-smith",
      name: "Toggle custom cursor",
      callback: () => this.toggle(),
    });

    this.addSettingTab(new CursorSmithSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enabled) this.enable();
    });
  }

  onunload() {
    this.disable();
    if (this._cleanups) {
      for (const cleanup of this._cleanups) cleanup();
      this._cleanups = [];
    }
  }

  injectStyles(doc) {
    const id = "cursor-smith-dynamic-styles";
    if (doc.getElementById(id)) return;
    
    const styleEl = doc.createElement("style");
    styleEl.id = id;
    styleEl.textContent = `
      .retro-box-cursor-canvas {
        pointer-events: none;
      }
      .retro-box-cursor-hide-native .cm-cursorLayer {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        animation: none !important;
      }
      .torch-cursor-overlay {
        position: fixed;
        pointer-events: none;
        z-index: 9990;
        background: radial-gradient(
          circle var(--torch-radius, 250px) at var(--torch-x, 50%) var(--torch-y, 50%),
          rgba(var(--torch-warm, 255, 150, 60), var(--torch-intensity, 0.1)) 0%,
          rgba(0, 0, 0, var(--torch-darkness, 0.7)) 100%
        );
        mix-blend-mode: multiply;
        opacity: 1;
        transition: opacity 0.2s ease;
      }
      .torch-cursor-overlay.torch-cursor-hidden {
        opacity: 0 !important;
        display: none !important;
      }
      @keyframes torch-candle-flicker {
        0% { transform: scale(1); opacity: 0.96; }
        25% { transform: scale(1.02); opacity: 1.02; }
        50% { transform: scale(0.99); opacity: 0.95; }
        75% { transform: scale(1.01); opacity: 1.04; }
        100% { transform: scale(1); opacity: 0.96; }
      }
      .torch-cursor-overlay:not(.torch-no-flicker) {
        animation: torch-candle-flicker 0.2s infinite alternate ease-in-out;
      }
    `;
    doc.head.appendChild(styleEl);
  }

  registerWindowEvents(doc) {
    if (this.registeredDocuments.has(doc)) return;
    this.registeredDocuments.add(doc);
    
    const onMouseMove = (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.lastMouseMove = Date.now();
    };
    const onResize = () => this.resizeCanvas();
    
    doc.addEventListener("mousemove", onMouseMove);
    const win = doc.defaultView;
    if (win) win.addEventListener("resize", onResize);
    
    this._cleanups.push(() => {
      doc.removeEventListener("mousemove", onMouseMove);
      if (win) win.removeEventListener("resize", onResize);
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyBodyClasses();
    this.applyOverlayStyle();
  }

  toggle() {
    const wasActive = !!(this.canvasEngineActive || this.torchEngineActive);
    wasActive ? this.disable() : this.enable();
    this.settings.enabled = !!(this.canvasEngineActive || this.torchEngineActive);
    this.saveSettings();
  }

  getActiveColor() {
    const doc = this.canvas ? this.canvas.ownerDocument : activeDocument;
    const isDark = doc.body.classList.contains("theme-dark");
    return isDark ? this.settings.colorDark : this.settings.colorLight;
  }

  applyBodyClasses() {
    const engineActive = !!(this.canvasEngineActive || this.torchEngineActive);
    const docs = [activeDocument, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.toggle(
          "retro-box-cursor-hide-native",
          !!(engineActive && this.settings.hideNativeCaret)
        );
      }
    }
  }

  applyOverlayStyle() {
    if (!this.overlay) return;
    const s = this.settings;
    const o = this.overlay;
    o.style.setProperty("--torch-radius", s.overlayRadius + "px");
    o.style.setProperty("--torch-darkness", String(s.overlayDarkness));
    o.style.setProperty("--torch-intensity", String(s.overlayIntensity));
    o.style.setProperty("--torch-warm", hexToRgb(s.overlayColor));
    o.classList.toggle("torch-no-flicker", !s.overlayFlicker);
  }

  ensureCanvasForView(view) {
    const targetDoc = view ? view.dom.ownerDocument : activeDocument;
    if (this.canvasWrapper && this.canvasWrapper.ownerDocument !== targetDoc) {
      this.canvasWrapper.remove();
      this.canvasWrapper = null;
      this.canvas = null;
      this.ctx = null;
    }
    if (!this.canvasWrapper) {
      targetDoc.body.classList.add("retro-box-cursor-active");
      
      // The wrapper creates a strict physical bounding box to unblock window dragging
      this.canvasWrapper = targetDoc.createElement("div");
      this.canvasWrapper.style.position = "fixed";
      this.canvasWrapper.style.overflow = "hidden";
      this.canvasWrapper.style.pointerEvents = "none";
      this.canvasWrapper.style.zIndex = "10000";
      targetDoc.body.appendChild(this.canvasWrapper);

      this.canvas = targetDoc.createElement("canvas");
      this.canvas.className = "retro-box-cursor-canvas";
      this.canvas.style.position = "absolute"; // Force absolute so it obeys the wrapper
      this.canvasWrapper.appendChild(this.canvas);
      
      this.ctx = this.canvas.getContext("2d");
      this.injectStyles(targetDoc);
      this.resizeCanvas();
    }
    if (!targetDoc.body.classList.contains("retro-box-cursor-active")) {
      targetDoc.body.classList.add("retro-box-cursor-active");
    }
    targetDoc.body.classList.toggle("retro-box-cursor-hide-native", !!this.settings.hideNativeCaret);
  }

  ensureTorchOverlayForView(view) {
    if (!this.settings.torchEffect) {
      this.disableTorchOverlay();
      return;
    }
    const targetDoc = view ? view.dom.ownerDocument : activeDocument;
    if (this.overlay && this.overlay.ownerDocument !== targetDoc) {
      this.overlay.remove();
      this.overlay = null;
      this.modalObserver?.disconnect();
      this.modalObserver = null;
    }
    if (!this.overlay) {
      targetDoc.body.classList.add("torch-cursor-active");
      this.overlay = targetDoc.body.createDiv({ cls: "torch-cursor-overlay" });
      this.injectStyles(targetDoc);
      this.applyOverlayStyle();
      
      this.modalOpen = !!targetDoc.querySelector(".modal-container");
      this.modalObserver = new MutationObserver(() => {
        this.modalOpen = !!targetDoc.querySelector(".modal-container");
      });
      this.modalObserver.observe(targetDoc.body, { childList: true });
    }
  }

  enable() {
    this.disable(); 
    this.enableCanvasEngine();
    if (this.settings.torchEffect) this.enableTorchOverlay();
  }

  disable() {
    this.disableCanvasEngine();
    this.disableTorchOverlay();
  }

  disableCanvasEngine() {
    this.canvasEngineActive = false;
    if (this.canvasRaf) {
      cancelAnimationFrame(this.canvasRaf);
      this.canvasRaf = 0;
    }
    const docs = [activeDocument, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("retro-box-cursor-active", "retro-box-cursor-hide-native");
        const canvas = doc.querySelector(".retro-box-cursor-canvas");
        if (canvas) {
          if (canvas.parentElement && canvas.parentElement.style.overflow === "hidden") {
            canvas.parentElement.remove();
          } else {
            canvas.remove();
          }
        }
      }
    }
    this.canvasWrapper = null;
    this.canvas = null;
    this.ctx = null;
    this.pending = null;
    this.smearQuad = null;
    this.smearCenterPrev = null;
    this.smearQuadLastT = 0;
    this.particles = [];
    this.flamePixels = [];
    this.animActive = null;
  }

  disableTorchOverlay() {
    this.torchEngineActive = false;
    if (this.torchRaf) {
      cancelAnimationFrame(this.torchRaf);
      this.torchRaf = 0;
    }
    const docs = [activeDocument, ...Array.from(this.registeredDocuments)];
    for (const doc of docs) {
      if (doc && doc.body) {
        doc.body.classList.remove("torch-cursor-active", "torch-no-flicker");
        doc.querySelector(".torch-cursor-overlay")?.remove();
      }
    }
    this.overlay = null;
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
  }

  enableCanvasEngine() {
    this.canvasEngineActive = true;
    this.trail = [];
    this.particles = [];
    this.flamePixels = [];
    this.lastActive = null;
    this.pending = null;
    this.smearQuad = null;
    this.smearCenterPrev = null;
    this.smearQuadLastT = 0;
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;

    const tick = () => {
      if (!this.canvasEngineActive) return;
      const view = this.app.workspace.activeEditor?.editor?.cm;
      this.ensureCanvasForView(view);
      if (view) this.registerWindowEvents(view.dom.ownerDocument);

      if (this.canvasWrapper && this.canvas) {
        const r = this.getPaneRect(view);
        if (r) {
          this.canvasWrapper.style.top = r.top + "px";
          this.canvasWrapper.style.left = r.left + "px";
          this.canvasWrapper.style.width = r.width + "px";
          this.canvasWrapper.style.height = r.height + "px";
          // Shift the canvas backward so absolute screen coordinates draw perfectly
          this.canvas.style.transform = `translate(-${r.left}px, -${r.top}px)`;
        } else {
          this.canvasWrapper.style.top = "0px";
          this.canvasWrapper.style.left = "0px";
          this.canvasWrapper.style.width = "100vw";
          this.canvasWrapper.style.height = "100vh";
          this.canvas.style.transform = "none";
        }
      }

      this.updateActivePoint();
      this.updateSmoothCursor();
      this.updateSmearQuad();
      this.draw();
      this.canvasRaf = requestAnimationFrame(tick);
    };
    this.canvasRaf = requestAnimationFrame(tick);
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    const dpr = win.devicePixelRatio || 1;
    const w = win.innerWidth;
    const h = win.innerHeight;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  caretCoords() {
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!view) return null;
    try {
      const pos = view.state.selection.main.head;
      const doc = view.dom.ownerDocument;
      const active = doc.activeElement;
      const activeIsEditable =
        !!active && (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT");
      const inTable = !!active?.closest?.("table");

      let c = inTable ? null : (view.coordsAtPos(pos, -1) || view.coordsAtPos(pos, 1));

      if (!c) {
        c = this.selectionFallbackCoords(view);
        if (!c) return null;
      }

      // When the caret's document position is scrolled outside the visible
      // editor pane (e.g. mouse-wheel scrolling without moving the text
      // cursor), CodeMirror can still return a coordinate for it - typically
      // clamped near the top or bottom edge of the rendered content, which
      // lands right on the titlebar or just above the status bar. Treat an
      // out-of-view caret the same as "not focused" rather than drawing a
      // ghost cursor there; this also stops the smear spring from reacting
      // to that spurious jump (which is what caused the wiggle on fast
      // scrolling).
      const paneRect = this.getPaneRect(view);
      if (paneRect) {
        const margin = 1; // avoid flicker right at the pane edge
        const cBottom = c.bottom ?? c.top;
        if (cBottom < paneRect.top - margin || c.top > paneRect.bottom + margin) {
          return null;
        }
      }

      const rawChar = view.state.doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";

      const win = doc.defaultView || window;
      const contentStyle = win.getComputedStyle(view.contentDOM);

      // Find the actual DOM element rendering the character at the caret
      // (not just "the first .cm-line in the document"), so headings,
      // inline code, and any other differently-sized text report their own
      // real font metrics instead of the editor's base font-size/family.
      const sampleX = Math.min(c.left + 2, doc.documentElement.clientWidth - 1);
      const sampleY = (c.top + c.bottom) / 2;
      const elAtCaret = doc.elementFromPoint ? doc.elementFromPoint(sampleX, sampleY) : null;
      const lineEl = (elAtCaret && elAtCaret.closest && elAtCaret.closest(".cm-line")) ||
        view.contentDOM.querySelector(".cm-line");
      const charStyle = elAtCaret && lineEl && lineEl.contains(elAtCaret)
        ? win.getComputedStyle(elAtCaret)
        : (lineEl ? win.getComputedStyle(lineEl) : contentStyle);
      const textColor = charStyle.color || contentStyle.color || "#ffffff";

      // Measure the character's real rendered width directly from its own
      // coordinates rather than CodeMirror's cached defaultCharacterWidth,
      // which reflects only the editor's base font-size and doesn't update
      // for bigger/smaller text (headings, inline code, etc). This is what
      // keeps the Box/Underline cursor from partially wrapping characters
      // that are larger or smaller than the default size.
      let charWidth = view.defaultCharacterWidth || 8;
      if (char) {
        try {
          const nextCoords = view.coordsAtPos(pos + 1, -1) || view.coordsAtPos(pos + 1, 1);
          if (nextCoords) {
            const measured = nextCoords.left - c.left;
            if (measured > 0.5 && measured < charWidth * 6) charWidth = measured;
          }
        } catch {
          /* fall back to defaultCharacterWidth */
        }
      }

      let finalWidth = charWidth;
      if (this.settings.cursorStyle === "Line") {
        finalWidth = this.settings.caretWidthPx;
      }

      return {
        x: c.left,
        top: c.top,
        bottom: c.bottom,
        h: Math.max(4, c.bottom - c.top),
        w: finalWidth,
        actualCharWidth: charWidth,
        char,
        textColor,
        fontSize: parseFloat(charStyle.fontSize) || parseFloat(contentStyle.fontSize) || 14,
        fontFamily: charStyle.fontFamily || contentStyle.fontFamily || "monospace",
        focused: view.hasFocus || (inTable && activeIsEditable),
        pos,
      };
    } catch {
      return null; 
    }
  }

  selectionFallbackCoords(view) {
    const doc = view ? view.dom.ownerDocument : activeDocument;
    const active = doc.activeElement;
    if (!active) return null;
    const editable = active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT";
    if (!editable) return null;

    const win = doc.defaultView || window;
    const sel = win.getSelection();
    if (sel && sel.rangeCount > 0 && active.isContentEditable) {
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(true);
      let rect = range.getClientRects()[0];
      if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)) {
        rect = active.getBoundingClientRect();
      }
      if (rect) return { left: rect.left, top: rect.top, bottom: rect.bottom || rect.top + rect.height };
    }

    const rect = active.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
  }

  resolveHoldChar(newCaret) {
    try {
      const view = this.app.workspace.activeEditor?.editor?.cm;
      if (
        view &&
        typeof newCaret.pos === "number" &&
        typeof this.lastActive?.pos === "number" &&
        newCaret.pos > this.lastActive.pos
      ) {
        const justTyped = view.state.doc.sliceString(newCaret.pos - 1, newCaret.pos);
        if (justTyped && justTyped !== "\n") {
          if (this.settings.popLetters) {
            this.spawnLetterParticle(justTyped, this.lastActive);
          }
          return justTyped;
        }
      }
    } catch {
      /* fall through */
    }
    return this.lastActive ? this.lastActive.char : "";
  }

  updateActivePoint() {
    const caret = this.caretCoords();
    if (!caret || !caret.focused) {
      this.lastActive = null;
      this.pending = null;
      return;
    }

    if (!this.lastActive) {
      this.lastActive = caret;
      this.pending = null;
      return;
    }

    const moved =
      Math.abs(this.lastActive.x - caret.x) > 0.5 || Math.abs(this.lastActive.top - caret.top) > 0.5;

    if (!moved) {
      if (!this.pending) this.lastActive = caret;
      return;
    }

    if (caret.pos === this.lastActive.pos) {
      const dx = caret.x - this.lastActive.x;
      const dy = caret.top - this.lastActive.top;
      
      this.lastActive = caret;
      
      // If the coordinate changed but the document position didn't, it was a scroll/layout shift.
      // We instantly shift the animation and spring physics to prevent the smear wiggle.
      if (this.animActive && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        this.animActive.x += dx;
        this.animActive.top += dy;
        this.animActive.w = caret.w;
        this.animActive.h = caret.h;
        
        if (this.smearQuad) {
          for (const key in this.smearQuad) {
            this.smearQuad[key].x += dx;
            this.smearQuad[key].y += dy;
          }
          if (this.smearCenterPrev) {
            this.smearCenterPrev.x += dx;
            this.smearCenterPrev.y += dy;
          }
        }
      }
      return;
    }

    const delay = Math.max(0, Math.round(this.settings.moveDelayMs));
    if (delay <= 0) {
      const holdChar = this.resolveHoldChar(caret);
      this.commitMove(caret);
      if (holdChar && this.lastActive) this.lastActive.holdChar = holdChar;
      return;
    }

    const targetChanged = !this.pending || this.pending.caret.x !== caret.x || this.pending.caret.top !== caret.top;
    if (targetChanged) {
      this.pending = { caret, since: performance.now(), holdChar: this.resolveHoldChar(caret) };
    } else if (performance.now() - this.pending.since >= delay) {
      this.commitMove(this.pending.caret);
    }
  }

  updateSmoothCursor() {
    if (!this.lastActive) {
      this.animActive = null;
      return;
    }

    if (!this.settings.smoothEnabled) {
      this.animActive = { ...this.lastActive };
      return;
    }

    if (!this.animActive) {
      this.animActive = { ...this.lastActive };
    }

    const now = performance.now();
    let targetSpeed = this.settings.catchUpSpeed;

    if (this.settings.smoothAdaptive) {
      const timeSinceMove = now - this.lastMoveTime;
      if (timeSinceMove < 150) {
        const maxMod = this.settings.maxCatchUpSpeed / Math.max(0.01, this.settings.catchUpSpeed);
        this.typingSpeedMod = Math.min(this.typingSpeedMod + 0.15, maxMod);
      } else {
        this.typingSpeedMod = Math.max(this.typingSpeedMod - 0.05, 1);
      }
      targetSpeed = Math.min(this.settings.maxCatchUpSpeed, targetSpeed * this.typingSpeedMod);
    }

    const lerpFactor = Math.min(1, targetSpeed * (1 - this.settings.smoothness));

    this.animActive.x += (this.lastActive.x - this.animActive.x) * lerpFactor;
    this.animActive.top += (this.lastActive.top - this.animActive.top) * lerpFactor;
    this.animActive.w += (this.lastActive.w - this.animActive.w) * lerpFactor;
    this.animActive.h += (this.lastActive.h - this.animActive.h) * lerpFactor;
    
    this.animActive.textColor = this.lastActive.textColor;
    this.animActive.char = this.lastActive.char;
    this.animActive.holdChar = this.lastActive.holdChar;
    this.animActive.actualCharWidth = this.lastActive.actualCharWidth;
    this.animActive.fontFamily = this.lastActive.fontFamily;
    this.animActive.fontSize = this.lastActive.fontSize;
  }

  commitMove(caret) {
    this.pushTrail(this.lastActive);
    if (this.lastActive) {
      this.spawnFlamePixels(this.lastActive);
    }
    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now(); 
  }

  getActiveRect() {
    const active = this.animActive;
    if (!active) return null;
    if (this.settings.cursorStyle === "Underline") {
      const uThickness = Math.max(2, Math.round(active.h * 0.15));
      return { x: active.x, y: active.top + active.h - uThickness, w: active.actualCharWidth, h: uThickness };
    }
    return { x: active.x, y: active.top, w: this.renderWidth(active), h: active.h };
  }

  updateSmearQuad() {
    const now = performance.now();
    if (!this.smearQuadLastT) this.smearQuadLastT = now;
    let dt = (now - this.smearQuadLastT) / 1000;
    this.smearQuadLastT = now;
    dt = Math.min(dt, 0.05);

    const settings = this.settings;
    const rect = settings.smear ? this.getActiveRect() : null;

    if (!rect) {
      this.smearQuad = null;
      this.smearCenterPrev = null;
      return;
    }

    const targets = {
      tl: { x: rect.x, y: rect.y },
      tr: { x: rect.x + rect.w, y: rect.y },
      br: { x: rect.x + rect.w, y: rect.y + rect.h },
      bl: { x: rect.x, y: rect.y + rect.h },
    };

    if (!this.smearQuad) {
      this.smearQuad = {};
      for (const key in targets) {
        this.smearQuad[key] = { x: targets[key].x, y: targets[key].y, vx: 0, vy: 0 };
      }
      this.smearCenterPrev = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      return;
    }

    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    let dirX = 0, dirY = 0;
    if (this.smearCenterPrev) {
      dirX = center.x - this.smearCenterPrev.x;
      dirY = center.y - this.smearCenterPrev.y;
    }
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen > 0.01) {
      dirX /= dirLen;
      dirY /= dirLen;
    }
    this.smearCenterPrev = center;

    const freqLead = 2 + Math.max(0, Math.min(1, settings.smearStiffness)) * 38;
    const freqTrail = 2 + Math.max(0, Math.min(1, settings.smearTrailingStiffness)) * 38;
    const dampingRatio = 0.15 + Math.max(0, Math.min(1, settings.smearDamping)) * 1.15;

    for (const key in targets) {
      const c = this.smearQuad[key];
      const t = targets[key];

      const offX = t.x - center.x;
      const offY = t.y - center.y;
      const offLen = Math.hypot(offX, offY) || 1;
      const align = dirLen > 0.01 ? (offX / offLen) * dirX + (offY / offLen) * dirY : 0;
      const freq = align >= 0 ? freqLead : freqTrail;

      const k = freq * freq;
      const damp = 2 * dampingRatio * freq;
      const ax = k * (t.x - c.x) - damp * c.vx;
      const ay = k * (t.y - c.y) - damp * c.vy;
      c.vx += ax * dt;
      c.vy += ay * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.vx) || !isFinite(c.vy)) {
        c.x = t.x;
        c.y = t.y;
        c.vx = 0;
        c.vy = 0;
      }
    }
  }

  pushTrail(point) {
    if (!point) return;
    this.trail.push({ x: point.x, y: point.top, w: point.w, h: point.h, t: performance.now() });
    const max = Math.max(0, Math.round(this.settings.trailLength));
    while (this.trail.length > max) this.trail.shift();
  }

  spawnLetterParticle(char, anchor) {
    if (!char.trim()) return;
    this.particles.push({
      char: char,
      x: anchor.x + (anchor.w || anchor.actualCharWidth) / 2,
      y: anchor.top,
      vx: (Math.random() - 0.5) * 120,    
      vy: -150 - Math.random() * 130,     
      rotation: (Math.random() - 0.5) * 4,
      alpha: 1,
      fontSize: anchor.fontSize,
      fontFamily: anchor.fontFamily,
      color: this.getActiveColor() || anchor.textColor, 
      start: performance.now()
    });
  }

  spawnFlamePixels(anchor) {
    if (!this.settings.flameTrail) return;
    
    const count = Math.floor(6 + Math.random() * 6);
    let baseHex = this.getActiveColor() || "#39ff14";
    let h = baseHex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    let r = (parseInt(h, 16) >> 16) & 255;
    let g = (parseInt(h, 16) >> 8) & 255;
    let b = parseInt(h, 16) & 255;
    
    for (let i = 0; i < count; i++) {
      const pX = anchor.x + Math.random() * (anchor.w || anchor.actualCharWidth);
      const pY = anchor.top + Math.random() * anchor.h;
      const varR = Math.max(0, Math.min(255, r + Math.floor((Math.random() - 0.5) * 70)));
      const varG = Math.max(0, Math.min(255, g + Math.floor((Math.random() - 0.5) * 70)));
      const varB = Math.max(0, Math.min(255, b + Math.floor((Math.random() - 0.5) * 70)));
      
      this.flamePixels.push({
        x: pX,
        y: pY,
        vx: (Math.random() - 0.5) * 20, 
        vy: 0,                          
        size: 2.5 + Math.random() * 3,  
        color: `rgb(${varR}, ${varG}, ${varB})`,
        alpha: 1,
        start: performance.now()
      });
    }
  }

  blinkAlpha(now) {
    if (!this.settings.blinkingEnabled) return 1;
    if (this.settings.smoothEnabled && this.settings.smoothStopBlinking) {
      if (now - this.lastMoveTime < 450) return 1; 
    }
    return blinkAlphaAt(now, Math.max(0, this.settings.blinkSpeed), this.settings.blinkOnOffBalance ?? 0.5);
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const win = this.canvas.ownerDocument.defaultView || window;
    ctx.clearRect(0, 0, win.innerWidth, win.innerHeight);

    this.drawLettersParticles();
    this.drawFlamePixels();

    switch (this.settings.cursorStyle) {
      case "Line":
        this.drawGenericCaret(false);
        break;
      case "Underline":
        this.drawGenericCaret(true);
        break;
      case "Box":
        this.drawRetroBox();
        break;
    }
  }

  renderWidth(active) {
    return active.w;
  }

  forEachTrailPoint(cb) {
    if (!this.settings.crtEffect) return;
    const now = performance.now();
    const fade = Math.max(50, this.settings.trailFadeMs);
    this.trail = this.trail.filter((p) => now - p.t < fade);
    for (const p of this.trail) {
      const age = (now - p.t) / fade;
      const alpha = Math.max(0, 1 - age) * 0.55;
      if (alpha > 0.02) cb(p, alpha);
    }
  }

  fillCursorShape(ctx, rx, ry, rw, rh) {
    const q = this.settings.smear ? this.smearQuad : null;
    const corners = q || {
      tl: { x: rx, y: ry },
      tr: { x: rx + rw, y: ry },
      br: { x: rx + rw, y: ry + rh },
      bl: { x: rx, y: ry + rh },
    };

    ctx.beginPath();
    ctx.moveTo(corners.tl.x, corners.tl.y);
    ctx.lineTo(corners.tr.x, corners.tr.y);
    ctx.lineTo(corners.br.x, corners.br.y);
    ctx.lineTo(corners.bl.x, corners.bl.y);
    ctx.closePath();
    ctx.fill();
  }

  createEnergyGradient(x, y, w, h, baseColor, alpha) {
    const ctx = this.ctx;
    const speed = this.settings.energySpeed ?? 1;
    const t = (performance.now() / 1000) * speed;
    const base = hexToRgbTuple(baseColor);

    const grad = ctx.createLinearGradient(x + w / 2, y + h, x + w / 2, y);
    const stops = 6;
    for (let i = 0; i <= stops; i++) {
      const pos = i / stops;
      const pulse = 0.5 + 0.5 * Math.sin((pos - t * 0.6) * Math.PI * 2);

      let r = base[0], g = base[1], b = base[2];
      if (pulse > 0.5) {
        const k = (pulse - 0.5) * 2;
        r += (255 - r) * k * 0.55;
        g += (255 - g) * k * 0.55;
        b += (255 - b) * k * 0.55;
      } else {
        const k = (0.5 - pulse) * 2;
        r -= r * k * 0.45;
        g -= g * k * 0.45;
        b -= b * k * 0.45;
      }

      const shift = 14;
      r += Math.sin(t * 0.7 + pos * 6) * shift;
      g += Math.sin(t * 0.7 + pos * 6 + 2.1) * shift;
      b += Math.sin(t * 0.7 + pos * 6 + 4.2) * shift;

      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      grad.addColorStop(pos, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return grad;
  }

  drawGenericCaret(isUnderline = false) {
    const ctx = this.ctx;
    const settings = this.settings;
    const active = this.animActive;
    const now = performance.now();
    const trailColor = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));

    this.forEachTrailPoint((p, alpha) => {
      ctx.fillStyle = hexToRgba(trailColor, alpha * opacity);
      if (isUnderline) {
        const uThickness = Math.max(2, Math.round(p.h * 0.15));
        ctx.fillRect(p.x, p.y + p.h - uThickness, p.w, uThickness);
      } else {
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    });

    if (!active) return;
    const blinkAlpha = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";

    ctx.save();
    if (settings.crtEffect && settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * blinkAlpha;
    }

    let rx, ry, rw, rh;
    if (isUnderline) {
      const uThickness = Math.max(2, Math.round(active.h * 0.15));
      rx = active.x;
      ry = active.top + active.h - uThickness;
      rw = active.actualCharWidth;
      rh = uThickness;
    } else {
      rx = active.x;
      ry = active.top;
      rw = this.renderWidth(active);
      rh = active.h;
    }

    ctx.fillStyle = settings.energyEffect
      ? this.createEnergyGradient(rx, ry, rw, rh, color, 0.9 * blinkAlpha * opacity)
      : hexToRgba(color, 0.9 * blinkAlpha * opacity);
    this.fillCursorShape(ctx, rx, ry, rw, rh);
    ctx.restore();
  }

  drawLettersParticles() {
    const ctx = this.ctx;
    const now = performance.now();
    
    this.particles = this.particles.filter(p => {
      const elapsed = (now - p.start) / 1000; 
      if (elapsed > 0.45) return false;       
      
      const t = elapsed / 0.45;
      p.alpha = 1 - t; 
      
      const curX = p.x + p.vx * elapsed;
      const curY = p.y + p.vy * elapsed + 0.5 * 320 * elapsed * elapsed; 
      const curRot = p.rotation * elapsed * 5;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.font = `bold ${p.fontSize * 0.9}px ${p.fontFamily}`;
      ctx.translate(curX, curY);
      ctx.rotate(curRot);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.char, 0, 0);
      ctx.restore();
      
      return true;
    });
  }

  drawFlamePixels() {
    const ctx = this.ctx;
    const now = performance.now();

    this.flamePixels = this.flamePixels.filter(p => {
      const elapsed = (now - p.start) / 1000;
      if (elapsed > 0.4) return false;

      const t = elapsed / 0.4;
      p.alpha = 1 - Math.pow(t, 2);

      const curX = p.x + p.vx * elapsed;
      const curY = p.y + p.vy * elapsed;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(curX, curY, p.size, p.size);
      ctx.restore();

      return true;
    });
  }

  drawRetroBox() {
    const ctx = this.ctx;
    const settings = this.settings;
    const now = performance.now();
    const color = this.getActiveColor();
    const opacity = Math.max(0, Math.min(1, settings.cursorOpacity ?? 1));

    this.forEachTrailPoint((p, alpha) => {
      ctx.fillStyle = hexToRgba(color, alpha * opacity);
      ctx.fillRect(p.x, p.y, p.w, p.h);
    });

    const active = this.animActive;
    if (active) {
      const blinkAlpha = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);

      ctx.save();
      if (settings.crtEffect && settings.glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * blinkAlpha;
        ctx.fillStyle = hexToRgba(color, 0.01);
        this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = settings.energyEffect
        ? this.createEnergyGradient(active.x, active.top, renderW, active.h, color, 0.9 * blinkAlpha * opacity)
        : hexToRgba(color, 0.9 * blinkAlpha * opacity);
      this.fillCursorShape(ctx, active.x, active.top, renderW, active.h);
      ctx.restore();

      const displayChar = this.pending ? this.pending.holdChar : (active.holdChar || active.char);
      if (settings.showChar && displayChar) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.3 + blinkAlpha * 0.7);
        ctx.fillStyle = invertColor(active.textColor);
        ctx.font = `${active.fontSize}px ${active.fontFamily}`;

        // Canvas's "middle" baseline centers a glyph within its own font
        // em-box (roughly ascent/descent of the font itself), but active.h
        // is the rendered *line height*, which is usually taller than that
        // em-box (CSS line-height adds extra leading above/below the
        // glyph). Centering purely on font metrics ignores that leading and
        // makes the drawn character sit noticeably higher than the real
        // text, which is vertically centered within the full line box.
        // Measuring real ascent/descent and centering the glyph's em-box
        // inside active.h (the same way the browser centers line content)
        // lines it up with where the actual character renders.
        const metrics = ctx.measureText(displayChar);
        const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? active.fontSize * 0.8;
        const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? active.fontSize * 0.2;
        const glyphBoxHeight = ascent + descent;
        const leading = active.h - glyphBoxHeight;
        const baselineY = active.top + ascent + leading / 2;

        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(displayChar, active.x + renderW / 2, baselineY);
        ctx.restore();
      }
    }
  }

  enableTorchOverlay() {
    this.torchEngineActive = true;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;

    const tick = () => {
      if (!this.torchEngineActive) return;
      const view = this.app.workspace.activeEditor?.editor?.cm;
      this.ensureTorchOverlayForView(view);
      if (view) this.registerWindowEvents(view.dom.ownerDocument);

      if (!this.overlay) {
        this.torchRaf = requestAnimationFrame(tick);
        return;
      }

      this.updateOverlayTarget();
      const lerp = this.settings.overlaySpeed;
      this.x += (this.tx - this.x) * lerp;
      this.y += (this.ty - this.y) * lerp;

      const r = this.getPaneRect(view);
      const usePane = r && this.settings.overlaySpareSidebars;

      if (usePane) {
        this.overlay.style.top = r.top + "px";
        this.overlay.style.left = r.left + "px";
        this.overlay.style.width = r.width + "px";
        this.overlay.style.height = r.height + "px";
      } else {
        this.overlay.style.top = "0px";
        this.overlay.style.left = "0px";
        this.overlay.style.width = "100vw";
        this.overlay.style.height = "100vh";
      }

      const offsetX = usePane ? r.left : 0;
      const offsetY = usePane ? r.top : 0;

      this.overlay.style.setProperty("--torch-x", (this.x - offsetX).toFixed(1) + "px");
      this.overlay.style.setProperty("--torch-y", (this.y - offsetY).toFixed(1) + "px");

      const hideForModal = this.settings.overlaySpareSidebars && this.modalOpen;
      this.overlay.classList.toggle("torch-cursor-hidden", !!hideForModal);

      this.torchRaf = requestAnimationFrame(tick);
    };
    this.torchRaf = requestAnimationFrame(tick);
  }

  getPaneRect(view) {
    if (!view) return null;
    const rootEl = view.dom.closest(".cm-editor") || view.dom.closest(".workspace-leaf");
    if (!rootEl) return null;
    const rect = rootEl.getBoundingClientRect();
    const doc = rootEl.ownerDocument;

    // Clipping to the editor pane's own bounding rect assumes the status
    // bar/titlebar always take up real space in document flow, pushing the
    // pane's rect to stop short of them. Some themes and CSS snippets
    // instead position those elements as floating overlays (fixed/absolute)
    // that sit on top of the pane rather than shrinking it - in that case
    // the pane's rect still extends underneath them, so clipping to it
    // alone doesn't stop the canvas (z-index 10000) from painting over
    // them. Explicitly clamp against whichever of these elements actually
    // overlaps the pane rect.
    let top = rect.top;
    let bottom = rect.bottom;

    const statusBar = doc.querySelector(".status-bar");
    if (statusBar) {
      const sbRect = statusBar.getBoundingClientRect();
      if (sbRect.height > 0 && sbRect.top < bottom && sbRect.bottom > top) {
        bottom = Math.min(bottom, sbRect.top);
      }
    }

    const titleBar = doc.querySelector(".titlebar");
    if (titleBar) {
      const tbRect = titleBar.getBoundingClientRect();
      if (tbRect.height > 0 && tbRect.bottom > top && tbRect.top < bottom) {
        top = Math.max(top, tbRect.bottom);
      }
    }

    if (bottom <= top) return rect; // safety net: never collapse to an empty/inverted rect

    return {
      top,
      bottom,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: bottom - top,
    };
  }

  updateOverlayTarget() {
    const mode = this.settings.overlayFollowMode;
    const caret = this.caretCoords();
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = Date.now();
      }
      this.lastCaret = caret;
    }

    const useMouse =
      mode === "mouse" ||
      (mode === "auto" && (Date.now() - this.lastMouseMove < 800 || !this.lastCaret));

    if (useMouse) {
      this.tx = this.mouseX;
      this.ty = this.mouseY;
    } else if (this.lastCaret) {
      this.tx = this.lastCaret.x;
      this.ty = (this.lastCaret.top + this.lastCaret.bottom) / 2;
    }
  }
}

class CursorSmithSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const set = (key) => async (v) => {
      this.plugin.settings[key] = v;
      await this.plugin.saveSettings();
    };

    const setAndRedraw = (key) => async (v) => {
      this.plugin.settings[key] = v;
      await this.plugin.saveSettings();
      this.display();
    };

    containerEl.createEl("h2", { text: "⚡ Cursor-Smith Settings" });
    containerEl.createEl("h3", { text: "Core Configuration" });

    new Setting(containerEl)
      .setName("Enable Plugin")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            this.plugin.settings.enabled = value;
            value ? this.plugin.enable() : this.plugin.disable();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cursor Style")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Box", "Box")
          .addOption("Line", "Line")
          .addOption("Underline", "Underline")
          .setValue(this.plugin.settings.cursorStyle)
          .onChange(async (value) => {
            this.plugin.settings.cursorStyle = value;
            await this.plugin.saveSettings();
            this.plugin.enable();
            this.display(); 
          })
      );

    new Setting(containerEl)
      .setName("Hide Real Cursor")
      .setDesc("Hides your browser's normal text cursor so only the custom one shows.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.hideNativeCaret).onChange(set("hideNativeCaret")));

    containerEl.createEl("h3", { text: "Appearance" });

    if (this.plugin.settings.cursorStyle === "Line") {
      new Setting(containerEl)
        .setName("Cursor Thickness")
        .setDesc("How thick the Line cursor is, in pixels.")
        .addSlider((slider) =>
          slider
            .setLimits(1, 12, 1)
            .setValue(this.plugin.settings.caretWidthPx)
            .setDynamicTooltip()
            .onChange(set("caretWidthPx"))
        );
    }

    new Setting(containerEl)
      .setName("Cursor Color (Dark Theme)")
      .addColorPicker((cp) => cp.setValue(this.plugin.settings.colorDark).onChange(set("colorDark")));

    new Setting(containerEl)
      .setName("Cursor Color (Light Theme)")
      .addColorPicker((cp) => cp.setValue(this.plugin.settings.colorLight).onChange(set("colorLight")));

    new Setting(containerEl)
      .setName("Cursor Opacity")
      .setDesc("How see-through the cursor is.")
      .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.cursorOpacity).setDynamicTooltip().onChange(set("cursorOpacity")));

    if (this.plugin.settings.cursorStyle === "Box") {
      new Setting(containerEl)
        .setName("Show Letter Inside Cursor")
        .setDesc("Shows the letter under the cursor inside the block, with the colors flipped.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.showChar).onChange(set("showChar")));
    }

    containerEl.createEl("h3", { text: "Blinking" });

    new Setting(containerEl)
      .setName("Blinking")
      .setDesc("Makes the cursor blink. Turn off to keep it always fully lit.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.blinkingEnabled).onChange(setAndRedraw("blinkingEnabled")));

    if (this.plugin.settings.blinkingEnabled) {
      new Setting(containerEl)
        .setName("Blink Speed")
        .setDesc("How fast the cursor blinks.")
        .addSlider((s) => s.setLimits(0.1, 3, 0.1).setValue(this.plugin.settings.blinkSpeed).setDynamicTooltip().onChange(set("blinkSpeed")));

      new Setting(containerEl)
        .setName("Blink Balance")
        .setDesc("How the blink cycle is split between lit and dark.")
        .addSlider((s) => s.setLimits(0.1, 0.9, 0.05).setValue(this.plugin.settings.blinkOnOffBalance).setDynamicTooltip().onChange(set("blinkOnOffBalance")));

      new Setting(containerEl)
        .setName("Don't Blink While Typing")
        .setDesc("Keeps the cursor fully lit while you type or move it.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.smoothStopBlinking).onChange(set("smoothStopBlinking")));
    }

    containerEl.createEl("h3", { text: "Smooth Movement" });

    new Setting(containerEl)
      .setName("Smooth Movement")
      .setDesc("Makes the cursor glide to its new spot instead of jumping there instantly.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.smoothEnabled).onChange(setAndRedraw("smoothEnabled")));

    if (this.plugin.settings.smoothEnabled) {
      new Setting(containerEl)
        .setName("Glide Amount")
        .addSlider((s) => s.setLimits(0.05, 0.30, 0.05).setValue(this.plugin.settings.smoothness).setDynamicTooltip().onChange(set("smoothness")));

      new Setting(containerEl)
        .setName("Catch-Up Speed")
        .addSlider((s) => s.setLimits(0.30, 0.80, 0.05).setValue(this.plugin.settings.catchUpSpeed).setDynamicTooltip().onChange(set("catchUpSpeed")));

      new Setting(containerEl)
        .setName("Max Catch-Up Speed")
        .addSlider((s) => s.setLimits(0.50, 1.0, 0.05).setValue(this.plugin.settings.maxCatchUpSpeed).setDynamicTooltip().onChange(set("maxCatchUpSpeed")));

      new Setting(containerEl)
        .setName("Speed Up When Typing Fast")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.smoothAdaptive).onChange(set("smoothAdaptive")));

      new Setting(containerEl)
        .setName("Movement Delay")
        .addSlider((s) => s.setLimits(0, 500, 10).setValue(this.plugin.settings.moveDelayMs).setDynamicTooltip().onChange(set("moveDelayMs")));
    }

    containerEl.createEl("h3", { text: "Effects" });

    new Setting(containerEl)
      .setName("Popping Letters")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.popLetters).onChange(set("popLetters")));

    new Setting(containerEl)
      .setName("Pixel Trail")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.flameTrail).onChange(set("flameTrail")));

    new Setting(containerEl)
      .setName("Motion Smear")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.smear).onChange(setAndRedraw("smear")));

    if (this.plugin.settings.smear) {
      new Setting(containerEl)
        .setName("Stiffness")
        .addSlider((s) => s.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.smearStiffness).setDynamicTooltip().onChange(set("smearStiffness")));

      new Setting(containerEl)
        .setName("Trailing Stiffness")
        .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(this.plugin.settings.smearTrailingStiffness).setDynamicTooltip().onChange(set("smearTrailingStiffness")));

      new Setting(containerEl)
        .setName("Damping")
        .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(this.plugin.settings.smearDamping).setDynamicTooltip().onChange(set("smearDamping")));
    }

    new Setting(containerEl)
      .setName("Energy Beam")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.energyEffect).onChange(setAndRedraw("energyEffect")));

    if (this.plugin.settings.energyEffect) {
      new Setting(containerEl)
        .setName("Beam Speed")
        .addSlider((s) => s.setLimits(0.2, 3, 0.1).setValue(this.plugin.settings.energySpeed).setDynamicTooltip().onChange(set("energySpeed")));
    }

    new Setting(containerEl)
      .setName("CRT Effect")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.crtEffect).onChange(setAndRedraw("crtEffect")));

    if (this.plugin.settings.crtEffect) {
      new Setting(containerEl)
        .setName("Trail Length")
        .addSlider((s) => s.setLimits(0, 30, 1).setValue(this.plugin.settings.trailLength).setDynamicTooltip().onChange(set("trailLength")));

      new Setting(containerEl)
        .setName("Trail Fade Time")
        .addSlider((s) => s.setLimits(50, 1500, 25).setValue(this.plugin.settings.trailFadeMs).setDynamicTooltip().onChange(set("trailFadeMs")));

      new Setting(containerEl)
        .setName("Glow")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.glow).onChange(set("glow")));
    }

    new Setting(containerEl)
      .setName("Torch Spotlight")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.torchEffect).onChange(async (value) => {
          this.plugin.settings.torchEffect = value;
          await this.plugin.saveSettings();
          if (this.plugin.settings.enabled) {
            value ? this.plugin.enableTorchOverlay() : this.plugin.disableTorchOverlay();
          }
          this.display();
        })
      );

    if (this.plugin.settings.torchEffect) {
      containerEl.createEl("h4", { text: "Spotlight" });

      new Setting(containerEl)
        .setName("Follow")
        .addDropdown((d) =>
          d
            .addOptions({ caret: "Text Cursor Only", mouse: "Mouse Pointer Only", auto: "Auto Intelligent Swap" })
            .setValue(this.plugin.settings.overlayFollowMode)
            .onChange(set("overlayFollowMode"))
        );

      new Setting(containerEl)
        .setName("Light Size")
        .addSlider((s) => s.setLimits(100, 800, 10).setValue(this.plugin.settings.overlayRadius).setDynamicTooltip().onChange(set("overlayRadius")));

      new Setting(containerEl)
        .setName("Light Color")
        .addColorPicker((cp) => cp.setValue(this.plugin.settings.overlayColor).onChange(set("overlayColor")));

      new Setting(containerEl)
        .setName("Follow Speed")
        .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(this.plugin.settings.overlaySpeed).setDynamicTooltip().onChange(set("overlaySpeed")));

      containerEl.createEl("h4", { text: "Environment" });

      new Setting(containerEl)
        .setName("Darkness")
        .addSlider((s) => s.setLimits(0.2, 1, 0.01).setValue(this.plugin.settings.overlayDarkness).setDynamicTooltip().onChange(set("overlayDarkness")));

      new Setting(containerEl)
        .setName("Glow Strength")
        .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.overlayIntensity).setDynamicTooltip().onChange(set("overlayIntensity")));

      new Setting(containerEl)
        .setName("Flicker")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.overlayFlicker).onChange(set("overlayFlicker")));

      new Setting(containerEl)
        .setName("Keep Sidebars Lit")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.overlaySpareSidebars).onChange(set("overlaySpareSidebars")));
    }
  }
}
/* nosourcemap */
