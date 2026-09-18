// the glyph's colour, the form-field mirror, the neighbouring glyph, Excalidraw, rounded corners, device pixels, serifs, glyph alpha.
// One of the files test/test.js runs in order; see test/lib.js.
const { Plugin, T, ok, section, later, makeEngine, makeCtx, caret, SPEED_LIFTOFF, D, renderPanel, makePathCtx } = require("../lib");

// ---------------------------------------------------------------------------
section("custom heat ramp: at rest the cursor is still yours");

{
  const mk = (over) => {
    const e = Object.create(Plugin.prototype);
    e.settings = Object.assign({}, T.DEFAULT_SETTINGS, {
      speedDemon: true, speedDemonGradient: true, colorDark: "#39ff14",
      speedHeatDark1: "#2b4a8f", speedHeatDark2: "#17b8c4",
      speedHeatDark3: "#ff9a2e", speedHeatDark4: "#fff3d0",
    }, over);
    e.styleFor = (k) => e.settings[k];
    e.isDarkTheme = () => true;
    e.heat = 0;
    return e;
  };
  const e = mk({});
  const at = (h) => { e.heat = h; return e.heatColor(h, e.getBaseColor()); };

  // The reported bug: heat decays to zero after a few seconds of silence, so a
  // custom ramp replaced the cursor's colour with stage 1 most of the time.
  ok("at rest the cursor is its own colour", at(0) === "#39ff14", at(0));
  ok("...not stage 1", at(0) !== e.settings.speedHeatDark1);

  // All four stages must stay reachable - the fix compresses them into what's
  // left of the range rather than sacrificing one.
  ok("stage 1 lands exactly at liftoff",
     at(SPEED_LIFTOFF) === e.settings.speedHeatDark1, at(SPEED_LIFTOFF));
  ok("stage 4 still lands at full heat",
     at(1) === e.settings.speedHeatDark4, at(1));
  ok("stage 2 and 3 are passed through",
     at(0.4) !== at(0.7) && at(0.4) !== at(1), { a: at(0.4), b: at(0.7) });

  // No snap on the first keystroke - that was the reason the old code couldn't
  // just special-case heat 0.
  const steps = [0, 0.02, 0.04, 0.06, 0.08, 0.10, SPEED_LIFTOFF].map(at);
  ok("it eases out of the cursor colour rather than snapping",
     new Set(steps).size === steps.length, steps);
  ok("...and every step is a valid colour",
     steps.every((c) => /^#[0-9a-f]{6}$/.test(c)), steps);

  // Monotonic-ish: the blend must move steadily toward stage 1, not wander.
  const dist = (a, b) => {
    const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };
  const toStage1 = steps.map((c) => dist(c, e.settings.speedHeatDark1));
  ok("the blend closes on stage 1 the whole way",
     toStage1.every((d, i) => i === 0 || d <= toStage1[i - 1] + 1e-9),
     toStage1.map((d) => Math.round(d)));

  // A cursor with a different colour rests as THAT colour, so this is really
  // reading the cursor and not a coincidence of the default.
  const blue = mk({ colorDark: "#4477ff" });
  blue.heat = 0;
  ok("a differently-coloured cursor rests as itself",
     blue.heatColor(0, blue.getBaseColor()) === "#4477ff");

  // "Keep cursor color" still wins outright - it means no heat on the caret at
  // all, which the liftoff blend must not quietly reintroduce.
  const keep = mk({ speedDemonNoCursorHeat: true });
  keep.heat = 1;
  ok("Keep Cursor Color is still absolute",
     keep.getActiveColor() === "#39ff14", keep.getActiveColor());
}

// ---------------------------------------------------------------------------
section("readableGlyphColor: the character inside a filled Box");

{
  const { parseColorTuple, contrastRatio, readableGlyphColor, GLYPH_MIN_CONTRAST } = T;

  ok("parses #rrggbb", String(parseColorTuple("#3182ed")) === "49,130,237");
  ok("parses #rgb", String(parseColorTuple("#abc")) === "170,187,204");
  ok("parses rgb()", String(parseColorTuple("rgb(29, 79, 174)")) === "29,79,174");
  ok("rejects junk rather than guessing", parseColorTuple("nonsense") === null);
  ok("rejects null", parseColorTuple(null) === null);
  ok("survives junk with a usable colour", /^#|^rgb/.test(readableGlyphColor("nonsense")));

  const cr = (box) => contrastRatio(parseColorTuple(readableGlyphColor(box, "tinted")), parseColorTuple(box));

  // The two cases from the bug report. Both were legible-by-luck before:
  // the old code inverted the TEXT colour and never looked at the box.
  ok("the reported blue box clears the floor", cr("rgb(29, 79, 174)") >= GLYPH_MIN_CONTRAST,
     cr("rgb(29, 79, 174)"));
  ok("the Vim-visual yellow box clears it too", cr("#e3cb31") >= GLYPH_MIN_CONTRAST,
     cr("#e3cb31"));

  // Mid-grey is the case plain inversion cannot solve at all: #808080 inverts
  // to within one unit of itself.
  ok("mid-grey is not left inverting onto itself", cr("#808080") >= GLYPH_MIN_CONTRAST,
     cr("#808080"));

  // These four picked the WRONG pole under a naive `luminance < 0.5` test and
  // came out at 2.4-4.1:1. They exist to keep that shortcut from creeping back.
  for (const box of ["#c792ea", "#3182ed", "#ed3131", "#499bf3"]) {
    ok("pole chosen by measurement, not by luminance < 0.5: " + box,
       cr(box) >= GLYPH_MIN_CONTRAST, cr(box));
  }

  // A colour whose inverse already clears the floor keeps that inverse
  // untouched - the floor is a backstop, not a replacement for the look.
  // Mode "tinted" only - the default is now the neutral flip, which never
  // preserves the inverse.
  ok("in auto, a passing inverse is left alone",
     readableGlyphColor("#fff6bd", "tinted") === "rgb(0, 9, 66)",
     readableGlyphColor("#fff6bd", "tinted"));

  // Every colour must be satisfiable. The hardest box sits at the contrast
  // crossover (L ~ 0.179) where both poles tie at ~4.58:1, so a floor of 4.5
  // is reachable everywhere and anything above ~4.58 would not be.
  ok("the floor stays under the universally reachable ceiling",
     GLYPH_MIN_CONTRAST <= 4.58, GLYPH_MIN_CONTRAST);

  let worst = Infinity, worstAt = null;
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const box = `rgb(${r}, ${g}, ${b})`;
        const c = contrastRatio(parseColorTuple(readableGlyphColor(box, "tinted")), [r, g, b]);
        if (c < worst) { worst = c; worstAt = box; }
      }
    }
  }
  ok("no colour in a full sweep falls below the floor",
     worst >= GLYPH_MIN_CONTRAST - 1e-9, { worst, worstAt });

  // --- the three Letter Color modes --------------------------------------
  //
  // "contrast" is the default because RGB inversion rotates a colour to its
  // COMPLEMENT rather than to a neutral. A green cursor inverts to magenta,
  // which clears the contrast floor comfortably (4.85:1) and still looks
  // wrong - the bug that prompted this setting. Black on the same box
  // measures 13:1, so the neutral is not a trade of legibility for
  // neutrality; it wins on both.
  const GREENS = ["#4fe87d", "#00ff00", "#39ff14", "#7bd88f", "#a6e3a1"];
  const isNeutral = (str) => {
    const [r, g, b] = parseColorTuple(str);
    return r === g && g === b;
  };
  const isMagenta = (str) => {
    const [r, g, b] = parseColorTuple(str);
    return r > g && b > g;
  };

  for (const box of GREENS) {
    ok(`contrast gives a neutral on ${box}`,
       isNeutral(readableGlyphColor(box, "contrast")), readableGlyphColor(box, "contrast"));
    ok(`...black, on a bright green`,
       readableGlyphColor(box, "contrast") === "rgb(0, 0, 0)");
    // The mode that produced the complaint still behaves as documented - it
    // is offered deliberately, not left in by accident.
    ok(`auto still tints ${box} toward the complement`,
       isMagenta(readableGlyphColor(box, "tinted")), readableGlyphColor(box, "tinted"));
    // ...and the neutral genuinely out-reads it, not just out-tastes it.
    const cN = contrastRatio(parseColorTuple(readableGlyphColor(box, "contrast")), parseColorTuple(box));
    const cA = contrastRatio(parseColorTuple(readableGlyphColor(box, "tinted")), parseColorTuple(box));
    ok(`contrast out-reads auto on ${box}`, cN > cA, { cN, cA });
  }

  // "invert" is raw, with no floor - that is the point of offering it, and
  // mid-grey inverting to itself is the honest consequence.
  ok("invert is a plain flip", readableGlyphColor("#00ff00", "invert") === "rgb(255, 0, 255)");
  ok("...with no contrast floor applied",
     contrastRatio(parseColorTuple(readableGlyphColor("#808080", "invert")),
                   parseColorTuple("#808080")) < 1.1);

  // Contrast mode must never be illegible, for any colour at all.
  let cWorst = Infinity, cAt = null;
  for (let r = 0; r < 256; r += 9) for (let g = 0; g < 256; g += 9) for (let b = 0; b < 256; b += 9) {
    const box = `rgb(${r}, ${g}, ${b})`;
    const c = contrastRatio(parseColorTuple(readableGlyphColor(box, "contrast")), [r, g, b]);
    if (c < cWorst) { cWorst = c; cAt = box; }
  }
  ok("contrast mode clears the floor for every colour",
     cWorst >= GLYPH_MIN_CONTRAST - 1e-9, { cWorst, cAt });

  // Default and unknown both land on the neutral, so a share code written
  // before this key existed imports as the good behaviour.
  ok("the default mode is contrast", T.DEFAULT_SETTINGS.glyphColorMode === "contrast");
  ok("an absent mode falls back to the neutral",
     readableGlyphColor("#00ff00") === "rgb(0, 0, 0)");
  ok("an unknown mode falls back to the neutral",
     readableGlyphColor("#00ff00", "nonsense") === "rgb(0, 0, 0)");
}

// ---------------------------------------------------------------------------
section("form-field mirror: what the caret's position is measured against");

// The mirror technique reproduces a form field's text layout in an offscreen
// div and reads back where the caret lands. It is only ever as right as the
// list of properties it copies - anything that moves a glyph horizontally and
// is NOT copied lays the text out somewhere the real field does not put it,
// and the caret is drawn there.
//
// textAlign was missing, which put the caret at the left edge of every
// right-aligned field (Word-Smith's goal target cells) - measured at 135px of
// error on a 160px box in a real renderer. The geometry itself needs a browser
// to check (probes/form-mirror.html); what IS checkable here is the rule that
// failed: the property list, and what the mirror is sized by.
{
  const proto = T.EngineProto;
  // Records every style write the mirror receives.
  const run = (over = {}, elOver = {}) => {
    const written = {};
    // Everything the mirror is handed, in order: text node, marker, text node.
    const appended = [];
    const mirror = {
      style: new Proxy({}, { set: (t, k, v) => { written[k] = v; t[k] = v; return true; } }),
      // Obsidian's helper, which the mirror uses for the styles it sets
      // itself (as against the ones it copies); the same recorder sees them.
      setCssStyles(styles) { for (const k in styles) this.style[k] = styles[k]; },
      setAttribute() {}, remove() {},
      appendChild(node) { appended.push(node); },
      // Obsidian's createSpan: the marker, appended where it is made.
      createSpan() { appended.push(marker); return marker; },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 20 }),
      set textContent(v) { this._t = v; },
      get textContent() { return this._t; },
    };
    const style = Object.assign({
      boxSizing: "border-box", width: "160px", height: "22px",
      paddingLeft: "6px", paddingRight: "6px", paddingTop: "0px", paddingBottom: "0px",
      borderLeftWidth: "1px", borderRightWidth: "1px",
      borderTopWidth: "1px", borderBottomWidth: "1px",
      fontSize: "13px", lineHeight: "20px", fontFamily: "sans-serif",
      // plaintext because that is what Obsidian's app.css puts on every input.
      textAlign: "right", direction: "ltr", unicodeBidi: "plaintext",
    }, over);
    const marker = {
      style: {}, setCssStyles(styles) { Object.assign(this.style, styles); },
      getBoundingClientRect: () => ({ left: 40, top: 0 }),
    };
    const doc = {
      createTextNode: (t) => ({ t }),
      // Obsidian's createDiv on the body: the mirror, made attached.
      body: { createDiv() { return mirror; } },
      defaultView: { getComputedStyle: () => style },
    };
    const el = Object.assign({
      ownerDocument: doc, tagName: "INPUT", value: "1200",
      selectionStart: 4, selectionEnd: 4, selectionDirection: "none",
      clientWidth: 158, scrollLeft: 0, scrollTop: 0,
      getBoundingClientRect: () => ({ left: 100, top: 50, right: 260, bottom: 72, height: 22 }),
    }, elOver);
    const engine = Object.create(proto);
    const out = proto.formFieldCaretCoords.call(engine, el);
    return { written, out, appended, marker };
  };

  const { written, out } = run();
  ok("the mirror is handed a position", !!out && Number.isFinite(out.left), out);

  // The rule, stated as a rule: every property that can move a glyph sideways.
  for (const p of ["textAlign", "direction", "letterSpacing", "wordSpacing",
                   "textIndent", "textTransform", "fontFamily", "fontSize",
                   "fontWeight", "fontStyle", "paddingLeft", "paddingRight",
                   "borderLeftWidth", "borderRightWidth"]) {
    // Key presence, not value: the stub style does not define every one of
    // them, and what is being tested is that the property is on the copy list.
    ok(`the mirror copies ${p}`, Object.prototype.hasOwnProperty.call(written, p), Object.keys(written));
  }

  // Sized by the content box, computed from clientWidth - which is content +
  // padding and excludes border and scrollbar - rather than by copying
  // box-sizing and width across. Copying them is only correct under
  // content-box, and every Obsidian field is border-box.
  ok("the mirror is content-box", written.boxSizing === "content-box", written.boxSizing);
  ok("...sized from clientWidth minus padding", written.width === "146px", written.width);
  {
    const wide = run({}, { clientWidth: 300 });
    ok("...and follows the field's real content width", wide.written.width === "288px", wide.written.width);
  }
  // A field CSS has collapsed to nothing must not produce a negative width.
  {
    const tiny = run({}, { clientWidth: 4 });
    ok("a collapsed field clamps at zero", tiny.written.width === "0px", tiny.written.width);
  }

  // Alignment must reach the mirror verbatim, not be normalised away.
  for (const align of ["left", "right", "center", "start", "end"]) {
    const r = run({ textAlign: align });
    ok(`textAlign "${align}" reaches the mirror`, r.written.textAlign === align, r.written.textAlign);
  }

  // ---- issue #28: which END of the box the paragraph starts from ----------
  //
  // Obsidian's app.css carries a bare `input { unicode-bidi: plaintext }`, so
  // every field in the app resolves its direction from its OWN CONTENT and
  // `direction` alone cannot see it. Without this the mirror stayed an LTR
  // paragraph while the real field flipped to RTL, and the caret was drawn
  // hundreds of pixels away, at the far end of the text's own width. The
  // geometry is probes/rtl-form-mirror.html; the rule is here.
  ok("the mirror copies unicodeBidi",
     Object.prototype.hasOwnProperty.call(written, "unicodeBidi"), Object.keys(written));
  for (const ub of ["plaintext", "isolate", "normal"]) {
    const r = run({ unicodeBidi: ub });
    ok(`unicodeBidi "${ub}" reaches the mirror`, r.written.unicodeBidi === ub, r.written.unicodeBidi);
  }

  // The four border widths on the copy list are inert on their own:
  // border-style defaults to none, which computes every one of them back to
  // 0px, so the mirror's content box sat a border-width inside the field's.
  ok("the mirror's copied borders are live", written.borderStyle === "solid", written.borderStyle);

  // The whole value is laid out, split at the caret. Under plaintext the
  // paragraph direction is the first STRONG character of the content, so a
  // prefix that has none - caret at 0, or a value opening with digits -
  // answers LTR where the real field answers RTL. It also fixes a case with
  // no bidi in it at all: a right-aligned field places its line from the FULL
  // text's width, which a prefix on its own cannot reproduce.
  {
    const r = run({}, { value: "abcdef", selectionStart: 2, selectionEnd: 2 });
    const text = r.appended.filter((n) => n && typeof n.t === "string").map((n) => n.t);
    ok("the mirror is handed the prefix", text[0] === "ab", text);
    ok("...and the suffix as well", text[1] === "cdef", text);
    ok("...with the marker between them", r.appended.indexOf(r.marker) === 1, r.appended.length);
  }

  // A zero-width inline-block, not a ZWSP. U+200B is bidi class BN, which
  // UAX#9 deletes outright and leaves the engine to place; beside a digit run
  // inside an RTL paragraph that is not where the caret goes. An atomic
  // inline is U+FFFC to the algorithm - a neutral with a defined resolution.
  //
  // It has to be aligned as well as sized. An EMPTY inline-block's baseline is
  // its own bottom margin edge, so left alone it hangs at the text baseline -
  // 14px below the line on a 22px line box. An <input> cannot see that, since
  // it takes its Y from the field's own box; a <textarea> takes its Y from the
  // marker's top and would drop every caret by most of a line.
  {
    const { marker } = run();
    ok("the marker is an atomic inline", marker.style.display === "inline-block", marker.style);
    ok("...with no width of its own", marker.style.width === "0", marker.style);
    ok("...pinned to the top of the line box", marker.style.verticalAlign === "top", marker.style);
    ok("...and no character to be reordered", !marker.textContent, marker.textContent);
  }

  // The result is still clamped inside the field, which is what keeps a caret
  // scrolled out of a long single-line input from drawing outside it.
  {
    const far = run({}, { getBoundingClientRect: () => ({ left: 100, top: 50, right: 130, bottom: 72, height: 22 }) });
    ok("the caret stays inside the field's box",
       far.out.left >= 100 && far.out.left <= 130, far.out.left);
  }

  // A textarea takes its Y from the mirror; an input is centred in its own
  // box instead, because a div cannot reproduce a UA's internal centring.
  {
    const ta = run({}, { tagName: "TEXTAREA" });
    ok("a textarea wraps at the content width", ta.written.width === "146px", ta.written.width);
    ok("...and does not have its height forced to auto", ta.written.height !== "auto", ta.written.height);
  }
  ok("an input's mirror height is auto", written.height === "auto", written.height);
}

// ---------------------------------------------------------------------------
section("adjacentCharRect: which side of the neighbouring glyph the caret is on");

// The contentEditable half of #28. This function measures a real one-character
// span next to the caret rather than a collapsed point, because a collapsed
// rect reports tight font metrics instead of the line box and the caret came
// out the wrong HEIGHT. It then took the caret's X from that character's edge
// too - "the caret sits after this character, so anchor to its right edge" -
// which is true in LTR and exactly backwards in RTL, and in bidi text is not
// decidable from the offset at all. Measured at a full character width of
// error on every RTL offset. The X now comes from a collapsed range, which is
// the engine's own answer; the height still comes from the character.
{
  const proto = T.EngineProto;
  const DEGENERATE = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  // `rects(startOffset, isCollapsed)` decides what each range measures.
  const mkDoc = (rects) => ({
    createRange: () => {
      let start = null, collapsed = false;
      return {
        setStart(n, o) { start = o; },
        setEnd() {},
        collapse() { collapsed = true; },
        getClientRects() { const r = rects(start, collapsed); return r ? [r] : []; },
        getBoundingClientRect() { return rects(start, collapsed) || DEGENERATE; },
      };
    },
  });
  const node = { nodeType: 3, data: "abcdef" };
  const CHAR = { left: 200, right: 260, top: 10, bottom: 27, width: 60, height: 17 };
  const call = (doc, offset) => proto.adjacentCharRect.call(Object.create(proto), doc, node, offset);

  // Mid-text: the character AFTER the caret is measured for the vertical.
  {
    const doc = mkDoc((s, c) => (c ? { left: 100, top: 0, right: 100, bottom: 0, width: 0, height: 17 } : CHAR));
    const r = call(doc, 3);
    ok("the caret's X is the collapsed range's", r.left === 100, r);
    ok("...and its top is the character's", r.top === 10, r);
    ok("...and its bottom too", r.bottom === 27, r);
  }
  // At a soft-wrap boundary the collapsed range answers for the end of the
  // line that wraps while the character after the caret is on the next
  // line; the caret the user sees is before that character. Its X must be
  // the character's left edge, not the collapsed range's.
  {
    const NEXT_LINE = { left: 20, right: 80, top: 34, bottom: 51, width: 60, height: 17 };
    const doc = mkDoc((s, c) => (c ? { left: 400, top: 10, right: 400, bottom: 27, width: 0, height: 17 } : NEXT_LINE));
    const r = call(doc, 3);
    ok("at a wrap, the caret is on the next character's line", r.top === 34 && r.bottom === 51, r);
    ok("...at that character's left edge, not the wrapped line's end", r.left === 20, r);
  }
  // At the end of the node, where the character BEFORE the caret is measured.
  // 1.4.8 returned that character's RIGHT edge, which in RTL is the far side.
  {
    const doc = mkDoc((s, c) => (c ? { left: 100, top: 0, right: 100, bottom: 0, width: 0, height: 17 } : CHAR));
    const r = call(doc, node.data.length);
    ok("at the end of a run the X is still the collapsed range's", r.left === 100, r);
    ok("...not the preceding glyph's far edge", r.left !== CHAR.right, r);
  }
  // No collapsed rect to be had: the character edges are still the fallback,
  // which is what the function did for its whole life before this.
  {
    const doc = mkDoc((s, c) => (c ? DEGENERATE : CHAR));
    ok("without a collapsed rect it falls back to the leading edge",
       call(doc, 3).left === CHAR.left, call(doc, 3));
    ok("...and to the trailing edge at the end of a run",
       call(doc, node.data.length).left === CHAR.right, call(doc, node.data.length));
  }
  // A range that throws must not take the tick loop with it.
  {
    const doc = { createRange: () => { throw new Error("no ranges here"); } };
    ok("a throwing range yields no rect rather than an exception", call(doc, 3) === null);
  }
  // Only text nodes have characters to measure.
  ok("an element node is declined outright", proto.adjacentCharRect.call(
     Object.create(proto), mkDoc(() => CHAR), { nodeType: 1 }, 0) === null);
}

// ---------------------------------------------------------------------------
section("isExcalidrawCaretHost: staying off other plugins' carets");

{
  const isExcali = T.EngineProto.isExcalidrawCaretHost;
  // Minimal stand-in for the workspace, so the DOM branch is tested in
  // isolation from the view-type fallback.
  // `inside` decides what the active leaf holds at all and `content` what its
  // content box holds. The two differ only over the chrome the container adds
  // around the content, which is exactly what the title-bar case turns on. The
  // default - everything, with the content box holding all of it - keeps the
  // fallback's original meaning, and a test that cares passes its own.
  // The engine asks the workspace for the active view (getActiveViewOfType,
  // the API that replaced the deprecated activeLeaf), so that is what the
  // fake answers.
  const engine = (viewType, inside = () => true, content = inside) => ({
    app: {
      workspace: {
        getActiveViewOfType: () => viewType
          ? {
              getViewType: () => viewType,
              containerEl: { contains: inside },
              contentEl: { contains: content },
            }
          : null,
      },
    },
  });
  // A view that exposes no contentEl at all - not an ItemView - so the
  // fallback has to scope by the container and subtract the header itself.
  const containerOnly = (inside = () => true) => ({
    app: {
      workspace: {
        getActiveViewOfType: () => ({ getViewType: () => "excalidraw", containerEl: { contains: inside } }),
      },
    },
  });
  // closest() is the only DOM call the method makes; `matches` is the set of
  // selectors this fake element should claim to be inside.
  const el = (matches, className = "") => ({
    closest: (sel) => (matches.some((m) => sel.includes(m)) ? {} : null),
    classList: { contains: (c) => className.split(" ").includes(c) },
  });

  const call = (e, node) => isExcali.call(e, node);

  ok("a plain textarea is left alone", call(engine("markdown"), el([])) === false);
  ok("null element is safe", call(engine("markdown"), null) === false);

  ok("Excalidraw's container is detected",
     call(engine("markdown"), el([".excalidraw"])) === true);
  ok("the wysiwyg textarea is detected by class",
     call(engine("markdown"), el([], "excalidraw-wysiwyg")) === true);

  // The case the view-type check alone would miss: a drawing embedded in a
  // note, where the leaf is still a markdown view.
  ok("an embed inside a markdown leaf is still caught",
     call(engine("markdown"), el([".excalidraw-wrapper"])) === true);

  // ...and the reverse: a field INSIDE a full Excalidraw leaf is caught even
  // if the container classes are renamed out from under the selector.
  ok("a field inside a full Excalidraw leaf is caught without the DOM match",
     call(engine("excalidraw"), el([])) === true);

  // Issues #26 and #27. The fallback used to ignore the element entirely, so
  // with a drawing as the active tab every text field in the app answered
  // yes - and since the caret-color carve-out only reaches Excalidraw's own
  // textarea, those fields were left with no caret from either source.
  const outside = engine("excalidraw", () => false);
  ok("the rename dialog is NOT claimed while a drawing is the active tab",
     call(outside, el([])) === false);
  ok("...nor the settings search box",
     call(outside, el([])) === false);
  // ...but a drawing embedded in a note still is, via the DOM branch, even
  // though that modal-vs-leaf test would say no.
  ok("...while an embed inside the same leaf still is",
     call(outside, el([".excalidraw"])) === true);

  // The #26 follow-up, and the reason the scope is contentEl rather than
  // containerEl: the tab title bar is INSIDE the active leaf's container but
  // outside its content, and `.view-header-title` is permanently
  // contentEditable because clicking it renames the file. Scoping by the
  // container claimed it, so renaming from there lost its caret exactly the
  // way the modals had.
  const drawingActive = engine("excalidraw", () => true, (node) => node.inContent === true);
  const titleBar = Object.assign(el([".view-header"]), { inContent: false });
  const onCanvas = Object.assign(el([]), { inContent: true });
  ok("the tab title bar is NOT claimed while a drawing is the active tab",
     call(drawingActive, titleBar) === false);
  ok("...while a field inside the drawing itself still is",
     call(drawingActive, onCanvas) === true);

  // Same rule on the no-contentEl fallback, which has to subtract the header
  // by selector because it has no content box to name.
  ok("the container fallback claims a field inside the leaf",
     call(containerOnly(), el([])) === true);
  ok("...but not the tab title bar",
     call(containerOnly(), el([".view-header"])) === false);
  ok("...and not something the container itself excludes",
     call(containerOnly(() => false), el([])) === false);

  // A view with no containerEl at all must fail closed rather than throw.
  const noContainer = {
    app: { workspace: { getActiveViewOfType: () => ({ getViewType: () => "excalidraw" }) } },
  };
  ok("a view with no containerEl is safe", call(noContainer, el([])) === false);

  // A thrown closest() must not take the tick loop with it - and must not
  // pass in silence either: the guard reports once (see _reportOnce).
  const boom = { closest: () => { throw new Error("boom"); }, classList: null };
  const loud = Object.assign(engine("markdown"), { reports: [], _reportOnce(site, e) { this.reports.push([site, e.message]); } });
  ok("a throwing element degrades to false", call(loud, boom) === false);
  ok("...and reports the throw, naming the site", loud.reports.length === 1 && loud.reports[0][0] === "isExcalidrawCaretHost" && loud.reports[0][1] === "boom", loud.reports);

  // The cache keys on element identity, so a second element must not inherit
  // the first one's answer.
  const e2 = engine("markdown");
  const exc = el([".excalidraw"]);
  const plain = el([]);
  call(e2, exc);
  ok("the identity cache does not leak across elements", call(e2, plain) === false);
  ok("...and still reports the original correctly", call(e2, exc) === true);
}

// ---------------------------------------------------------------------------
section("Rounded Corners");

// Records path construction so the shape can be inspected without a canvas.

{
  const mk = (over) => {
    const e = makeEngine(over);
    e.ctx = makePathCtx();
    e.smearCorners = () => null;
    return e;
  };
  const rect = { tl: { x: 0, y: 0 }, tr: { x: 10, y: 0 }, br: { x: 10, y: 30 }, bl: { x: 0, y: 30 } };

  // --- cornerRadius: off, thin, block ------------------------------------
  ok("radius is 0 when the toggle is off",
     mk({ cursorRounded: false }).cornerRadius(24) === 0);

  // A Line stem (2-3px) and an Underline bar are thin: they capsule.
  const on = mk({ cursorRounded: true });
  ok("a 3px stem capsules (half its width)", on.cornerRadius(3) === 1.5, on.cornerRadius(3));
  ok("a 2px stem capsules", on.cornerRadius(2) === 1, on.cornerRadius(2));
  // A Box's narrow axis is its char width: softened, not capsuled.
  ok("an 8px box softens rather than capsuling",
     on.cornerRadius(8) === 2, on.cornerRadius(8));
  ok("...and stays well under half the axis", on.cornerRadius(8) < 4);
  ok("a zero axis yields no radius", on.cornerRadius(0) === 0);
  ok("a negative axis yields no radius", on.cornerRadius(-5) === 0);
  // The radius can never exceed half the minor axis, or arcTo self-intersects.
  for (const m of [1, 2, 5, 6, 7, 12, 40]) {
    ok(`radius <= half the axis at ${m}`, on.cornerRadius(m) <= m / 2 + 1e-9, on.cornerRadius(m));
  }

  // --- traceQuad: sharp vs rounded ---------------------------------------
  {
    const e = mk({ cursorRounded: false });
    e.ctx.beginPath();
    e.traceQuad(e.ctx, rect, 0);
    const kinds = e.ctx.ops.map((o) => o.op);
    ok("sharp path uses moveTo/lineTo only",
       kinds.filter((k) => k === "arcTo").length === 0 && kinds.includes("lineTo"), kinds);
  }
  {
    const e = mk({ cursorRounded: true });
    e.ctx.beginPath();
    e.traceQuad(e.ctx, rect, 2);
    const arcs = e.ctx.ops.filter((o) => o.op === "arcTo");
    ok("rounded path emits one arc per corner", arcs.length === 4, arcs.length);
    ok("...all at the requested radius", arcs.every((a) => a.r === 2));
    ok("...and never uses roundRect (iOS 16.4 / Chromium 99 only)",
       e.ctx.ops.every((o) => o.op !== "roundRect"));
  }

  // The radius is clamped to the QUAD's shortest edge, not the resting rect's.
  // A hard smear can make one edge tiny; a radius sized for the box would fold
  // the corners through each other.
  {
    const e = mk({ cursorRounded: true });
    const sheared = { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 40, y: 60 }, bl: { x: 37, y: 60 } };
    e.ctx.beginPath();
    e.traceQuad(e.ctx, sheared, 20);
    const arcs = e.ctx.ops.filter((o) => o.op === "arcTo");
    ok("a smeared quad clamps to its own shortest edge",
       arcs.length === 4 && arcs.every((a) => a.r <= 1.5 + 1e-9), arcs.map((a) => a.r));
  }

  // A degenerate quad must not emit NaN coordinates into the path.
  {
    const e = mk({ cursorRounded: true });
    const flat = { tl: { x: 5, y: 5 }, tr: { x: 5, y: 5 }, br: { x: 5, y: 5 }, bl: { x: 5, y: 5 } };
    e.ctx.beginPath();
    e.traceQuad(e.ctx, flat, 4);
    const nums = e.ctx.ops.flatMap((o) => [o.x, o.y, o.x1, o.y1, o.x2, o.y2, o.r]).filter((v) => v !== undefined);
    ok("a degenerate quad produces no NaN", nums.every((v) => Number.isFinite(v)), nums);
  }

  // --- trail ghosts follow the head --------------------------------------
  {
    const off = mk({ cursorRounded: false });
    off.fillTrailRect(off.ctx, 0, 0, 8, 20);
    ok("sharp trail ghosts stay plain fillRects",
       off.ctx.ops.length === 1 && off.ctx.ops[0].op === "fillRect", off.ctx.ops);

    const rnd = mk({ cursorRounded: true });
    rnd.fillTrailRect(rnd.ctx, 0, 0, 8, 20);
    ok("rounded trail ghosts are arc paths, not fillRects",
       rnd.ctx.ops.some((o) => o.op === "arcTo") && !rnd.ctx.ops.some((o) => o.op === "fillRect"),
       rnd.ctx.ops.map((o) => o.op));
  }
}

// The row has to actually appear in the panel. A row that throws while being
// built takes every row after it with it, which no engine-side test can see.
{
  for (const style of ["Line", "Box", "Underline"]) {
    const names = renderPanel({ cursorStyle: style }).map((r) => r.name);
    const i = names.indexOf("Rounded corners");
    ok(`the row renders for ${style}`, i > 0, names.slice(-4));
    ok(`...directly under Translucent for ${style}`, names[i - 1] === "Translucent", names[i - 1]);
  }
  // It's style-agnostic, so it must not be trapped inside a style's
  // sub-group: no indent class on its row, same as Translucent.
  const one = renderPanel({ cursorStyle: "Box" });
  const depthOf = (name) => one.find((r) => r.name === name).settingEl.classes.filter((c) => /^cursor-smith-sub/.test(c)).join();
  ok("it sits at the same level as Translucent", depthOf("Rounded corners") === "" && depthOf("Translucent") === "",
     [depthOf("Rounded corners"), depthOf("Translucent")]);
  // The arc must never escape the quad. arcTo insets its tangent points by
  // r / tan(theta/2), which for an acute corner is far larger than r - so a
  // radius clamped only by edge LENGTH runs past the next corner on a sheared
  // quad, and the path paints outside the shape (and outside the damage rect,
  // so it is never cleared). Motion Smear produces exactly those acute
  // corners, which is why Rounded Corners left stray artifacts.
  {
    const e = makeEngine({ cursorRounded: true });
    e.styleFor = (k) => e.settings[k];
    e.ctx = makePathCtx();
    e.smearCorners = () => null;
    const tangentOverrun = (q, r) => {
      const pts = [q.tl, q.tr, q.br, q.bl];
      let worst = -Infinity;
      for (let i = 0; i < 4; i++) {
        const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
        const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
        const v2x = next.x - cur.x, v2y = next.y - cur.y;
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        const th = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))));
        worst = Math.max(worst, r / Math.tan(th / 2) - Math.min(l1, l2) / 2);
      }
      return worst;
    };
    const radiusUsed = (q) => {
      const rec = [];
      const c = Object.assign({}, e.ctx, {
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        arcTo(x1, y1, x2, y2, r) { rec.push(r); },
      });
      e.traceQuad(c, q, 1.5);
      return rec.length ? rec[0] : 0;
    };

    const shapes = {
      resting: { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 3, y: 24 }, bl: { x: 0, y: 24 } },
      sheared60: { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 63, y: 24 }, bl: { x: 60, y: 24 } },
      sheared200: { tl: { x: 0, y: 0 }, tr: { x: 3, y: 0 }, br: { x: 203, y: 24 }, bl: { x: 200, y: 24 } },
      boxDiag: { tl: { x: 0, y: 0 }, tr: { x: 9, y: 0 }, br: { x: 49, y: 44 }, bl: { x: 40, y: 44 } },
    };
    for (const [name, q] of Object.entries(shapes)) {
      const r = radiusUsed(q);
      ok(`the arc stays inside the quad: ${name}`,
         r === 0 || tangentOverrun(q, r) <= 1e-6, { r, overrun: tangentOverrun(q, r) });
    }
    // A resting caret must still get its full rounding - the tighter clamp
    // must not have quietly switched the feature off.
    // Tolerance, not equality: the angle clamp routes a right-angled corner
    // through tan(pi/4), which is 1 only to within float error.
    ok("a resting caret keeps its full radius",
       Math.abs(radiusUsed(shapes.resting) - 1.5) < 1e-9, radiusUsed(shapes.resting));
    ok("...and a hard shear tightens rather than disabling it",
       radiusUsed(shapes.sheared60) > 0 && radiusUsed(shapes.sheared60) < 1.5,
       radiusUsed(shapes.sheared60));
  }
}

// ---------------------------------------------------------------------------
section("the letter in the box sits on device pixels");

// The caret's coordinates are fractional (coordsAtPos), and canvas text laid
// down at a fractional baseline is resampled across two rows of pixels: the
// letter inside the Box cursor looked soft next to the real one, which the
// browser snaps. The glyph is snapped to the canvas's device pixels - which
// are 1/dpr CSS pixels from the canvas REGION's origin, since resizeCanvas
// scales and offsets the context - so the snap has to know both.
{
  const drawGlyph = (dpr, region, caret) => {
    const e = makeEngine({ cursorStyle: "Box", showChar: true, blinkingEnabled: false, crtEffect: false, smoothEnabled: false });
    e.styleFor = (k) => e.settings[k];
    e._canvasDpr = dpr;
    e._canvasRect = region;
    e.trail = [];
    e.forEachTrailPoint = () => {};
    e.blinkAlpha = () => 1;
    e.glitchState = () => null;
    e.smearCorners = () => null;
    e.smearQuad = null;
    e.animActive = Object.assign({ w: 9, h: 22, actualCharWidth: 9, letterSpacing: 0, char: "t",
      fontSize: 16, fontFamily: "monospace", fontWeight: "normal", fontStyle: "normal" }, caret);
    e.lastActive = e.animActive;
    e.pending = null;
    const texts = [];
    e.ctx = Object.assign(makePathCtx(), {
      measureText: () => ({ fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 4 }),
      fillText(ch, x, y) { texts.push({ ch, x, y }); },
    });
    e.drawBoxCursor();
    return texts;
  };
  const onDevicePixel = (v, origin, dpr) => Math.abs(((v - origin) * dpr) - Math.round((v - origin) * dpr)) < 1e-9;

  const t1 = drawGlyph(1, { x: 0, y: 0, w: 300, h: 100 }, { x: 10.37, top: 20.61, bottom: 42.61 });
  ok("the glyph is drawn", t1.length === 1 && t1[0].ch === "t", t1);
  ok("...on a whole pixel at dpr 1", onDevicePixel(t1[0].x, 0, 1) && onDevicePixel(t1[0].y, 0, 1), t1[0]);
  ok("...within half a pixel of where the caret puts it",
     Math.abs(t1[0].x - (10.37 + 4.5)) <= 0.5 && Math.abs(t1[0].y - (20.61 + 12 + (22 - 16) / 2)) <= 0.5, t1[0]);

  // A fractional ratio with an offset region: the device grid does not
  // pass through CSS-pixel zero, and a snap that assumed it would land
  // between device rows again.
  const t2 = drawGlyph(1.25, { x: 13, y: 7, w: 300, h: 100 }, { x: 40.2, top: 30.3, bottom: 52.3 });
  ok("at dpr 1.25 with an offset region it lands on that grid",
     onDevicePixel(t2[0].x, 13, 1.25) && onDevicePixel(t2[0].y, 7, 1.25), t2[0]);
  ok("...and not on the CSS-pixel grid", !Number.isInteger(t2[0].x) || !Number.isInteger(t2[0].y), t2[0]);
}

// ---------------------------------------------------------------------------
section("removed features leave no keys behind");

{
  // Ink was removed, but unlike Text Crawl, CRT Inverted Trail and Matrix
  // Rain its four keys were left sitting in all six shipped presets - so
  // applying ANY preset wrote four settings nothing reads into the user's
  // data file, permanently. The generic check below is the one that matters:
  // it fails for the NEXT removal too, not just this one.
  const orphans = [];
  const scan = (label, obj) => {
    const src = (obj && obj.settings) || obj || {};
    for (const k of Object.keys(src)) {
      if (k === "name") continue;
      if (!(k in T.DEFAULT_SETTINGS)) orphans.push(label + "." + k);
    }
  };
  for (const [n, p] of Object.entries(T.DEFAULT_PRESETS)) scan(n, p);
  for (const [m, p] of Object.entries(T.PRESET1_VIM_MODES || {})) scan("vim:" + m, p);
  ok("no shipped preset carries a key nothing reads", orphans.length === 0, orphans);

  // ...and a config saved while Ink existed sheds them on the next load,
  // the same treatment the other three removals got.
  const stale = T.migrateLegacyKeys({
    inkEffect: true, inkColor: "#1a1a2e", inkOpacity: 0.55, inkPooling: true,
    cursorStyle: "Box",
  });
  ok("migrate drops inkEffect", !("inkEffect" in stale));
  ok("...inkColor", !("inkColor" in stale));
  ok("...inkOpacity", !("inkOpacity" in stale));
  ok("...inkPooling", !("inkPooling" in stale));
  ok("...without touching anything real", stale.cursorStyle === "Box");

  // Dropping them must not have changed what any preset actually looks like.
  const jello = T.presetWithDefaults(T.DEFAULT_PRESETS[T.DEFAULT_PRESET_NAME]);
  ok("the starter preset still resolves", !!jello && jello.cursorStyle === "Box");
  ok("...and carries no ink keys",
     Object.keys(jello).filter((k) => /^ink/.test(k)).length === 0);
}
