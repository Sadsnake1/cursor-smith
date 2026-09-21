// Word-Smith — global declarations.
// What the code sees at run time that the checker cannot know: the
// window's require on Obsidian's desktop build, and the DOM lib's answers
// narrowed to what this plugin queries.
declare module '@replit/codemirror-vim';
// THE DESKTOP'S REQUIRE, by the module asked for: Electron's window (the
// title-bar overlay is what it is asked to set), the Vim adapter's api (a
// duck-typed thing, narrowed by `wsVimOf`), and anything else unknown.
interface Window {
	require?: {
		(id: '@electron/remote'): { getCurrentWindow(): import('./settings').WsElectronWindow };
		(id: 'electron'): { remote?: { getCurrentWindow(): import('./settings').WsElectronWindow }; getCurrentWindow?(): import('./settings').WsElectronWindow };
		(id: '@replit/codemirror-vim'): { Vim?: unknown };
		(id: string): unknown;
	};
	// the CM5 globals older builds hung the Vim api on
	CodeMirrorAdapter?: { Vim?: unknown };
	CodeMirror?: { Vim?: unknown };
}
// EVERY ELEMENT THIS PLUGIN QUERIES IS AN HTMLElement. The DOM lib answers
// `Element` to querySelector and `closest`, and a thousand `.style`, `.dataset`,
// `.click()` reads then fail the checker for nothing. These overloads are merged
// AHEAD of the lib's (later declarations order first), so the narrow answer
// wins. An SVG queried this way is the one case this is wrong about, and the
// plugin builds its SVG by hand, not by query.
interface ParentNode {
	querySelector(selectors: string): HTMLElement | null;
	querySelectorAll(selectors: string): NodeListOf<HTMLElement>;
}
interface Element {
	closest(selectors: string): HTMLElement | null;
}

// WHAT THE DESKTOP BUILD HAS THAT THE DOM LIB DOES NOT: Chromium's window
// controls overlay and battery, the local-fonts query (each asked for
// before use), and Electron's <webview>, the PDF export's printer, which is
// only there when the webview integration is on — `exportPdfWebview` asks.
interface Navigator {
	windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect; addEventListener(type: string, fn: (e: Event) => void): void };
	getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }>;
}
interface Window {
	queryLocalFonts?: () => Promise<{ family: string; fullName: string; postscriptName: string; style: string }[]>;
}
interface WebviewTag extends HTMLElement {
	src?: string;
	printToPDF?(options: Record<string, unknown>): Promise<Uint8Array>;
}
interface HTMLElementTagNameMap {
	webview: WebviewTag;
}

// THE PLUGIN'S OWN MARKS ON ELEMENTS: the jar hands its pour out on its
// wrapper (a press re-fills the same canvas), and the bar picker keeps its
// live handles on the popover. Step 4 narrows both to the element that
// carries them.
interface HTMLElement {
	wsPour?: () => void;
	_live?: import('./settings').WsMenuPickItem[];
	// the export preview: the fit the split re-runs after every paint, and the
	// reader's jump-to-paragraph on its body
	_wsFit?: () => void;
	wsJumpTo?: (path: string) => void;
}
// the reader's document remembers its wiring (clicks, keys): the document persists
// across paints, and so do its listeners
interface Document {
	__wsReaderClicks?: boolean;
	__wsReaderKeys?: boolean;
}

