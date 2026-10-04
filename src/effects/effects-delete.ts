// Part of the plugin class, by effect (HANDOFF §1.17): the methods below are
// gathered into effectsMethods (effects.ts) and assigned onto
// CursorSmithPlugin.prototype, so every `this.x` read and every test reach
// them exactly as before. `this` is the plugin.
//
// What a deletion took, letter by letter, and where each letter stood - for
// the Pop effects that answer a deletion: Backspace disintegration (a burst
// in each letter's cell), Backspace evaporation (the letters rising away)
// and Back-man (the letters going into its mouth; when it is on, it has
// them, and the other two stand aside). Backspace takes the letters before the caret and moves it; Delete
// takes the letters after it and leaves it still - no move, no commit - so
// a commit (commitMove) and the frames the caret sits still (updateActivePoint)
// both hand the deletion here. By then the text is gone from the note, so
// the note as it was is kept (_deletionDoc) and the letters are read back
// from it - only when the change is exactly that deletion at the caret, on
// the caret's row, at most DELETION_MAX_CHARS long. Anything else (a paste
// over a selection, an undo, a change elsewhere) reads as nothing, and the
// burst falls back to the one it always made where the caret stood.
import type { CaretRecord, DeletedLetters } from "../types";
import type CursorSmithPlugin from "../plugin";

// A deletion longer than this is a selection wiped, not writing undone: its
// letters are not laid out one by one.
export const DELETION_MAX_CHARS = 40;

export const effectsDeleteMethods = {
  // Whether anything wants a deletion's letters: the Pop effects' three,
  // and Typewriter's X-out.
  _deletionFxOn(this: CursorSmithPlugin): boolean {
    return !!(this.look.popEffects && (this.look.backspaceEvaporate || this.look.backspaceDisintegrate)) || this._xoutOn() || this._backManOn();
  },

  // The note as it is now, for the next deletion to read from; kept only
  // while an effect wants it.
  _deletionRemember(this: CursorSmithPlugin) {
    let doc = null;
    if (this._deletionFxOn()) {
      try { doc = this.app.workspace.activeEditor?.editor?.cm?.state.doc ?? null; } catch { doc = null; /* an editor mid-teardown */ }
    }
    this._deletionDoc = doc;
  },

  // A frame the caret sat still: where Delete is seen. The note is kept
  // current either way.
  _deletionStill(this: CursorSmithPlugin, old: CaretRecord, now: CaretRecord) {
    if (!this._deletionFxOn()) { this._deletionDoc = null; return; }
    const doc = this.app.workspace.activeEditor?.editor?.cm?.state.doc ?? null;
    if (!doc || doc === this._deletionDoc) return;
    if (this._deletePending && performance.now() - this._deletePending < 250) {
      const along = this._deletionFx(old, now);
      // Letters that could not be read still get the burst, where the caret is.
      if (!along && this.look.popEffects && this.look.backspaceDisintegrate && typeof old.docLen === "number" && typeof now.docLen === "number" && now.docLen < old.docLen) {
        this.spawnFlamePixels(old, true);
      }
    }
    this._deletionDoc = doc;
  },

  // The effects for one deletion. True when the burst was laid along the
  // letters (or Back-man ate them), so the caller does not make the one
  // where the caret stood too.
  _deletionFx(this: CursorSmithPlugin, old: CaretRecord, now: CaretRecord): boolean {
    if (!this._deletionFxOn()) return false;
    const letters = this.deletedLetters(old, now);
    if (letters && this._xoutOn()) this.spawnXout(letters);
    if (this._backManOn()) {
      if (letters) this.spawnBackManMeal(letters);
      return true;
    }
    if (letters && this._evaporateOn()) this.spawnEvaporate(letters);
    if (!this.look.popEffects || !this.look.backspaceDisintegrate) return false;
    return this.spawnDisintegration(letters);
  },

  // `old` is the caret the deletion was made from, `now` where it is after:
  // before it (Backspace) or at the same place (Delete). The letters come
  // nearest the caret first, each with where it stood and how wide it was.
  deletedLetters(this: CursorSmithPlugin, old: CaretRecord, now: CaretRecord): DeletedLetters | null {
    const prev = this._deletionDoc;
    const view = this.app.workspace.activeEditor?.editor?.cm;
    if (!prev || !view) return null;
    if (typeof old.pos !== "number" || typeof now.pos !== "number") return null;
    const doc = view.state.doc;
    // The kept note must be the one `old` was measured in.
    if (typeof old.docLen === "number" && old.docLen !== prev.length) return null;
    const n = prev.length - doc.length;
    if (n <= 0 || n > DELETION_MAX_CHARS) return null;
    // Backspace takes [now.pos, old.pos); Delete takes n after the caret.
    const forward = now.pos === old.pos;
    if (!forward && old.pos - now.pos !== n) return null;
    const from = forward ? old.pos : now.pos, to = from + n;
    // ...and the note around it must be untouched: exactly that deletion.
    if (prev.sliceString(to, to + 24) !== doc.sliceString(from, from + 24)) return null;
    if (prev.sliceString(Math.max(0, from - 24), from) !== doc.sliceString(Math.max(0, from - 24), from)) return null;
    let text = prev.sliceString(from, to);
    // Only the row the caret stands on: nothing of a joined line break or
    // the line past it.
    if (forward) { const nl = text.indexOf("\n"); if (nl >= 0) text = text.slice(0, nl); }
    else { const nl = text.lastIndexOf("\n"); if (nl >= 0) text = text.slice(nl + 1); }
    if (!text) return null;
    const chars = [...text];
    const width = (ch: string) => (this.measureCharWidth(ch, old.fontFamily, old.fontSize, old.fontWeight, old.fontStyle) ?? old.actualCharWidth ?? 8) + (old.letterSpacing || 0);
    const letters = [];
    if (forward) {
      // Rightwards from the caret.
      const rowRight = typeof old.rowRight === "number" ? old.rowRight : Infinity;
      let x = old.x;
      for (const ch of chars) {
        const w = width(ch);
        if (x + w > rowRight + 1) break;
        letters.push({ char: ch, x, w });
        x += w;
      }
    } else {
      // Leftwards from where the caret stood.
      const rowLeft = typeof old.rowLeft === "number" ? old.rowLeft : -Infinity;
      let x = old.x;
      for (let k = chars.length - 1; k >= 0; k--) {
        const w = width(chars[k]);
        x -= w;
        if (x < rowLeft - 1) break;
        letters.push({ char: chars[k], x, w });
      }
    }
    return letters.length ? { letters, forward, old, from } : null;
  },
};
