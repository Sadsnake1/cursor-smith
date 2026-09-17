// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import type { Rect as CMRect } from "@codemirror/view";
import { DEFAULT_SETTINGS } from "./settings";

// The settings object: every key of DEFAULT_SETTINGS with its default's
// type, plus whatever a saved data.json or a migration carries on top.
export type CursorSmithSettings = typeof DEFAULT_SETTINGS & Record<string, any>;

// A rectangle in client (canvas) coordinates.
export interface Rect { x: number; y: number; w: number; h: number; [k: string]: any }

// Where a caret is, as caretCoords() measures it: the box, the row it sits
// on, the glyph under it and the font that glyph is set in. A secondary
// caret's record carries `empty` / `visible` too.
export interface CaretRecord {
  x: number;
  top: number;
  bottom: number;
  h: number;
  w: number;
  actualCharWidth?: number;
  rowLeft?: number | null;
  rowRight?: number | null;
  char?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  letterSpacing?: number;
  focused?: boolean;
  pos?: number | null;
  assoc?: number;
  empty?: boolean;
  visible?: boolean;
  [k: string]: any;
}

// One full-effects secondary caret's working state: the CARET_STATE_FIELDS
// bundle _withCaret swaps onto the plugin for that caret's turn.
export type CaretState = Record<string, any>;

// The particles. Each is what one effect pushes into its own array and
// draws back out; the fields are the effect's, kept loose where an effect
// adds to them as it goes.
export interface TrailPoint { x: number; y: number; w: number; h: number; t: number; [k: string]: any }
export interface LetterParticle {
  char: string; x: number; y: number; vx: number; vy: number; rotation: number; alpha: number;
  fontSize: number; fontFamily: string; color: string; start: number; [k: string]: any;
}
export interface FlamePixel {
  x: number; y: number; vx: number; vy: number; size: number; color: string; alpha: number; start: number;
  r?: number; spark?: boolean; life?: number; trail?: any; [k: string]: any;
}
export interface Ember {
  x: number; y: number; vx: number; vy: number; life: number; life0?: number; maxLife?: number;
  temp?: number; cw?: number; lift?: number; shape0?: number; flip?: boolean; spark?: boolean; fine?: boolean;
  [k: string]: any;
}
export interface BurnMark {
  x: number; y: number; t: number; rowLeft?: number | null; rowRight?: number | null; lh?: number; fs?: number;
  [k: string]: any;
}
export interface Thunderbolt { bands: any[]; start: number; [k: string]: any }
export interface Firework { sparks: any[]; start: number; [k: string]: any }
export interface StardustMote {
  x: number; y: number; size: number; life: number; color: string; start: number; owner: CaretState | null;
  [k: string]: any;
}

// Obsidian's Editor wraps a CodeMirror 6 EditorView as `cm`. It is not in
// the public typings, and the whole engine measures through it.
declare module "obsidian" {
  interface Editor {
    cm?: any;
  }
  // The engine reaches a view's editor and content element through the base
  // View, where the typings only give them to MarkdownView / ItemView.
  interface View {
    editor?: Editor;
    contentEl?: HTMLElement;
  }
  // Obsidian's own Vim toggle. Undocumented, and guarded at every call.
  interface Vault {
    setConfig?(key: string, value: any): void;
    getConfig?(key: string): any;
  }
}

declare module "@codemirror/view" {
  interface EditorView {
    // Obsidian hangs its CodeMirror 5 compatibility adapter - what the Vim
    // mode runs on - off the CM6 view.
    cm?: any;
    // CodeMirror types `side` as 1 | -1; the engine passes the caret's
    // assoc, a number it flips with unary minus. CodeMirror only tests the
    // sign.
    coordsAtPos(pos: number, side?: number): CMRect | null;
  }
}
