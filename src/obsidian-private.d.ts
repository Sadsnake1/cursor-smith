// Word-Smith — the private API. What this plugin reads of Obsidian that
// obsidian.d.ts does not promise. obsidian-internals.ts (WS_INTERNALS) is the
// record of each dependence — what a writer loses without it, and the test
// that asks the running app; this file tells the checker the names exist AND
// THE SHAPE THE PLUGIN READS. A shape
// here is a claim about a private member, so every member is optional or
// feature-detected at its site, the way the code already asks before use.
// A module (an import), so `declare module` AUGMENTS obsidian's own
// declarations instead of replacing them. The names referenced but not
// declared inside the block are imported for the linter's sake; the checker
// resolves them either way.
import type { CachedMetadata, Command, DataWriteOptions, Plugin, PluginManifest, TAbstractFile, TFile, TFolder, KeymapEventHandler } from 'obsidian';
import type { EditorView } from '@codemirror/view';

// A community plugin as `app.plugins.plugins` holds it: the instance, with
// whatever it keeps on itself (Cursor-Smith's settings and doors are read
// through `WsCursorSmith` in plugin.ts, after a check that it is there).
export type WsLoadedPlugin = Plugin & { manifest: PluginManifest; settings?: unknown; saveSettings?: () => Promise<void> } & Record<string, unknown>;

// One row of the file explorer's index (`fileItems`, by path): the file it
// draws and its elements — read for the marks the plugin paints on a row,
// and for the root's rebuild when nothing gentler re-sorts.
export interface WsExplorerItem {
	file?: TAbstractFile;
	selfEl?: HTMLElement;
	titleEl?: HTMLElement;
	el?: HTMLElement;
	updateChildren?(): void;
}

// The CM5 facade the Vim adapter keeps at `editor.cm.cm`: its state carries
// the Vim mode, its constructor the adapter's Vim API.
export interface WsCm5Facade {
	state?: { vim?: { insertMode?: boolean; replaceMode?: boolean; visualMode?: boolean; visualLine?: boolean; visualBlock?: boolean; mode?: string }; overwrite?: boolean };
	constructor?: { Vim?: unknown };
}

// the scope answer an editor keeps between generations (`isEditorInScope`)
declare module '@codemirror/view' {
	interface EditorView { _wsScope?: { gen: number; in: boolean } }
}

declare module 'obsidian' {
	interface App {
		plugins: {
			plugins: Record<string, WsLoadedPlugin | undefined>;
			enabledPlugins?: Set<string>;
			enablePlugin?(id: string): Promise<void>;
			disablePlugin?(id: string): Promise<void>;
		};
		commands: {
			commands: Record<string, Command | undefined>;
			listCommands(): Command[];
			executeCommandById(id: string): boolean;
		};
		hotkeyManager: { printHotkeyForCommand(id: string): string; getHotkeys(id: string): unknown; getDefaultHotkeys(id: string): unknown };
		// the settings window: a tab by id, and the Hotkeys tab's own search
		// (`setQuery` sets the box, focuses it and draws the list — measured live
		// on 1.13.7, one command shown for its full name)
		setting: { open(): void; openTabById(id: string): { setQuery?: (q: string) => void } | null };
		// the property types (1.4+), every door feature-detected in orgPropType
		metadataTypeManager?: {
			properties?: Record<string, { name?: string; type?: string; widget?: string; count?: number } | undefined>;
			getAssignedWidget?(key: string): { type?: string } | string | null | undefined;
			getPropertyInfo?(key: string): { type?: string; name?: string; widget?: string } | null | undefined;
			getAssignedType?(key: string): string | null | undefined;
		};
		changeTheme(mode: string): void;
		appId: string;
	}
	interface Vault {
		// the app's own settings (Vim mode is the one read)
		config: { vimMode?: boolean } & Record<string, unknown>;
		getConfig(key: string): unknown;
		setConfig(key: string, value: unknown): void;
		// STEP 3 CRUTCH: a TAbstractFile from getAbstractFileByPath is read as
		// a file after `!f.children`, a narrowing the checker cannot follow.
		// Step 4 narrows with `instanceof TFile` and drops these overloads.
		read(file: TAbstractFile): Promise<string>;
		cachedRead(file: TAbstractFile): Promise<string>;
		process(file: TAbstractFile, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>;
	}
	interface MetadataCache {
		getFileCache(file: TAbstractFile): CachedMetadata | null;
	}
	interface FileManager {
		processFrontMatter(file: TAbstractFile, fn: (frontmatter: Record<string, unknown>) => void, options?: DataWriteOptions): Promise<void>;
	}
	interface TAbstractFile {
		// STEP 3 CRUTCH, the same narrowing: a folder's children and a file's
		// extension read off the abstract type.
		children?: TAbstractFile[];
		extension?: string;
	}
	interface View {
		// the file explorer's (WS_INTERNALS explorerSort, explorerResort, sortMenu)
		// a property type, not a method: the comparator patch stashes the
		// original unbound and calls it with the view (unbound-method)
		getSortedFolderItems?: (folder: TFolder) => WsExplorerItem[];
		fileItems?: Record<string, WsExplorerItem | undefined>;
		tree?: { infinityScroll?: { compute?(): void } };
		requestSort?(): void;
		// methods, not properties: the plugin's own views define both
		render?(): void;
		refreshStates?(): void;
		// the explorer's sort menu and its order setter (WS_INTERNALS sortMenu)
		onHeaderMenu?: (menu: Menu) => void;
		setSortOrder?: (order: string) => void;
		// the plugin's own marks on the explorer view: the comparator patch, the
		// menu patch, the order patch — each keeps the original it wrapped
		_wsSortPatched?: boolean;
		_wsSortOrig?: ((folder: TFolder) => WsExplorerItem[]) | null;
		_wsSortOwn?: boolean;
		_wsMenuPatched?: boolean;
		_wsMenuOrig?: ((menu: Menu) => void) | null;
		_wsSortOrderOrig?: ((order: string) => void) | null;
		// a MarkdownView's, read off a leaf's view without narrowing (step 4 narrows)
		editor?: Editor;
		file?: TFile | null;
	}
	interface WorkspaceItem {
		containerEl: HTMLElement;
		// a sidedock's groups and a group's tabs, read off the item type
		children?: WorkspaceItem[];
		currentTab?: number;
	}
	interface WorkspaceLeaf {
		pinned: boolean;
		// the id `getLeafById` answers to (the reader keeps the leaf beside it by it)
		id?: string;
	}
	interface Editor {
		// the CodeMirror 6 view under Obsidian's editor; `cm.cm` is the CM5
		// facade Obsidian's Vim adapter keeps on it, with the Vim state on it
		// and the adapter's Vim class on its constructor
		cm: EditorView & { cm?: WsCm5Facade };
	}
	interface WorkspaceRibbon {
		items: { id?: string; title?: string; buttonEl?: HTMLElement }[];
		removeRibbonAction(title: string): void;
	}
	interface Scope {
		keys: KeymapEventHandler[];
	}
	interface Menu {
		dom: HTMLElement;
	}
	interface MenuItem {
		setSubmenu(): Menu;
		iconEl: HTMLElement;
	}
}
