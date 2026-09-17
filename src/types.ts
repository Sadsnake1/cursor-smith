// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

import { DEFAULT_SETTINGS } from "./settings";

// The settings object: every key of DEFAULT_SETTINGS with its default's
// type, plus whatever a saved data.json or a migration carries on top.
export type CursorSmithSettings = typeof DEFAULT_SETTINGS & Record<string, any>;

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
