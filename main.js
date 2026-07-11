const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  enabled: true,
  cursorStyle: "Box", // "Line" | "Box" | "Underline" | "Torch"

  // --- appearance color controls ---
  colorDark: "#39ff14", 
  colorLight: "#333333",
  glow: true, 

  // --- torch overlay style (ponytail DOM/CSS variant) ---
  overlaySpareSidebars: true,
  overlayFollowMode: "caret", // caret | mouse | auto
  overlayRadius: 250,
  overlayDarkness: 0.7,
  overlayIntensity: 0.1,
  overlayColor: "#ff963c",
  overlayFlicker: false,
  overlaySpeed: 0.22, // lerp factor: how fast the torch chases its target
  overlayEmberCaret: true, // gradient flame caret

  // --- global caret properties ---
  caretWidthPx: 2,         
  popLetters: true,        
  flameTrail: true,        
  cursorOpacity: 1,

  // --- shared canvas engine settings ---
  trailLength: 10, 
  trailFadeMs: 450, 
  blinkSpeed: 1.2,       
  blinkOnOffBalance: 0.5,
  hideNativeCaret: true, 
  showChar: true, 
  moveDelayMs: 0,        
  smear: true,           
  smearDurationMs: 80,   

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
  const n = parseInt((hex || "#ff963c").replace("#", ""), 16) || 0;
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
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
  const hold = 1 - fade * 2; // total time split between lit and dark
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

    // Canvas State
    this.canvas = null;
    this.ctx = null;
    this.trail = []; 
    this.particles = []; 
    this.flamePixels = [];
    this.lastActive = null; 
    this.pending = null; 
    this.smear = null; 

    // Smooth Cursor State
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;

    // Torch Overlay Engine State
    this.overlay = null;
    this.caretEl = null;
    this.modalObserver = null;
    this.modalOpen = false;
    this.x = this.tx = window.innerWidth / 2;
    this.y = this.ty = window.innerHeight / 2;
    this.lastCaret = null;
    this.lastCaretMove = 0;
    this.mouseX = this.x;
    this.mouseY = this.y;
    this.lastMouseMove = 0;
    this.raf = 0;

    this.registerDomEvent(document, "mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.lastMouseMove = Date.now();
    });

    this.registerDomEvent(window, "resize", () => this.resizeCanvas());

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
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyBodyClasses();
    this.applyOverlayStyle();
  }

  toggle() {
    const wasActive = !!(this.canvas || this.overlay);
    wasActive ? this.disable() : this.enable();
    this.settings.enabled = !!(this.canvas || this.overlay);
    this.saveSettings();
  }

  getActiveColor() {
    const isDark = document.body.classList.contains("theme-dark");
    return isDark ? this.settings.colorDark : this.settings.colorLight;
  }

  applyBodyClasses() {
    const engineActive = !!(this.canvas || this.overlay);
    document.body.classList.toggle(
      "retro-box-cursor-hide-native",
      !!(engineActive && this.settings.hideNativeCaret)
    );
  }

  applyOverlayStyle() {
    if (this.settings.cursorStyle !== "Torch") return;
    const s = this.settings;
    const b = document.body;
    b.style.setProperty("--torch-radius", s.overlayRadius + "px");
    b.style.setProperty("--torch-darkness", String(s.overlayDarkness));
    b.style.setProperty("--torch-intensity", String(s.overlayIntensity));
    b.style.setProperty("--torch-warm", hexToRgb(s.overlayColor));
    b.style.setProperty("--torch-caret-width", s.caretWidthPx + "px");
    b.classList.toggle("torch-no-flicker", !s.overlayFlicker);
    b.classList.toggle("torch-ember-caret", s.overlayEmberCaret);
  }

  enable() {
    this.disable(); 

    if (this.settings.cursorStyle === "Torch") {
      this.enableTorchOverlay();
    } else {
      this.enableCanvasEngine();
    }
  }

  disable() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    
    document.body.classList.remove("retro-box-cursor-active", "retro-box-cursor-hide-native");
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
    this.pending = null;
    this.smear = null;
    this.particles = [];
    this.flamePixels = [];
    this.animActive = null;

    document.body.classList.remove("torch-cursor-active", "torch-no-flicker", "torch-ember-caret");
    this.overlay?.remove();
    this.overlay = null;
    this.caretEl = null;
    this.modalObserver?.disconnect();
    this.modalObserver = null;
    this.modalOpen = false;
  }

  enableCanvasEngine() {
    document.body.classList.add("retro-box-cursor-active");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "retro-box-cursor-canvas";
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.applyBodyClasses();
    this.resizeCanvas();

    this.trail = [];
    this.particles = [];
    this.flamePixels = [];
    this.lastActive = null;
    this.pending = null;
    this.smear = null;
    this.animActive = null;
    this.lastMoveTime = 0;
    this.typingSpeedMod = 1;

    const tick = () => {
      if (!this.canvas) return;
      this.updateActivePoint();
      this.updateSmoothCursor();
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
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
      const c = view.coordsAtPos(pos, -1);
      if (!c) return null;

      const charWidth = view.defaultCharacterWidth || 8;
      const rawChar = view.state.doc.sliceString(pos, pos + 1);
      const char = rawChar && rawChar !== "\n" ? rawChar : "";

      const contentStyle = getComputedStyle(view.contentDOM);
      const lineEl = view.contentDOM.querySelector(".cm-line");
      const textColor = (lineEl ? getComputedStyle(lineEl).color : null) || contentStyle.color || "#ffffff";

      let finalWidth = charWidth;
      if (this.settings.cursorStyle === "Line" || this.settings.cursorStyle === "Torch") {
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
        fontSize: parseFloat(contentStyle.fontSize) || 14,
        fontFamily: contentStyle.fontFamily || "monospace",
        focused: view.hasFocus,
        pos,
      };
    } catch {
      return null; 
    }
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
      this.lastActive = caret;
      return;
    }

    const delay = Math.max(0, Math.round(this.settings.moveDelayMs));
    if (delay <= 0) {
      this.resolveHoldChar(caret);
      this.commitMove(caret);
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
      // If moving rapidly (under 150ms between strokes), ramp up multiplier
      if (timeSinceMove < 150) {
        const maxMod = this.settings.maxCatchUpSpeed / Math.max(0.01, this.settings.catchUpSpeed);
        this.typingSpeedMod = Math.min(this.typingSpeedMod + 0.15, maxMod);
      } else {
        this.typingSpeedMod = Math.max(this.typingSpeedMod - 0.05, 1);
      }
      targetSpeed = Math.min(this.settings.maxCatchUpSpeed, targetSpeed * this.typingSpeedMod);
    }

    // Blend Catch-Up Speed with Animation Smoothness (damping)
    const lerpFactor = Math.min(1, targetSpeed * (1 - this.settings.smoothness));

    this.animActive.x += (this.lastActive.x - this.animActive.x) * lerpFactor;
    this.animActive.top += (this.lastActive.top - this.animActive.top) * lerpFactor;
    this.animActive.w += (this.lastActive.w - this.animActive.w) * lerpFactor;
    this.animActive.h += (this.lastActive.h - this.animActive.h) * lerpFactor;
    
    // Transfer hard references so styling applies correctly
    this.animActive.textColor = this.lastActive.textColor;
    this.animActive.char = this.lastActive.char;
    this.animActive.actualCharWidth = this.lastActive.actualCharWidth;
    this.animActive.fontFamily = this.lastActive.fontFamily;
    this.animActive.fontSize = this.lastActive.fontSize;
  }

  commitMove(caret) {
    this.pushTrail(this.lastActive);
    if (this.settings.smear) this.startSmear(this.lastActive, caret);
    
    if (this.lastActive) {
      this.spawnFlamePixels(this.lastActive);
    }

    this.lastActive = caret;
    this.pending = null;
    this.lastMoveTime = performance.now(); 
  }

  startSmear(from, to) {
    this.smear = {
      fromX: from.x,
      fromY: from.top,
      fromW: from.w,
      fromH: from.h,
      toX: to.x,
      toY: to.top,
      toW: to.w,
      toH: to.h,
      start: performance.now(),
    };
  }

  pushTrail(point) {
    this.trail.push({ x: point.x, y: point.top, w: point.w, h: point.h, t: performance.now() });
    const max = Math.max(0, Math.round(this.settings.trailLength));
    while (this.trail.length > max) this.trail.shift();
  }

  computeSmear(now) {
    if (!this.smear) return null;
    const dur = Math.max(20, this.settings.smearDurationMs);
    const t = (now - this.smear.start) / dur;
    if (t >= 1) {
      this.smear = null;
      return null;
    }
    
    const ease = 1 - Math.pow(1 - t, 3); 

    const s = this.smear;
    const fromCX = s.fromX + s.fromW / 2;
    const fromCY = s.fromY + s.fromH / 2;
    const toCX = s.toX + s.toW / 2;
    const toCY = s.toY + s.toH / 2;
    const dx = toCX - fromCX;
    const dy = toCY - fromCY;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    const thickStart = Math.min(s.fromH, s.toH) * 0.8;
    const thickEnd = s.toH;
    const thick = thickStart + (thickEnd - thickStart) * ease;
    const len = (dist + s.toW) + (s.toW - (dist + s.toW)) * ease;

    return { 
      leadX: toCX, 
      leadY: toCY, 
      len: len, 
      thick: thick, 
      angle: angle, 
      alpha: (1 - ease) * 0.7 
    };
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
      const pColor = `rgb(${varR}, ${varG}, ${varB})`;
      
      this.flamePixels.push({
        x: pX,
        y: pY,
        vx: (Math.random() - 0.5) * 20, 
        vy: 0,                          
        size: 2.5 + Math.random() * 3,  
        color: pColor,
        alpha: 1,
        start: performance.now()
      });
    }
  }

  blinkAlpha(now) {
    if (this.settings.smoothEnabled && this.settings.smoothStopBlinking) {
      if (now - this.lastMoveTime < 450) { 
        return 1; 
      }
    }
    return blinkAlphaAt(now, Math.max(0, this.settings.blinkSpeed), this.settings.blinkOnOffBalance ?? 0.5);
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

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
    const now = performance.now();
    const fade = Math.max(50, this.settings.trailFadeMs);
    this.trail = this.trail.filter((p) => now - p.t < fade);
    for (const p of this.trail) {
      const age = (now - p.t) / fade;
      const alpha = Math.max(0, 1 - age) * 0.55;
      if (alpha > 0.02) cb(p, alpha);
    }
  }

  withSmear(cb) {
    if (!this.settings.smear) return;
    const smear = this.computeSmear(performance.now());
    if (smear && smear.alpha > 0.02) cb(smear);
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

    this.withSmear((smear) => {
      const thick = isUnderline ? Math.max(2, smear.thick * 0.25) : smear.thick;
      ctx.save();
      ctx.translate(smear.leadX, smear.leadY);
      ctx.rotate(smear.angle);
      ctx.fillStyle = hexToRgba(trailColor, smear.alpha * opacity);
      ctx.fillRect(-smear.len, -thick / 2, smear.len, thick);
      ctx.restore();
    });

    if (!active) return;
    const blinkAlpha = this.blinkAlpha(now);
    const color = this.getActiveColor() || active.textColor || "#ffffff";

    ctx.save();
    if (settings.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * blinkAlpha;
    }
    ctx.fillStyle = hexToRgba(color, 0.9 * blinkAlpha * opacity);

    if (isUnderline) {
      const uThickness = Math.max(2, Math.round(active.h * 0.15));
      ctx.fillRect(active.x, active.top + active.h - uThickness, active.actualCharWidth, uThickness);
    } else {
      ctx.fillRect(active.x, active.top, this.renderWidth(active), active.h);
    }
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

    this.withSmear((smear) => {
      ctx.save();
      ctx.translate(smear.leadX, smear.leadY);
      ctx.rotate(smear.angle);
      ctx.fillStyle = hexToRgba(color, smear.alpha * opacity);
      ctx.fillRect(-smear.len, -smear.thick / 2, smear.len, smear.thick);
      ctx.restore();
    });

    const active = this.animActive;
    if (active) {
      const blinkAlpha = this.blinkAlpha(now);
      const renderW = this.renderWidth(active);

      ctx.save();
      if (settings.glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * blinkAlpha;
      }
      ctx.fillStyle = hexToRgba(color, 0.9 * blinkAlpha * opacity);
      ctx.fillRect(active.x, active.top, renderW, active.h);
      ctx.restore();

      const displayChar = this.pending ? this.pending.holdChar : active.char;
      if (settings.showChar && displayChar) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.3 + blinkAlpha * 0.7);
        ctx.fillStyle = invertColor(active.textColor);
        ctx.font = `${active.fontSize}px ${active.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(displayChar, active.x + renderW / 2, active.top + active.h / 2 + 1);
        ctx.restore();
      }
    }
  }

  enableTorchOverlay() {
    this.applyOverlayStyle();
    this.applyBodyClasses();
    document.body.classList.add("torch-cursor-active");
    this.overlay = document.body.createDiv({ cls: "torch-cursor-overlay" });
    this.overlay.createDiv({ cls: "torch-cursor-glow" });
    this.caretEl = this.overlay.createDiv({ cls: "torch-cursor-caret" });

    this.modalOpen = !!document.body.querySelector(".modal-container");
    this.modalObserver = new MutationObserver(() => {
      this.modalOpen = !!document.body.querySelector(".modal-container");
    });
    this.modalObserver.observe(document.body, { childList: true });

    const tick = () => {
      if (!this.overlay) return;
      this.updateOverlayTarget();
      const lerp = this.settings.overlaySpeed;
      this.x += (this.tx - this.x) * lerp;
      this.y += (this.ty - this.y) * lerp;
      this.overlay.style.setProperty("--torch-x", this.x.toFixed(1) + "px");
      this.overlay.style.setProperty("--torch-y", this.y.toFixed(1) + "px");
      this.overlay.style.clipPath = this.settings.overlaySpareSidebars
        ? this.editorClip()
        : "";

      const hideForModal = this.settings.overlaySpareSidebars && this.modalOpen;
      this.overlay.classList.toggle("torch-cursor-hidden", hideForModal);

      const c = this.lastCaret;
      if (c && c.focused) {
        this.caretEl.style.display = "";
        this.caretEl.style.transform = `translate(${c.x}px, ${c.top}px)`;
        this.caretEl.style.height = c.bottom - c.top + "px";
      } else {
        this.caretEl.style.display = "none";
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  editorClip() {
    const r = this.app.workspace.rootSplit?.containerEl?.getBoundingClientRect();
    if (!r) return "";
    return `inset(${r.top}px ${window.innerWidth - r.right}px ${window.innerHeight - r.bottom}px ${r.left}px)`;
  }

  updateOverlayTarget() {
    const mode = this.settings.overlayFollowMode;
    
    const caret = this.caretCoords();
    if (caret) {
      if (!this.lastCaret || caret.x !== this.lastCaret.x || caret.top !== this.lastCaret.top) {
        this.lastCaretMove = Date.now();
        this.resolveHoldChar(caret); 
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

    containerEl.createEl("h2", { text: "⚡ Cursor-Smith Settings" });

    // ================= Core Configuration =================
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
          .addOption("Torch", "Torch")
          .setValue(this.plugin.settings.cursorStyle)
          .onChange(async (value) => {
            this.plugin.settings.cursorStyle = value;
            await this.plugin.saveSettings();
            this.plugin.enable();
            this.display(); 
          })
      );

    // ================= Appearance =================
    containerEl.createEl("h3", { text: "Appearance" });

    if (["Line", "Torch"].includes(this.plugin.settings.cursorStyle)) {
      new Setting(containerEl)
        .setName("Cursor Thickness")
        .setDesc("How thick the Line/Torch cursor is, in pixels. Box and Underline always match the letter width.")
        .addSlider((slider) =>
          slider
            .setLimits(1, 12, 1)
            .setValue(this.plugin.settings.caretWidthPx)
            .setDynamicTooltip()
            .onChange(set("caretWidthPx"))
        );
    }

    if (this.plugin.settings.cursorStyle !== "Torch") {
      new Setting(containerEl)
        .setName("Cursor Color (Dark Theme)")
        .addColorPicker((cp) => cp.setValue(this.plugin.settings.colorDark).onChange(set("colorDark")));

      new Setting(containerEl)
        .setName("Cursor Color (Light Theme)")
        .addColorPicker((cp) => cp.setValue(this.plugin.settings.colorLight).onChange(set("colorLight")));

      new Setting(containerEl)
        .setName("Glow")
        .setDesc("Adds a soft glow around the cursor.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.glow).onChange(set("glow")));

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

      // ================= Blinking =================
      containerEl.createEl("h3", { text: "Blinking" });

      new Setting(containerEl)
        .setName("Blink Speed")
        .setDesc("How fast the cursor blinks. Set to 0 to keep it always on.")
        .addSlider((s) => s.setLimits(0, 3, 0.1).setValue(this.plugin.settings.blinkSpeed).setDynamicTooltip().onChange(set("blinkSpeed")));

      new Setting(containerEl)
        .setName("Blink Balance")
        .setDesc("How the blink cycle is split between lit and dark. Lower keeps it dark longer, higher keeps it lit longer.")
        .addSlider((s) => s.setLimits(0.1, 0.9, 0.05).setValue(this.plugin.settings.blinkOnOffBalance).setDynamicTooltip().onChange(set("blinkOnOffBalance")));

      new Setting(containerEl)
        .setName("Hide Real Cursor")
        .setDesc("Hides your browser's normal text cursor so only the custom one shows.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.hideNativeCaret).onChange(set("hideNativeCaret")));

      new Setting(containerEl)
        .setName("Don't Blink While Typing")
        .setDesc("Keeps the cursor fully lit while you type or move it, instead of blinking.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.smoothStopBlinking).onChange(set("smoothStopBlinking")));

      // ================= Smooth Cursor =================
      containerEl.createEl("h3", { text: "Smooth Movement" });

      new Setting(containerEl)
        .setName("Smooth Movement")
        .setDesc("Makes the cursor glide to its new spot instead of jumping there instantly.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.smoothEnabled).onChange(set("smoothEnabled")));

      new Setting(containerEl)
        .setName("Glide Amount")
        .setDesc("How much the cursor eases into movement. Higher feels heavier and lags a bit more.")
        .addSlider((s) => s.setLimits(0.05, 0.30, 0.05).setValue(this.plugin.settings.smoothness).setDynamicTooltip().onChange(set("smoothness")));

      new Setting(containerEl)
        .setName("Catch-Up Speed")
        .setDesc("How fast the cursor catches up to where you're typing.")
        .addSlider((s) => s.setLimits(0.30, 0.80, 0.05).setValue(this.plugin.settings.catchUpSpeed).setDynamicTooltip().onChange(set("catchUpSpeed")));

      new Setting(containerEl)
        .setName("Max Catch-Up Speed")
        .setDesc("The fastest the cursor is allowed to catch up when you type quickly.")
        .addSlider((s) => s.setLimits(0.50, 1.0, 0.05).setValue(this.plugin.settings.maxCatchUpSpeed).setDynamicTooltip().onChange(set("maxCatchUpSpeed")));

      new Setting(containerEl)
        .setName("Speed Up When Typing Fast")
        .setDesc("Automatically raises the catch-up speed the faster you type, up to the max above.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.smoothAdaptive).onChange(set("smoothAdaptive")));

      new Setting(containerEl)
        .setName("Movement Delay")
        .setDesc("Adds a short delay, in milliseconds, before the cursor starts following you.")
        .addSlider((s) => s.setLimits(0, 500, 10).setValue(this.plugin.settings.moveDelayMs).setDynamicTooltip().onChange(set("moveDelayMs")));

      // ================= After Effects =================
      containerEl.createEl("h3", { text: "After Effects" });

      new Setting(containerEl)
        .setName("Popping Letters")
        .setDesc("Makes letters pop and fly off whenever you type.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.popLetters).onChange(set("popLetters")));

      new Setting(containerEl)
        .setName("Pixel Trail")
        .setDesc("Leaves a fading trail of small blocks behind the cursor as it moves.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.flameTrail).onChange(set("flameTrail")));

      new Setting(containerEl)
        .setName("Motion Smear")
        .setDesc("Stretches the cursor in the direction it's moving, like a smear.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.smear).onChange(set("smear")));

      new Setting(containerEl)
        .setName("Smear Duration")
        .setDesc("How long the smear effect lasts, in milliseconds.")
        .addSlider((s) => s.setLimits(20, 300, 5).setValue(this.plugin.settings.smearDurationMs).setDynamicTooltip().onChange(set("smearDurationMs")));

      new Setting(containerEl)
        .setName("Trail Length")
        .setDesc("How many past positions the trail remembers.")
        .addSlider((s) => s.setLimits(0, 30, 1).setValue(this.plugin.settings.trailLength).setDynamicTooltip().onChange(set("trailLength")));

      new Setting(containerEl)
        .setName("Trail Fade Time")
        .setDesc("How long it takes for the trail to fully fade away, in milliseconds.")
        .addSlider((s) => s.setLimits(50, 1500, 25).setValue(this.plugin.settings.trailFadeMs).setDynamicTooltip().onChange(set("trailFadeMs")));
    }

    // ================= Torch =================
    if (this.plugin.settings.cursorStyle === "Torch") {
      containerEl.createEl("h3", { text: "Torch" });

      containerEl.createEl("h4", { text: "Spotlight" });

      new Setting(containerEl)
        .setName("Follow")
        .setDesc("What the light follows: your text cursor, your mouse, or both automatically.")
        .addDropdown((d) =>
          d
            .addOptions({ caret: "Text Cursor Only", mouse: "Mouse Pointer Only", auto: "Auto Intelligent Swap" })
            .setValue(this.plugin.settings.overlayFollowMode)
            .onChange(set("overlayFollowMode"))
        );

      new Setting(containerEl)
        .setName("Light Size")
        .setDesc("How big the lit-up circle is, in pixels.")
        .addSlider((s) => s.setLimits(100, 800, 10).setValue(this.plugin.settings.overlayRadius).setDynamicTooltip().onChange(set("overlayRadius")));

      new Setting(containerEl)
        .setName("Light Color")
        .addColorPicker((cp) => cp.setValue(this.plugin.settings.overlayColor).onChange(set("overlayColor")));

      new Setting(containerEl)
        .setName("Follow Speed")
        .setDesc("How quickly the light chases its target. Lower is slower and floatier.")
        .addSlider((s) => s.setLimits(0.05, 1, 0.05).setValue(this.plugin.settings.overlaySpeed).setDynamicTooltip().onChange(set("overlaySpeed")));

      containerEl.createEl("h4", { text: "Environment" });

      new Setting(containerEl)
        .setName("Darkness")
        .setDesc("How dark the area outside the light is.")
        .addSlider((s) => s.setLimits(0.2, 1, 0.01).setValue(this.plugin.settings.overlayDarkness).setDynamicTooltip().onChange(set("overlayDarkness")));

      new Setting(containerEl)
        .setName("Glow Strength")
        .setDesc("How bright the light is at its center.")
        .addSlider((s) => s.setLimits(0, 1, 0.05).setValue(this.plugin.settings.overlayIntensity).setDynamicTooltip().onChange(set("overlayIntensity")));

      new Setting(containerEl)
        .setName("Flicker")
        .setDesc("Adds a subtle candle-like flicker to the light.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.overlayFlicker).onChange(set("overlayFlicker")));

      new Setting(containerEl)
        .setName("Keep Sidebars Lit")
        .setDesc("Keeps the sidebars visible instead of darkening them too.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.overlaySpareSidebars).onChange(set("overlaySpareSidebars")));

      containerEl.createEl("h4", { text: "Caret" });

      new Setting(containerEl)
        .setName("Ember Cursor")
        .setDesc("Gives the cursor a glowing orange ember look instead of a plain color.")
        .addToggle((toggle) => toggle.setValue(this.plugin.settings.overlayEmberCaret).onChange(set("overlayEmberCaret")));
    }
  }
}
