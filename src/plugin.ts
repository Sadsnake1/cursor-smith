// Word-Smith — plugin: the class's lifecycle, its settings and their
// migrations, the scope, the ribbon. The areas' methods are in their own
// modules (see the class top).

import { Plugin, MarkdownView, TFile, Menu, Modal, Notice, setIcon, Platform, addIcon } from 'obsidian';
import type { Command, Events, WorkspaceSidedock, WorkspaceMobileDrawer, WorkspaceLeaf, TAbstractFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { Text as CmText } from '@codemirror/state';
import type { WordSmithSettings, WsTextStats, WsBoolKey, WsNumberKey, WsStructRow, WsOrgDoor, WsRawSettings } from './settings';
import { wsCompat } from './obsidian-internals';
import {
	type WsOrgIndexMap,
} from './org-index';
import { WsLensSort, WsLensChip } from './organizer-lens';
import type { WsOrgCtx } from './org-ctx';
import type { WsOrgCol } from './organizer-cols';
import type { Extension } from '@codemirror/state';
import {
	DEFAULT_BAR_PRESETS,
	DEFAULT_SETTINGS,
	WS_ICON,
	WS_ICON_SVG,
	WS_MENU_VIEW,
	WS_RIBBON_TITLE,
	WS_SESSION_KEYS,
	WS_WRITE,
	WsOutlinerView,
	barCloneValue,
	wsCatch,
	wsForDisk,
	wsGuard,
	wsGuardTell,
	wsRepairSettings,
	wsBag,
	wsStr,
	wsErrMsg,
} from './preamble';
import type { WsSession } from './preamble';
import { WordSmithSettingTab } from './settings-tab';
import { diagnosticsMethods } from './diagnostics';
import type { DiagnosticsMethods } from './diagnostics';
import { paintMethods } from './paint';
import type { PaintMethods } from './paint';
import { editorMethods } from './editor';
import type { EditorMethods } from './editor';
import { focusMethods } from './focus';
import type { FocusMethods } from './focus';
import { treeMethods } from './tree';
import type { TreeMethods } from './tree';
import { organizerWindowMethods } from './organizer-window';
import type { OrganizerWindowMethods } from './organizer-window';
import { reportMethods } from './report';
import type { ReportMethods } from './report';
import { barMethods } from './bar';
import type { BarMethods } from './bar';
import { menuMethods } from './menu';
import type { MenuMethods } from './menu';
import { storesMethods } from './stores';
import type { StoresMethods } from './stores';
import { themesMethods } from './themes';
import type { ThemesMethods } from './themes';
import { exportMethods } from './export';
import type { ExportMethods } from './export';
import { historyMethods } from './history';
import type { HistoryMethods } from './history';
import type { WsCm5Facade } from './obsidian-private';

// THE HISTORY RECORD as the store holds it: the days by date, the paths' totals,
// and today's tally — added, removed, net, with the words by note. Step 4
// names the shape the fields carried inline; the day and path maps are still
// wide.
// one tally: words added, removed, net
export interface WsHistoryTally { a: number; r: number; n: number }
// the History tab's state between paints: the period shown, the scope, the search
// A note the structure store was found in: its path, whether it is the legacy
// spelling, its mtime and its text (`structureSources`).
export interface WsStructSource { path: string; legacy: boolean; mtime: number; text: string }
// An event with modifier keys, as a mouse and a keyboard event both carry them.
export interface WsModEvent extends Event { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }
export interface WsHistoryTabState { rerender?: () => void; scope: string | string[]; query: string; shiftPeriod: ((dir: number) => void) | null; year: number; month: number; hideScope?: boolean }
// What the window hands the Export tab's panel (`orgDrawExport`): its panel,
// the tab up, the ticks and their doors, the draws, the scope, the options
// handle it writes back.
export interface WsOrgExportCtx {
	panel: HTMLElement; tab: () => string;
	ticks: () => Set<string> | null; tickAll: (on: boolean) => void;
	draw: () => void; drawPanel: () => void;
	exportFiles: () => TFile[]; exportScope: () => string; exportScopes: () => string[] | null;
	loadTicks: () => Promise<unknown>; setExportOpts: (o: WsExportPanelHandle | null) => void;
}
// The export options panel as built (`buildExportOptions`): its element, a
// redraw, a refresh of the figures, a jump to a section.
export interface WsExportPanelHandle { el: HTMLDivElement; redraw: () => void; refresh: () => void; jumpTo: (path: string) => boolean }
// …and the History tab's: its panel, the tab, a redraw, the state it keeps.
export interface WsOrgHistoryCtx { panel: HTMLElement; tab: () => string; drawPanel: () => void; histState: WsHistoryTabState }
// one bar of the chart: a day, a week or a month, with what it tallies
export interface WsHistoryBucket { key: string; label: string; a: number; r: number; n: number; days: number; title?: string; isNow?: boolean; readout?: string }
// what a settings paste (or its undo) answers: a refusal, or the count applied
// and the keys the repair reset
export type WsSettingsPasted = { error: string; applied?: undefined; repaired?: undefined } | { error?: undefined; applied: number; repaired: string[] };

export interface WsHistoryRecord {
	started: string | null;
	days: Record<string, WsHistoryTally>;
	paths: Record<string, Record<string, WsHistoryTally>>;
	today: { date: string; a: number; r: number; n: number; by: Record<string, WsHistoryTally> };
}

// ── THE INK'S PARTICLES (the screensaver, `drawInk`) ─────────────────
// A drop is thrown water: where, how fast, how old, its colour and size and
// the glyph it is drawn as; `shed` once it has left the surface, `pull`
// when the surface draws it back. A bubble rises with a wobble. A wave is a
// travelling swell: its birth, amplitude, width, speed, the hollow behind
// it and the spray it throws; `broke` once. The orb is the jar's ball.
export interface WsInkDrop { x: number; y: number; vx: number; vy: number; life: number; shed?: boolean; pull?: boolean; hue: number; size: number; shape: number }
export interface WsInkBubble { x: number; y: number; size: number; rise: number; phase: number; wob: number; hue: number }
export interface WsInkWave { x: number; dir: number; born: number; amp: number; wid: number; spd: number; hollow: number; spray: number; hue: number; broke: boolean }
export interface WsInkOrb { amount: number; want: number; x: number; y: number; spin: number; vel: number; last: number; vy: number; dropping: boolean; falling: boolean; streak?: number }

export default class WordSmith extends Plugin {
	// THE CLASS IS IN MORE THAN ONE FILE: each area's methods are a module's
	// functions with an explicit `this`, put onto the prototype at the foot of
	// this file and declared here so the checker knows them. One heading per
	// module, in the prototype's order.
	// history.ts
	declare historyLongDate: HistoryMethods["historyLongDate"];
	declare historyDateKey: HistoryMethods["historyDateKey"];
	declare historyEnsure: HistoryMethods["historyEnsure"];
	declare historyBaselines: HistoryMethods["historyBaselines"];
	declare historyCompact: HistoryMethods["historyCompact"];
	declare historyDefaultPath: HistoryMethods["historyDefaultPath"];
	declare historyStorePath: HistoryMethods["historyStorePath"];
	declare historyMarkSeen: HistoryMethods["historyMarkSeen"];
	declare historyIsStoreFile: HistoryMethods["historyIsStoreFile"];
	declare historyTrackingOn: HistoryMethods["historyTrackingOn"];
	declare historyFindFile: HistoryMethods["historyFindFile"];
	declare historyLoad: HistoryMethods["historyLoad"];
	declare historyNoteChange: HistoryMethods["historyNoteChange"];
	declare historyCapture: HistoryMethods["historyCapture"];
	declare historyRecord: HistoryMethods["historyRecord"];
	declare historyQueueSave: HistoryMethods["historyQueueSave"];
	declare historyFlush: HistoryMethods["historyFlush"];
	declare historyRenamePath: HistoryMethods["historyRenamePath"];
	declare historyMovedPath: HistoryMethods["historyMovedPath"];
	declare historyRenameRecord: HistoryMethods["historyRenameRecord"];
	declare historyForgetPath: HistoryMethods["historyForgetPath"];
	declare historyDays: HistoryMethods["historyDays"];
	declare historyPathUnder: HistoryMethods["historyPathUnder"];
	declare historyKnownPaths: HistoryMethods["historyKnownPaths"];
	declare historyValue: HistoryMethods["historyValue"];
	declare historyIsActive: HistoryMethods["historyIsActive"];
	declare historyShiftKey: HistoryMethods["historyShiftKey"];
	declare historyFigures: HistoryMethods["historyFigures"];
	declare historyYears: HistoryMethods["historyYears"];
	declare historyBody: HistoryMethods["historyBody"];
	declare historyPathRows: HistoryMethods["historyPathRows"];
	declare historyCompose: HistoryMethods["historyCompose"];
	declare historyParse: HistoryMethods["historyParse"];
	declare historyWrite: HistoryMethods["historyWrite"];
	declare historyClear: HistoryMethods["historyClear"];
	declare historyAdopt: HistoryMethods["historyAdopt"];
	declare historyEl: HistoryMethods["historyEl"];
	declare crumbLabel: HistoryMethods["crumbLabel"];
	declare historySvg: HistoryMethods["historySvg"];
	declare historyBuckets: HistoryMethods["historyBuckets"];
	declare historyFuzzy: HistoryMethods["historyFuzzy"];
	declare historyFinderMatches: HistoryMethods["historyFinderMatches"];
	declare historyOpeningPeriod: HistoryMethods["historyOpeningPeriod"];
	declare openHistoryModal: HistoryMethods["openHistoryModal"];
	declare renderHistoryTab: HistoryMethods["renderHistoryTab"];
	declare historySeriesOn: HistoryMethods["historySeriesOn"];
	declare historyNiceStep: HistoryMethods["historyNiceStep"];
	declare historyShortNum: HistoryMethods["historyShortNum"];
	declare buildHistoryCalendar: HistoryMethods["buildHistoryCalendar"];
	declare buildHistoryChart: HistoryMethods["buildHistoryChart"];
	// export.ts
	declare exportKnownPaths: ExportMethods["exportKnownPaths"];
	declare exportNearbyScopes: ExportMethods["exportNearbyScopes"];
	declare exportFinderMatches: ExportMethods["exportFinderMatches"];
	declare exportGather: ExportMethods["exportGather"];
	declare exportNatural: ExportMethods["exportNatural"];
	declare exportApplyRemembered: ExportMethods["exportApplyRemembered"];
	declare exportMove: ExportMethods["exportMove"];
	declare exportMoveFolder: ExportMethods["exportMoveFolder"];
	declare exportFolderOf: ExportMethods["exportFolderOf"];
	declare exportFolderChain: ExportMethods["exportFolderChain"];
	declare exportInFolder: ExportMethods["exportInFolder"];
	declare exportEnsureFolder: ExportMethods["exportEnsureFolder"];
	declare exportFileName: ExportMethods["exportFileName"];
	declare exportSections: ExportMethods["exportSections"];
	declare exportToMarkdown: ExportMethods["exportToMarkdown"];
	declare exportOptionDefaults: ExportMethods["exportOptionDefaults"];
	declare openExportModal: ExportMethods["openExportModal"];
	declare exportFiguresText: ExportMethods["exportFiguresText"];
	declare exportFoldersTicked: ExportMethods["exportFoldersTicked"];
	declare exportTickAllSay: ExportMethods["exportTickAllSay"];
	declare exportReaderClicks: ExportMethods["exportReaderClicks"];
	declare exportReaderKeys: ExportMethods["exportReaderKeys"];
	declare openNoteAt: ExportMethods["openNoteAt"];
	declare exportPreviewInto: ExportMethods["exportPreviewInto"];
	declare exportPreviewMarkdown: ExportMethods["exportPreviewMarkdown"];
	declare exportToHtml: ExportMethods["exportToHtml"];
	declare exportDefaultScope: ExportMethods["exportDefaultScope"];
	declare exportRemember: ExportMethods["exportRemember"];
	declare exportWhen: ExportMethods["exportWhen"];
	declare countTasks: ExportMethods["countTasks"];
	declare tagsOf: ExportMethods["tagsOf"];
	declare tagsWithSource: ExportMethods["tagsWithSource"];
	declare exportWhenShort: ExportMethods["exportWhenShort"];
	declare exportFillCounts: ExportMethods["exportFillCounts"];
	declare exportOptsFor: ExportMethods["exportOptsFor"];
	declare exportPrevColFit: ExportMethods["exportPrevColFit"];
	declare buildExportAct: ExportMethods["buildExportAct"];
	declare buildExportOptions: ExportMethods["buildExportOptions"];
	declare runExport: ExportMethods["runExport"];
	declare exportPdfOptions: ExportMethods["exportPdfOptions"];
	declare exportPdfAvailable: ExportMethods["exportPdfAvailable"];
	declare exportPdfWebview: ExportMethods["exportPdfWebview"];
	declare exportPdfRender: ExportMethods["exportPdfRender"];
	// themes.ts
	declare barThemeById: ThemesMethods["barThemeById"];
	declare barThemeShelf: ThemesMethods["barThemeShelf"];
	declare barThemeMove: ThemesMethods["barThemeMove"];
	declare barThemeHide: ThemesMethods["barThemeHide"];
	declare barThemeShow: ThemesMethods["barThemeShow"];
	declare themesPickerItems: ThemesMethods["themesPickerItems"];
	declare applyBarTheme: ThemesMethods["applyBarTheme"];
	declare applyThemeClass: ThemesMethods["applyThemeClass"];
	declare barSelectionInks: ThemesMethods["barSelectionInks"];
	declare barSelectionInk: ThemesMethods["barSelectionInk"];
	declare barDeepenSelection: ThemesMethods["barDeepenSelection"];
	declare barContrast: ThemesMethods["barContrast"];
	declare barThemeInkify: ThemesMethods["barThemeInkify"];
	declare barThemeVivify: ThemesMethods["barThemeVivify"];
	declare barThemeHighlight: ThemesMethods["barThemeHighlight"];
	declare barThemeCursorInk: ThemesMethods["barThemeCursorInk"];
	declare barThemeVividFor: ThemesMethods["barThemeVividFor"];
	declare barSetColorMode: ThemesMethods["barSetColorMode"];
	declare barThemeGlassRepay: ThemesMethods["barThemeGlassRepay"];
	declare barThemeGuard: ThemesMethods["barThemeGuard"];
	declare barThemeUndress: ThemesMethods["barThemeUndress"];
	declare barThemeOnCssChange: ThemesMethods["barThemeOnCssChange"];
	declare barThemeVars: ThemesMethods["barThemeVars"];
	declare themeVarUniverse: ThemesMethods["themeVarUniverse"];
	declare applyThemeVars: ThemesMethods["applyThemeVars"];
	declare barThemeHueInk: ThemesMethods["barThemeHueInk"];
	declare barThemeVimInks: ThemesMethods["barThemeVimInks"];
	declare barThemeCursorDefaults: ThemesMethods["barThemeCursorDefaults"];
	declare barThemeCursorCapture: ThemesMethods["barThemeCursorCapture"];
	declare barThemeCursorRestoreInto: ThemesMethods["barThemeCursorRestoreInto"];
	declare barThemeCursorSync: ThemesMethods["barThemeCursorSync"];
	declare barThemeHalf: ThemesMethods["barThemeHalf"];
	// stores.ts
	declare goalsFilePath: StoresMethods["goalsFilePath"];
	declare goalsFileCompose: StoresMethods["goalsFileCompose"];
	declare goalsFileParse: StoresMethods["goalsFileParse"];
	declare goalsStoreApply: StoresMethods["goalsStoreApply"];
	declare goalsStoreAdopt: StoresMethods["goalsStoreAdopt"];
	declare colorsSectionKey: StoresMethods["colorsSectionKey"];
	declare userColsSectionKey: StoresMethods["userColsSectionKey"];
	declare userColsStoreApply: StoresMethods["userColsStoreApply"];
	declare userColsStoreAdopt: StoresMethods["userColsStoreAdopt"];
	declare colorsStoreApply: StoresMethods["colorsStoreApply"];
	declare colorsStoreAdopt: StoresMethods["colorsStoreAdopt"];
	declare goalsStoreWrite: StoresMethods["goalsStoreWrite"];
	declare goalsSignature: StoresMethods["goalsSignature"];
	declare goalsFileSync: StoresMethods["goalsFileSync"];
	declare storeWriteFailed: StoresMethods["storeWriteFailed"];
	declare storeWriteOk: StoresMethods["storeWriteOk"];
	declare goalsFileLoad: StoresMethods["goalsFileLoad"];
	declare settingsMirrorPathFor: StoresMethods["settingsMirrorPathFor"];
	declare settingsMirrorMachineKeys: StoresMethods["settingsMirrorMachineKeys"];
	declare settingsMirrorVaultKeys: StoresMethods["settingsMirrorVaultKeys"];
	declare vaultName: StoresMethods["vaultName"];
	declare vaultWhole: StoresMethods["vaultWhole"];
	declare settingsMirrorCompose: StoresMethods["settingsMirrorCompose"];
	declare settingsMirrorParse: StoresMethods["settingsMirrorParse"];
	declare settingsMirrorShouldRestore: StoresMethods["settingsMirrorShouldRestore"];
	declare settingsMirrorRestorable: StoresMethods["settingsMirrorRestorable"];
	declare settingsMirrorForget: StoresMethods["settingsMirrorForget"];
	declare settingsMirrorWrite: StoresMethods["settingsMirrorWrite"];
	declare settingsMirrorSync: StoresMethods["settingsMirrorSync"];
	declare settingsMirrorRestore: StoresMethods["settingsMirrorRestore"];
	declare renameGoalPaths: StoresMethods["renameGoalPaths"];
	declare forgetGoalPaths: StoresMethods["forgetGoalPaths"];
	declare goalPathStores: StoresMethods["goalPathStores"];
	declare renameScopePath: StoresMethods["renameScopePath"];
	declare removeScopePath: StoresMethods["removeScopePath"];
	declare storeResolve: StoresMethods["storeResolve"];
	declare storeRenameFollow: StoresMethods["storeRenameFollow"];
	declare storeFind: StoresMethods["storeFind"];
	declare goalsFileFind: StoresMethods["goalsFileFind"];
	declare storeEnsureFolder: StoresMethods["storeEnsureFolder"];
	declare structurePathNow: StoresMethods["structurePathNow"];
	declare structureLegacyPaths: StoresMethods["structureLegacyPaths"];
	declare structureStorePath: StoresMethods["structureStorePath"];
	declare structureSources: StoresMethods["structureSources"];
	declare storeRetire: StoresMethods["storeRetire"];
	declare structureMigrate: StoresMethods["structureMigrate"];
	declare goalsSectionKey: StoresMethods["goalsSectionKey"];
	declare structureCompose: StoresMethods["structureCompose"];
	declare structureParse: StoresMethods["structureParse"];
	declare structureFind: StoresMethods["structureFind"];
	declare structureStore: StoresMethods["structureStore"];
	declare structureCached: StoresMethods["structureCached"];
	declare structureRepair: StoresMethods["structureRepair"];
	declare vaultReady: StoresMethods["vaultReady"];
	declare structureRead: StoresMethods["structureRead"];
	declare structureReadNow: StoresMethods["structureReadNow"];
	declare structureWriteSection: StoresMethods["structureWriteSection"];
	declare structureWrite: StoresMethods["structureWrite"];
	declare structureQueue: StoresMethods["structureQueue"];
	declare storeHandBack: StoresMethods["storeHandBack"];
	declare structureWriteNow: StoresMethods["structureWriteNow"];
	declare structureRenamePath: StoresMethods["structureRenamePath"];
	declare structureForgetPath: StoresMethods["structureForgetPath"];
	declare structureForgetStore: StoresMethods["structureForgetStore"];
	declare propStoreHolds: StoresMethods["propStoreHolds"];
	declare propStoreSection: StoresMethods["propStoreSection"];
	declare propStorePaths: StoresMethods["propStorePaths"];
	declare propStoreEncode: StoresMethods["propStoreEncode"];
	declare propStoreDecode: StoresMethods["propStoreDecode"];
	declare propStoreAllSync: StoresMethods["propStoreAllSync"];
	declare propStoreGetSync: StoresMethods["propStoreGetSync"];
	declare propStoreRowsUnder: StoresMethods["propStoreRowsUnder"];
	declare propStoreAll: StoresMethods["propStoreAll"];
	declare propStoreGet: StoresMethods["propStoreGet"];
	declare propStoreSet: StoresMethods["propStoreSet"];
	declare structureRenameStore: StoresMethods["structureRenameStore"];
	declare structureLand: StoresMethods["structureLand"];
	declare treeOrderKey: StoresMethods["treeOrderKey"];
	declare treeOrderFor: StoresMethods["treeOrderFor"];
	declare treeOrderLoad: StoresMethods["treeOrderLoad"];
	declare treeOrderAdopt: StoresMethods["treeOrderAdopt"];
	declare structureReload: StoresMethods["structureReload"];
	declare treeOrderWrite: StoresMethods["treeOrderWrite"];
	// menu.ts
	declare menuDrawIcon: MenuMethods["menuDrawIcon"];
	declare menuFeatureDefs: MenuMethods["menuFeatureDefs"];
	declare menuIconAlts: MenuMethods["menuIconAlts"];
	declare menuIconMirrored: MenuMethods["menuIconMirrored"];
	declare menuIconFor: MenuMethods["menuIconFor"];
	declare menuLayout: MenuMethods["menuLayout"];
	declare menuVisibleLayout: MenuMethods["menuVisibleLayout"];
	declare menuBands: MenuMethods["menuBands"];
	declare menuIsJoined: MenuMethods["menuIsJoined"];
	declare menuSetJoined: MenuMethods["menuSetJoined"];
	declare menuJoinAfter: MenuMethods["menuJoinAfter"];
	declare menuBreakAt: MenuMethods["menuBreakAt"];
	declare menuMove: MenuMethods["menuMove"];
	declare menuHide: MenuMethods["menuHide"];
	declare menuRestore: MenuMethods["menuRestore"];
	declare menuAddRule: MenuMethods["menuAddRule"];
	declare menuIsCommand: MenuMethods["menuIsCommand"];
	declare menuCommandId: MenuMethods["menuCommandId"];
	declare menuCommandFor: MenuMethods["menuCommandFor"];
	declare menuDefaultAlias: MenuMethods["menuDefaultAlias"];
	declare menuAliasOf: MenuMethods["menuAliasOf"];
	declare menuCommandName: MenuMethods["menuCommandName"];
	declare menuPinCommand: MenuMethods["menuPinCommand"];
	declare menuSetAlias: MenuMethods["menuSetAlias"];
	declare menuUnpin: MenuMethods["menuUnpin"];
	declare menuRuleStyle: MenuMethods["menuRuleStyle"];
	declare menuSetRuleStyle: MenuMethods["menuSetRuleStyle"];
	declare menuDeleteRule: MenuMethods["menuDeleteRule"];
	declare menuRowSpecs: MenuMethods["menuRowSpecs"];
	declare registerMenuPanel: MenuMethods["registerMenuPanel"];
	declare rememberMenuPanelSpot: MenuMethods["rememberMenuPanelSpot"];
	declare restoreMenuPanelSpot: MenuMethods["restoreMenuPanelSpot"];
	declare menuPanelLeaves: MenuMethods["menuPanelLeaves"];
	declare reviveMenuPanel: MenuMethods["reviveMenuPanel"];
	declare openMenuPanel: MenuMethods["openMenuPanel"];
	declare closeMenuPanel: MenuMethods["closeMenuPanel"];
	declare refreshMenuPanels: MenuMethods["refreshMenuPanels"];
	declare rebuildMenuPanels: MenuMethods["rebuildMenuPanels"];
	declare refreshMenuPanelsNow: MenuMethods["refreshMenuPanelsNow"];
	declare openBarMenu: MenuMethods["openBarMenu"];
	// bar.ts
	declare barGeometry: BarMethods["barGeometry"];
	declare barPeekArmed: BarMethods["barPeekArmed"];
	declare syncBarPeekState: BarMethods["syncBarPeekState"];
	declare onPointerForBarPeek: BarMethods["onPointerForBarPeek"];
	declare beginBarPeek: BarMethods["beginBarPeek"];
	declare scheduleBarPeekEnd: BarMethods["scheduleBarPeekEnd"];
	declare endBarPeek: BarMethods["endBarPeek"];
	declare setBarPeekClass: BarMethods["setBarPeekClass"];
	declare getBarPresets: BarMethods["getBarPresets"];
	declare saveBarPreset: BarMethods["saveBarPreset"];
	declare loadBarPreset: BarMethods["loadBarPreset"];
	declare applyBarSnapshot: BarMethods["applyBarSnapshot"];
	declare cycleBarPreset: BarMethods["cycleBarPreset"];
	declare deleteBarPreset: BarMethods["deleteBarPreset"];
	declare importBarPreset: BarMethods["importBarPreset"];
	declare fitSections: BarMethods["fitSections"];
	declare clearFitHidden: BarMethods["clearFitHidden"];
	declare fitClassOf: BarMethods["fitClassOf"];
	declare fitCandidates: BarMethods["fitCandidates"];
	declare fadeCandidates: BarMethods["fadeCandidates"];
	declare sectionContentWidth: BarMethods["sectionContentWidth"];
	declare rowContentFits: BarMethods["rowContentFits"];
	declare fitStatusRow: BarMethods["fitStatusRow"];
	declare fitStatusBar: BarMethods["fitStatusBar"];
	declare barBorderStyle: BarMethods["barBorderStyle"];
	declare barRuleIsHair: BarMethods["barRuleIsHair"];
	declare barBottomRuleOn: BarMethods["barBottomRuleOn"];
	declare barRuleWidths: BarMethods["barRuleWidths"];
	declare barRuleVars: BarMethods["barRuleVars"];
	declare barPadding: BarMethods["barPadding"];
	declare snappedRowHeight: BarMethods["snappedRowHeight"];
	declare barBottomGapPx: BarMethods["barBottomGapPx"];
	declare vimPanelReserve: BarMethods["vimPanelReserve"];
	declare vimGutterHeight: BarMethods["vimGutterHeight"];
	declare barSurfaceColor: BarMethods["barSurfaceColor"];
	declare resolveBarDirective: BarMethods["resolveBarDirective"];
	declare barIsHidden: BarMethods["barIsHidden"];
	declare retroBarActive: BarMethods["retroBarActive"];
	declare updateStatusBar: BarMethods["updateStatusBar"];
	declare startClockTick: BarMethods["startClockTick"];
	declare stopClockTick: BarMethods["stopClockTick"];
	declare refreshBattery: BarMethods["refreshBattery"];
	declare setupBattery: BarMethods["setupBattery"];
	declare formatBattery: BarMethods["formatBattery"];
	declare hexToRgba: BarMethods["hexToRgba"];
	declare dateParts: BarMethods["dateParts"];
	declare buildObsidianIcon: BarMethods["buildObsidianIcon"];
	declare buildClockFace: BarMethods["buildClockFace"];
	declare formatTime: BarMethods["formatTime"];
	declare getStatusRows: BarMethods["getStatusRows"];
	declare getAllModes: BarMethods["getAllModes"];
	declare getActiveModes: BarMethods["getActiveModes"];
	declare getModeLabel: BarMethods["getModeLabel"];
	declare openBarPicker: BarMethods["openBarPicker"];
	declare refreshBarPicker: BarMethods["refreshBarPicker"];
	declare closeBarPicker: BarMethods["closeBarPicker"];
	declare plUnit: BarMethods["plUnit"];
	declare barTokenFormat: BarMethods["barTokenFormat"];
	declare barTokenIconOn: BarMethods["barTokenIconOn"];
	declare barTokenIconName: BarMethods["barTokenIconName"];
	declare barTokenPaint: BarMethods["barTokenPaint"];
	declare buildBarButton: BarMethods["buildBarButton"];
	declare buildHistoryIndicator: BarMethods["buildHistoryIndicator"];
	declare buildExportIndicator: BarMethods["buildExportIndicator"];
	declare buildPowermenuIndicator: BarMethods["buildPowermenuIndicator"];
	declare buildOutlinerIndicator: BarMethods["buildOutlinerIndicator"];
	declare flagColor: BarMethods["flagColor"];
	declare buildFlagIndicator: BarMethods["buildFlagIndicator"];
	declare propsCountOf: BarMethods["propsCountOf"];
	declare openPropertiesView: BarMethods["openPropertiesView"];
	declare buildPropsIndicator: BarMethods["buildPropsIndicator"];
	declare barCountPaint: BarMethods["barCountPaint"];
	declare buildBacklinksIndicator: BarMethods["buildBacklinksIndicator"];
	declare buildReportIndicator: BarMethods["buildReportIndicator"];
	declare barScope: BarMethods["barScope"];
	declare buildThemeIndicator: BarMethods["buildThemeIndicator"];
	declare buildFontIndicator: BarMethods["buildFontIndicator"];
	declare fontPickerItems: BarMethods["fontPickerItems"];
	declare openFontPicker: BarMethods["openFontPicker"];
	declare openThemePicker: BarMethods["openThemePicker"];
	declare getSyntaxCategories: BarMethods["getSyntaxCategories"];
	declare buildSyntaxIndicator: BarMethods["buildSyntaxIndicator"];
	declare syntaxPickerItems: BarMethods["syntaxPickerItems"];
	declare openSyntaxPicker: BarMethods["openSyntaxPicker"];
	declare buildKeyGlyph: BarMethods["buildKeyGlyph"];
	declare buildCapsIndicator: BarMethods["buildCapsIndicator"];
	declare buildNumIndicator: BarMethods["buildNumIndicator"];
	declare getWriteChecks: BarMethods["getWriteChecks"];
	declare buildWriteChecksIndicator: BarMethods["buildWriteChecksIndicator"];
	declare checksPickerItems: BarMethods["checksPickerItems"];
	declare openWriteChecksPicker: BarMethods["openWriteChecksPicker"];
	declare buildMarkersIndicator: BarMethods["buildMarkersIndicator"];
	declare markersPickerItems: BarMethods["markersPickerItems"];
	declare openMarkersPicker: BarMethods["openMarkersPicker"];
	declare openPickerLive: BarMethods["openPickerLive"];
	declare buildModeGlyph: BarMethods["buildModeGlyph"];
	declare buildModeIndicator: BarMethods["buildModeIndicator"];
	declare modesPickerItems: BarMethods["modesPickerItems"];
	declare openModesPicker: BarMethods["openModesPicker"];
	declare getLineColumn: BarMethods["getLineColumn"];
	declare headingTrail: BarMethods["headingTrail"];
	declare getBacklinkCount: BarMethods["getBacklinkCount"];
	declare formatCount: BarMethods["formatCount"];
	declare formatReadTime: BarMethods["formatReadTime"];
	declare getVimModeKey: BarMethods["getVimModeKey"];
	declare getVimModeLabel: BarMethods["getVimModeLabel"];
	declare updateRetroStatusBar: BarMethods["updateRetroStatusBar"];
	declare powerlineColors: BarMethods["powerlineColors"];
	declare powerlineTextColor: BarMethods["powerlineTextColor"];
	declare powerlineInk: BarMethods["powerlineInk"];
	declare parsePowerlineSegments: BarMethods["parsePowerlineSegments"];
	declare powerlineSegColor: BarMethods["powerlineSegColor"];
	declare powerlineSegInk: BarMethods["powerlineSegInk"];
	declare headingTrailText: BarMethods["headingTrailText"];
	declare themedKey: BarMethods["themedKey"];
	declare buildSoftChevron: BarMethods["buildSoftChevron"];
	declare buildSoftMark: BarMethods["buildSoftMark"];
	declare buildPowerlineSep: BarMethods["buildPowerlineSep"];
	declare themeSurfaceColor: BarMethods["themeSurfaceColor"];
	declare colorProbeEl: BarMethods["colorProbeEl"];
	declare cursorSmithSettings: BarMethods["cursorSmithSettings"];
	declare cursorSmithVimColor: BarMethods["cursorSmithVimColor"];
	declare vimModeColor: BarMethods["vimModeColor"];
	declare cursorColor: BarMethods["cursorColor"];
	declare renderPowerlineSection: BarMethods["renderPowerlineSection"];
	declare renderStatusSection: BarMethods["renderStatusSection"];
	declare headingCrumbCount: BarMethods["headingCrumbCount"];
	declare requestBarRebuild: BarMethods["requestBarRebuild"];
	declare scheduleFit: BarMethods["scheduleFit"];
	declare fitStatusBarText: BarMethods["fitStatusBarText"];
	declare stampBarReserve: BarMethods["stampBarReserve"];
	declare clearBarBounds: BarMethods["clearBarBounds"];
	declare stampBarBounds: BarMethods["stampBarBounds"];
	// report.ts
	declare stripFrontmatter: ReportMethods["stripFrontmatter"];
	declare countProse: ReportMethods["countProse"];
	declare wordFreqInto: ReportMethods["wordFreqInto"];
	declare topWords: ReportMethods["topWords"];
	declare wordFreqFor: ReportMethods["wordFreqFor"];
	declare analyzeText: ReportMethods["analyzeText"];
	declare countWords: ReportMethods["countWords"];
	declare getDocStats: ReportMethods["getDocStats"];
	declare getNonProseLines: ReportMethods["getNonProseLines"];
	declare getParagraphLines: ReportMethods["getParagraphLines"];
	declare getParagraphInfo: ReportMethods["getParagraphInfo"];
	declare activeFolderPath: ReportMethods["activeFolderPath"];
	declare celebrate: ReportMethods["celebrate"];
	declare fileGoalFor: ReportMethods["fileGoalFor"];
	declare folderTargetSums: ReportMethods["folderTargetSums"];
	declare folderTargetRollup: ReportMethods["folderTargetRollup"];
	declare filesInFolder: ReportMethods["filesInFolder"];
	declare analyzeFolder: ReportMethods["analyzeFolder"];
	declare buildGoalLiquid: ReportMethods["buildGoalLiquid"];
	declare _rgbToHsl: ReportMethods["_rgbToHsl"];
	declare registerGoalStates: ReportMethods["registerGoalStates"];
	declare refreshFolderWords: ReportMethods["refreshFolderWords"];
	declare reportFinderMatches: ReportMethods["reportFinderMatches"];
	declare scopeFinderMatches: ReportMethods["scopeFinderMatches"];
	declare scopeNoteCount: ReportMethods["scopeNoteCount"];
	declare openReportModal: ReportMethods["openReportModal"];
	declare buildReportFigures: ReportMethods["buildReportFigures"];
	declare buildReportWords: ReportMethods["buildReportWords"];
	declare selectionFiles: ReportMethods["selectionFiles"];
	declare analyzeSelection: ReportMethods["analyzeSelection"];
	declare selectionTarget: ReportMethods["selectionTarget"];
	// organizer-window.ts
	declare fileMenuReportRow: OrganizerWindowMethods["fileMenuReportRow"];
	declare fileMenuFor: OrganizerWindowMethods["fileMenuFor"];
	declare propColId: OrganizerWindowMethods["propColId"];
	declare propColKey: OrganizerWindowMethods["propColKey"];
	declare propRaw: OrganizerWindowMethods["propRaw"];
	declare propText: OrganizerWindowMethods["propText"];
	declare propTitle: OrganizerWindowMethods["propTitle"];
	declare propLooksLikeDate: OrganizerWindowMethods["propLooksLikeDate"];
	declare propSortAs: OrganizerWindowMethods["propSortAs"];
	declare uniTagsOf: OrganizerWindowMethods["uniTagsOf"];
	declare uniTagsInScope: OrganizerWindowMethods["uniTagsInScope"];
	declare uniTypeGroups: OrganizerWindowMethods["uniTypeGroups"];
	declare uniTypeGroupOf: OrganizerWindowMethods["uniTypeGroupOf"];
	declare uniTypeSet: OrganizerWindowMethods["uniTypeSet"];
	declare uniTypeAllows: OrganizerWindowMethods["uniTypeAllows"];
	declare touchDrag: OrganizerWindowMethods["touchDrag"];
	declare modalHost: OrganizerWindowMethods["modalHost"];
	declare orgIndexEnsure: OrganizerWindowMethods["orgIndexEnsure"];
	declare orgIndexResweep: OrganizerWindowMethods["orgIndexResweep"];
	declare orgIndexVaultHasNotes: OrganizerWindowMethods["orgIndexVaultHasNotes"];
	declare orgIndexStoreKnown: OrganizerWindowMethods["orgIndexStoreKnown"];
	declare orgIndexOnChange: OrganizerWindowMethods["orgIndexOnChange"];
	declare _orgIndexRing: OrganizerWindowMethods["_orgIndexRing"];
	declare orgIndexSweep: OrganizerWindowMethods["orgIndexSweep"];
	declare orgIndexRead: OrganizerWindowMethods["orgIndexRead"];
	declare _orgIndexWatch: OrganizerWindowMethods["_orgIndexWatch"];
	declare orgPropWrite: OrganizerWindowMethods["orgPropWrite"];
	declare orgPropTypeChosen: OrganizerWindowMethods["orgPropTypeChosen"];
	declare orgPropType: OrganizerWindowMethods["orgPropType"];
	declare dateText: OrganizerWindowMethods["dateText"];
	declare dateStyle: OrganizerWindowMethods["dateStyle"];
	declare orgStamp: OrganizerWindowMethods["orgStamp"];
	declare formatValue: OrganizerWindowMethods["formatValue"];
	declare orgKnownProps: OrganizerWindowMethods["orgKnownProps"];
	declare orgWordsOf: OrganizerWindowMethods["orgWordsOf"];
	declare orgAggUnder: OrganizerWindowMethods["orgAggUnder"];
	declare orgDistinctUnder: OrganizerWindowMethods["orgDistinctUnder"];
	declare orgCountsUnder: OrganizerWindowMethods["orgCountsUnder"];
	declare openManuscriptModal: OrganizerWindowMethods["openManuscriptModal"];
	declare orgFolderIcon: OrganizerWindowMethods["orgFolderIcon"];
	declare orgTargetSay: OrganizerWindowMethods["orgTargetSay"];
	declare orgKindIcon: OrganizerWindowMethods["orgKindIcon"];
	declare orgKindTag: OrganizerWindowMethods["orgKindTag"];
	declare orgDrawExport: OrganizerWindowMethods["orgDrawExport"];
	declare orgDrawHistory: OrganizerWindowMethods["orgDrawHistory"];
	declare orgTableMake: OrganizerWindowMethods["orgTableMake"];
	declare orgWindows: OrganizerWindowMethods["orgWindows"];
	declare orgWindowAdd: OrganizerWindowMethods["orgWindowAdd"];
	declare orgWindowDrop: OrganizerWindowMethods["orgWindowDrop"];
	declare orgTicksDoor: OrganizerWindowMethods["orgTicksDoor"];
	declare orgTicksWanted: OrganizerWindowMethods["orgTicksWanted"];
	declare orgTicksSchedule: OrganizerWindowMethods["orgTicksSchedule"];
	declare orgTicksRows: OrganizerWindowMethods["orgTicksRows"];
	declare orgTicksRepaint: OrganizerWindowMethods["orgTicksRepaint"];
	declare orgTicksClear: OrganizerWindowMethods["orgTicksClear"];
	declare orgOpenAt: OrganizerWindowMethods["orgOpenAt"];
	declare orgReveal: OrganizerWindowMethods["orgReveal"];
	declare fileMenuOrganizerRows: OrganizerWindowMethods["fileMenuOrganizerRows"];
	declare orgDoorFor: OrganizerWindowMethods["orgDoorFor"];
	declare orgOpenTab: OrganizerWindowMethods["orgOpenTab"];
	declare filesMenuFor: OrganizerWindowMethods["filesMenuFor"];
	declare orgTreeSelect: OrganizerWindowMethods["orgTreeSelect"];
	declare orgTreeFollow: OrganizerWindowMethods["orgTreeFollow"];
	declare orgTreeHookAttach: OrganizerWindowMethods["orgTreeHookAttach"];
	declare orgTreeHookDetach: OrganizerWindowMethods["orgTreeHookDetach"];
	declare leafHost: OrganizerWindowMethods["leafHost"];
	declare registerOutlinerPane: OrganizerWindowMethods["registerOutlinerPane"];
	declare outlinerPaneLeaves: OrganizerWindowMethods["outlinerPaneLeaves"];
	declare openOutlinerPane: OrganizerWindowMethods["openOutlinerPane"];
	declare openOutlinerPopout: OrganizerWindowMethods["openOutlinerPopout"];
	// tree.ts
	declare flagDefs: TreeMethods["flagDefs"];
	declare flagCount: TreeMethods["flagCount"];
	declare flagsApply: TreeMethods["flagsApply"];
	declare onTreeOrderChange: TreeMethods["onTreeOrderChange"];
	declare onTreeCountsChange: TreeMethods["onTreeCountsChange"];
	declare treeCountsChanged: TreeMethods["treeCountsChanged"];
	declare treeShapeChanged: TreeMethods["treeShapeChanged"];
	declare treeOrderChanged: TreeMethods["treeOrderChanged"];
	declare treeMoveInto: TreeMethods["treeMoveInto"];
	declare outlinerNewParent: TreeMethods["outlinerNewParent"];
	declare outlinerFreeName: TreeMethods["outlinerFreeName"];
	declare outlinerJoinOrder: TreeMethods["outlinerJoinOrder"];
	declare outlinerAddNote: TreeMethods["outlinerAddNote"];
	declare outlinerAddFolder: TreeMethods["outlinerAddFolder"];
	declare confirmDelete: TreeMethods["confirmDelete"];
	declare outlinerRenameParts: TreeMethods["outlinerRenameParts"];
	declare outlinerRenameTo: TreeMethods["outlinerRenameTo"];
	declare outlinerRowMenu: TreeMethods["outlinerRowMenu"];
	declare treeMoveUndo: TreeMethods["treeMoveUndo"];
	declare explorerSortWanted: TreeMethods["explorerSortWanted"];
	declare explorerViews: TreeMethods["explorerViews"];
	declare treeOrderCurrent: TreeMethods["treeOrderCurrent"];
	declare treeOrderMove: TreeMethods["treeOrderMove"];
	declare treeDragZone: TreeMethods["treeDragZone"];
	declare treeStopSpringLoad: TreeMethods["treeStopSpringLoad"];
	declare treeDropAim: TreeMethods["treeDropAim"];
	declare explorerRecordsMatter: TreeMethods["explorerRecordsMatter"];
	declare explorerWanted: TreeMethods["explorerWanted"];
	declare treeMarksBox: TreeMethods["treeMarksBox"];
	declare treeTasksOf: TreeMethods["treeTasksOf"];
	declare treeTasksUnder: TreeMethods["treeTasksUnder"];
	declare treeCountIndex: TreeMethods["treeCountIndex"];
	declare patchExplorerSortMenu: TreeMethods["patchExplorerSortMenu"];
	declare attachSortMenuRow: TreeMethods["attachSortMenuRow"];
	declare addSortMenuRow: TreeMethods["addSortMenuRow"];
	declare unpatchExplorerSortMenu: TreeMethods["unpatchExplorerSortMenu"];
	declare patchExplorerSort: TreeMethods["patchExplorerSort"];
	declare unpatchExplorerSort: TreeMethods["unpatchExplorerSort"];
	declare repaintExplorerOrder: TreeMethods["repaintExplorerOrder"];
	declare sortFolderItems: TreeMethods["sortFolderItems"];
	declare attachTreeDrag: TreeMethods["attachTreeDrag"];
	declare paintTreeDrop: TreeMethods["paintTreeDrop"];
	declare attachExplorerObserver: TreeMethods["attachExplorerObserver"];
	declare detachExplorerObserver: TreeMethods["detachExplorerObserver"];
	declare repaintExplorerFlag: TreeMethods["repaintExplorerFlag"];
	declare scheduleExplorerPatch: TreeMethods["scheduleExplorerPatch"];
	declare patchExplorerDOM: TreeMethods["patchExplorerDOM"];
	declare paintExplorerSortIcon: TreeMethods["paintExplorerSortIcon"];
	declare paintExplorerRoots: TreeMethods["paintExplorerRoots"];
	declare paintExplorerTasks: TreeMethods["paintExplorerTasks"];
	declare paintExplorerFolderColours: TreeMethods["paintExplorerFolderColours"];
	declare paintExplorerKindIcons: TreeMethods["paintExplorerKindIcons"];
	declare paintExplorerFolderIcons: TreeMethods["paintExplorerFolderIcons"];
	declare applyFileWordCount: TreeMethods["applyFileWordCount"];
	declare applyFolderSums: TreeMethods["applyFolderSums"];
	declare applyOutlineWordCounts: TreeMethods["applyOutlineWordCounts"];
	declare setFlagBadge: TreeMethods["setFlagBadge"];
	declare setCountBadge: TreeMethods["setCountBadge"];
	declare removeWordCounts: TreeMethods["removeWordCounts"];
	// focus.ts
	declare chromeFloorY: FocusMethods["chromeFloorY"];
	declare caretMargin: FocusMethods["caretMargin"];
	declare caretFloorY: FocusMethods["caretFloorY"];
	declare caretCeilingY: FocusMethods["caretCeilingY"];
	declare maskEdge: FocusMethods["maskEdge"];
	declare tagMainTitlebar: FocusMethods["tagMainTitlebar"];
	declare shouldHideScrollBar: FocusMethods["shouldHideScrollBar"];
	declare shouldHideNativeStatusBar: FocusMethods["shouldHideNativeStatusBar"];
	declare letterboxColors: FocusMethods["letterboxColors"];
	declare toggleZen: FocusMethods["toggleZen"];
	declare toggleZenFromBar: FocusMethods["toggleZenFromBar"];
	declare toggleZenMode: FocusMethods["toggleZenMode"];
	declare toggleFullPlugin: FocusMethods["toggleFullPlugin"];
	declare zenOn: FocusMethods["zenOn"];
	declare quickPanelSplit: FocusMethods["quickPanelSplit"];
	declare quickCycleCurrentLeaf: FocusMethods["quickCycleCurrentLeaf"];
	declare quickCycleVisibleLeaves: FocusMethods["quickCycleVisibleLeaves"];
	declare quickCycleTarget: FocusMethods["quickCycleTarget"];
	declare quickCycleSidebarLeaves: FocusMethods["quickCycleSidebarLeaves"];
	declare quickCycleEnterSidebar: FocusMethods["quickCycleEnterSidebar"];
	declare focusLeafDom: FocusMethods["focusLeafDom"];
	declare revealAndFocusLeaf: FocusMethods["revealAndFocusLeaf"];
	declare quickCycleVimKey: FocusMethods["quickCycleVimKey"];
	declare revealInSidebarView: FocusMethods["revealInSidebarView"];
	declare quickCycleFocus: FocusMethods["quickCycleFocus"];
	declare quickCycleCloseBehind: FocusMethods["quickCycleCloseBehind"];
	declare quickCycleMove: FocusMethods["quickCycleMove"];
	declare sidebarSideFor: FocusMethods["sidebarSideFor"];
	declare openSidebarPanel: FocusMethods["openSidebarPanel"];
	declare toggleQuickPanel: FocusMethods["toggleQuickPanel"];
	declare setSidebarVisibility: FocusMethods["setSidebarVisibility"];
	declare syncSurfaceSidebars: FocusMethods["syncSurfaceSidebars"];
	declare getTabContainerFromLeaf: FocusMethods["getTabContainerFromLeaf"];
	declare revealPinnedTabIfExists: FocusMethods["revealPinnedTabIfExists"];
	declare _focusTabRemember: FocusMethods["_focusTabRemember"];
	declare _focusTabRestore: FocusMethods["_focusTabRestore"];
	declare findActiveTabContainerFromDOM: FocusMethods["findActiveTabContainerFromDOM"];
	declare updateFocusedFileMode: FocusMethods["updateFocusedFileMode"];
	declare updateWorkspaceAesthetics: FocusMethods["updateWorkspaceAesthetics"];
	declare removeMaskElements: FocusMethods["removeMaskElements"];
	declare zenActive: FocusMethods["zenActive"];
	declare letterboxActive: FocusMethods["letterboxActive"];
	declare isReadingView: FocusMethods["isReadingView"];
	declare getConfiguredFonts: FocusMethods["getConfiguredFonts"];
	declare systemFontNames: FocusMethods["systemFontNames"];
	declare fontIsInstalled: FocusMethods["fontIsInstalled"];
	declare fontFinderMatches: FocusMethods["fontFinderMatches"];
	declare ensureSystemFonts: FocusMethods["ensureSystemFonts"];
	declare applyEditorFont: FocusMethods["applyEditorFont"];
	declare typewriterScroll: FocusMethods["typewriterScroll"];
	declare typewriterAnchorRatio: FocusMethods["typewriterAnchorRatio"];
	declare hemingwaySay: FocusMethods["hemingwaySay"];
	declare buildMaskElements: FocusMethods["buildMaskElements"];
	declare titlebarAreaHeight: FocusMethods["titlebarAreaHeight"];
	declare checkZoomChange: FocusMethods["checkZoomChange"];
	declare afterReflow: FocusMethods["afterReflow"];
	declare zoomFactor: FocusMethods["zoomFactor"];
	declare isMobileApp: FocusMethods["isMobileApp"];
	declare maskTopClip: FocusMethods["maskTopClip"];
	declare stampMaskPositions: FocusMethods["stampMaskPositions"];
	declare scheduleMaskPosition: FocusMethods["scheduleMaskPosition"];
	declare buildArrowLayer: FocusMethods["buildArrowLayer"];
	declare _startPointerDrag: FocusMethods["_startPointerDrag"];
	declare _maskMaxPx: FocusMethods["_maskMaxPx"];
	declare _startVerticalDrag: FocusMethods["_startVerticalDrag"];
	declare _startHorizontalDrag: FocusMethods["_startHorizontalDrag"];
	declare getArrowChars: FocusMethods["getArrowChars"];
	declare removeCustomElements: FocusMethods["removeCustomElements"];
	declare getActiveScroller: FocusMethods["getActiveScroller"];
	declare attachScrollHandler: FocusMethods["attachScrollHandler"];
	declare detachScrollHandler: FocusMethods["detachScrollHandler"];
	declare updateMaskVisibility: FocusMethods["updateMaskVisibility"];
	declare attachResizeHandler: FocusMethods["attachResizeHandler"];
	declare detachResizeHandler: FocusMethods["detachResizeHandler"];
	// editor.ts
	declare reconfigureEditors: EditorMethods["reconfigureEditors"];
	declare setupEditorExtensions: EditorMethods["setupEditorExtensions"];
	declare buildEditorExtensions: EditorMethods["buildEditorExtensions"];
	declare buildTypographyExtension: EditorMethods["buildTypographyExtension"];
	declare applyTypography: EditorMethods["applyTypography"];
	declare buildTypographyRevertKeymap: EditorMethods["buildTypographyRevertKeymap"];
	declare buildHemingwayExtensions: EditorMethods["buildHemingwayExtensions"];
	declare flashHemingway: EditorMethods["flashHemingway"];
	declare flashHemingwayIcon: EditorMethods["flashHemingwayIcon"];
	declare flashHemingwayScreen: EditorMethods["flashHemingwayScreen"];
	declare flashHemingwayBar: EditorMethods["flashHemingwayBar"];
	declare vimApi: EditorMethods["vimApi"];
	declare applyVimMotionMaps: EditorMethods["applyVimMotionMaps"];
	declare scheduleVimMotionMaps: EditorMethods["scheduleVimMotionMaps"];
	declare capMissing: EditorMethods["capMissing"];
	// paint.ts
	declare setWindowControlColours: PaintMethods["setWindowControlColours"];
	declare clearAllBodyState: PaintMethods["clearAllBodyState"];
	declare applyTorchVars: PaintMethods["applyTorchVars"];
	declare applyBodyClasses: PaintMethods["applyBodyClasses"];
	declare chromeProps: PaintMethods["chromeProps"];
	declare clearChromeColors: PaintMethods["clearChromeColors"];
	declare applyCssVariables: PaintMethods["applyCssVariables"];
	declare firstPaintable: PaintMethods["firstPaintable"];
	declare applyStyleProps: PaintMethods["applyStyleProps"];
	declare clearStyleProps: PaintMethods["clearStyleProps"];
	declare isDarkTheme: PaintMethods["isDarkTheme"];
	declare isDarkSurface: PaintMethods["isDarkSurface"];
	// diagnostics.ts
	declare installerVersion: DiagnosticsMethods["installerVersion"];
	declare installerVerdict: DiagnosticsMethods["installerVerdict"];
	declare checkAppClasses: DiagnosticsMethods["checkAppClasses"];
	declare readStylesheetVersion: DiagnosticsMethods["readStylesheetVersion"];
	declare checkStylesheetVersion: DiagnosticsMethods["checkStylesheetVersion"];
	declare checkManifestVersion: DiagnosticsMethods["checkManifestVersion"];
	declare repairDisplay: DiagnosticsMethods["repairDisplay"];
	declare loadMark: DiagnosticsMethods["loadMark"];
	declare loadPhases: DiagnosticsMethods["loadPhases"];
	declare geometryLines: DiagnosticsMethods["geometryLines"];
	declare sheetSelfTest: DiagnosticsMethods["sheetSelfTest"];
	declare diagnostics: DiagnosticsMethods["diagnostics"];
	declare layoutDiagnostic: DiagnosticsMethods["layoutDiagnostic"];
	// ── THE FIELDS ─────────────────────────────────────────────────────────
	// Declared as the checker saw them assigned — every `this.<name> = expr` in
	// the class and every `plugin.<name> = expr` written from another module, the
	// union of the expressions' widened types. A field that reads `any` here is
	// one whose every writer was itself untyped.
	_activeBarPreset: string;
	_activeDragCleanup: (() => void) | null;
	_appClassesChecked: boolean;
	_auroraSeed: number;
	_backlinkCache: { path: string; gen: number; text: string } | null;
	_barAnimT: number;
	_barBoundsCleared: boolean;
	_barBoundsEl: HTMLDivElement | null;
	_barBoundsL: number | null;
	_barBoundsW: number | null;
	_barBoxHeight: number;
	_barPeek: boolean;
	_barPeekTimer: number | null;
	_barPicker: HTMLDivElement | null;
	_barPickerDismiss: ((e: Event) => void) | null;
	_barPickerKey: ((e: KeyboardEvent) => void) | null;
	_barRebuilding: boolean;
	_barReserve: number | null;
	_batteryHandler: (() => void) | null;
	_batteryManager: { level: number; charging: boolean; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void } | null;
	_bodyResizeObs: ResizeObserver | null;
	_capSaid: Record<string, boolean>;
	_capsLockOn: boolean;
	_colorProbeEl: HTMLSpanElement | null;
	_docStatsCache: { doc: CmText | null; totalWC: number; charCount: number; paras: { start: number; end: number }[]; tasks: { done: number; all: number } } | null;
	_explorerClick: ((ev: Event) => void) | null;
	_exportPage: number;
	_exportZoom: number | null;
	_fenceCache: { doc: CmText; set: Set<unknown> } | null;
	_fitPending: boolean;
	_fitShortenFile: boolean;
	_fitShortenHead: number;
	_fitShortenHeadWidth: number;
	_fitShortenWidth: number;
	_flagsSig: string;
	_flagStamp: string;
	_fmCache: Record<string, Record<string, boolean | string> | null>;
	_focusTabPrev: Map<HTMLElement, { display: string; width: string; flexGrow: string; flexShrink: string; flexBasis: string }>;
	_folderWordBusy: boolean;
	_folderWordCache: { path: string; words: number } | null;
	_goalsFoldedFrom: string | null;
	_goalsFoundAt: string | null;
	_goalsSig: string | null;
	_goalStates: { kind: string; ratio: number; met: boolean }[];
	_goalsTimer: number | null;
	_goalsWritten: boolean;
	_goalWasMet: boolean | null;
	_hemFlashTimer: number | null;
	_hemIconTimer: number | null;
	_hemSaid: boolean;
	_hemScreenEl: HTMLElement | null;
	_hemScreenTimer: number | null;
	_history: WsHistoryRecord | null;
	_historyDirtyAt: number;
	_historyLoading: Promise<WsHistoryRecord> | null;
	_historyPath: string | null;
	_historyReady: boolean;
	_historySaveTimer: number | null;
	_historyTimers: Map<string, number>;
	_historyWriting: boolean;
	_isTogglingZen: boolean;
	_lastMdView: MarkdownView;
	_lastScopeInScope: boolean | null;
	_lastTypo: { from: number; to: number; caret: number; glyph: string; original: string; time: number } | null;
	_lastZoom: number;
	_linkGen: number;
	_loadMarks: [string, number][];
	_manifestWarned: boolean;
	_maskNotches: { nl: number; nr: number; nh: number; } | null;
	_maskRaf: number | null;
	_maskRetries: number;
	_menuPanelRegistered: boolean;
	_reviving: Promise<void> | null;
	_mirrorFoundAt: string | null;
	_mirrorSig: string;
	_mirrorTimer: number | null;
	_numLockOn: boolean;
	_openModals: Set<{ containerEl?: HTMLElement; close(): void }>;
	// the settings tab, held so onunload can cut its observer
	_settingsTab: WordSmithSettingTab | null;
	_orgAt: () => string;
	_orgBackMap: { gen: number; map: Map<string, string[]> } | null;
	_orgBarSay: () => string;
	_orgColOn: (id: string, on: boolean) => void;
	_orgCtx: () => WsOrgCtx;
	_orgDraw: () => void;
	_orgFieldEditor: (td: HTMLElement, p: string, k: string) => HTMLInputElement | null;
	_orgFit: () => void;
	_orgFlagSet: (row: { path: string }, id: string, cell: HTMLElement | null) => Promise<void>;
	_orgGripAt: (host: HTMLElement, x: number, y: number) => HTMLElement | null;
	_orgGripDrag: () => number;
	_orgHist: { run: (what: string) => void; canUndo: () => boolean; canRedo: () => boolean; undoLabel: () => string; redoLabel: () => string } | null;
	_orgHistActive: ((ev: KeyboardEvent) => void) | null;
	_orgHistKey: (ev: KeyboardEvent) => void;
	_orgIndex: WsOrgIndexMap;
	_orgIndexBuild: Promise<WsOrgIndexMap> | null;
	_orgIndexSubs: Set<() => void>;
	_orgLens: () => { sort: WsLensSort | null; chips: WsLensChip[] };
	_orgLensSet: (patch: { sort?: WsLensSort | null; chips?: WsLensChip[] }) => void;
	_orgRedraw: () => void;
	_orgNote: () => string;
	_orgOpen: () => string[];
	_orgOpenSet: (p: string, on: boolean) => void;
	_orgPropKeys: (at: string) => string[];
	_orgPropListSet: (p: string, k: string, v: unknown, before: unknown) => Promise<boolean>;
	_orgPropRows: () => { col: WsOrgCol | null; key: string; name: string; dead: boolean }[];
	_orgPropSet: (p: string, k: string, v: unknown) => Promise<boolean>;
	_orgPruneUserCols: () => boolean;
	_orgScope: () => string;
	_orgScopes: () => string[] | null;
	_orgSel: () => string[];
	_orgSelSet: (paths: string[]) => void;
	_orgSubject: () => HTMLDivElement;
	_orgSubjectRows: () => { kind: string; path: string; }[];
	_orgWindows: WsOrgDoor[];
	_orgZoom: () => number;
	_outlinerPaneRegistered: boolean;
	_panelPointerDown: boolean;
	_panelRefreshPending: boolean;
	_panelSide: string;
	_panelWasOpen: boolean;
	_paraCache: { doc: string | string[] | CmText; val: { body: Set<unknown>; first: Set<unknown> } } | null;
	_passState: { marks: number[] };
	_patchAgain: boolean;
	_patchRunning: boolean;
	_patchScheduled: boolean;
	_peekArmed: boolean;
	_peekZoneTop: number;
	_quickCycleHere: WorkspaceLeaf | null;
	_quickCycleLast: Map<WorkspaceSidedock | WorkspaceMobileDrawer, WorkspaceLeaf>;
	_rawData: Record<string, unknown> | null;
	_readerBeside: WorkspaceLeaf | null;
	_refreshTimer: number | null;
	_repairedKeys: string[];
	_scopeGen: number;
	_selectionRaf: number | null;
	_settingsUndo: Record<string, unknown> | null;
	_sheetTest: string;
	_sidebarsSuspended: boolean;
	_stampZoom: number;
	_startBlocked: { kind: string; text: string; } | null;
	_startTripped: boolean;
	_statusRowEls: HTMLElement[];
	_storeFailSaid: Record<string, boolean>;
	_storeLast: { path: string; eol: string; same: boolean; at: number; };
	_structFoundAt: string | null;
	_structReading: Promise<Record<string, WsStructRow[]>> | null;
	_structRepaired: string[];
	_structSources: WsStructSource[];
	_structStore: Record<string, WsStructRow[]>;
	_structText: string;
	_structWriteQ: Promise<unknown> | null;
	_styleWarned: boolean;
	_suspendedLeft: boolean;
	_suspendedRight: boolean;
	_sysFonts: string[];
	_sysFontsFrom: string;
	_sysFontsQ: Promise<string[]> | null;
	_tabContainersCache: HTMLElement[] | null;
	_themeGuarding: boolean;
	_themeObsBusy: boolean;
	_themeObserver: MutationObserver | null;
	_themeSurfaceCache: Record<string, string> | null;
	_themeVarKeys: string[];
	_themeVarUniverse: string[];
	_ticksScheduled: boolean;
	_treeCountDirty: Set<string>;
	_treeCountTimer: number | null;
	_treeCountWatchers: Set<(paths: string[]) => void>;
	_treeIndexBell: (() => void) | null;
	_treeOrderLoading: boolean;
	_treeOrderWatchers: Set<() => void>;
	_treeShapeQueued: boolean;
	_vimMapped: boolean;
	_vimPanelOpen: boolean;
	_wasZenMode: boolean;
	_wcoWas: { color: string; symbolColor: string } | null;
	_wsDragPath: string | null;
	_wsDropRow: HTMLElement | null;
	_wsIconDone: boolean;
	_wsLastTotalWordCount: number;
	_wsSession: WsSession | null;
	_wsSortRowBound: boolean;
	_wsTreeDragBound: boolean;
	arrowsBottomEl: HTMLDivElement | null;
	arrowsTopEl: HTMLDivElement | null;
	batteryCharging: boolean;
	batteryLevel: number | null;
	caps: Record<string, boolean | null>;
	clockInterval: number | null;
	currentScroller: HTMLElement | null;
	editorExtensions: Extension[];
	explorerObserver: MutationObserver | null;
	maskBottomEl: HTMLDivElement | null;
	maskGuardLeftEl: HTMLDivElement | null;
	maskGuardRightEl: HTMLDivElement | null;
	maskResizeObserver: ResizeObserver | null;
	maskTopEl: HTMLDivElement | null;
	retroPlinthEl: HTMLDivElement | null;
	retroStatusBarEl: HTMLDivElement | null;
	scrollHandler: (() => void) | null;
	windowResizeHandler: (() => void) | null;
	// per path: the tree's old count (`count`), a note's stats and tasks under
	// `stats:<path>`, the tasks alone under the tasks pass's own key
	wordCountCache: Map<string, { mtime: number; count?: number; stats?: WsTextStats; tasks?: { done: number; all: number } | null }>;
	wsRibbonEl: HTMLElement | null;
	// Obsidian 1.13 declares `settings?: unknown` on Plugin — "declare a
	// concrete type on your subclass to type it". The schema is the defaults
	// (ts/src/settings.ts): every key held to its default's kind.
	settings: WordSmithSettings;

	// ════════════════════════════════════════════════════════════════════════
	// THE BOUNDARY
	// ════════════════════════════════════════════════════════════════════════
	//
	// REFUSED WHERE THE THING IS BORN. Every DOM listener and every command
	// this plugin owns is created by exactly one method each, so the guard goes
	// on the method rather than on the call sites that use them — a wrapper
	// applied per site is a wrapper the next call site forgets.
	//
	// `super` IS NOT ALWAYS THERE. The tests stub `Plugin` as an empty class,
	// so calling straight through would throw the moment a test registered
	// anything. The fallback is the path the tests take, and it is asserted.
	registerDomEvent(el: Window | Document | HTMLElement, type: string, cb: (ev: Event) => unknown, opts?: boolean | AddEventListenerOptions): void {
		const w = wsGuard(cb, 'a ' + type + ' handler');
		if (typeof super.registerDomEvent === 'function') {
			return super.registerDomEvent(el as HTMLElement, type as keyof HTMLElementEventMap, w, opts);
		}
		try { el.addEventListener(type, w, opts); } catch (_) { wsCatch('registerDomEvent: el.addEventListener(type, w, opts);', _); }
		return undefined;
	}

	// A COMMAND HAS FOUR PLACES TO PUT A FUNCTION and Obsidian calls whichever
	// is present. Naming them here rather than wrapping “every function-valued
	// key” keeps `icon` and `hotkeys` out of it, and a new kind of callback in
	// a future API shows up as an unguarded one rather than as a mystery.
	//
	// A THROWN `checkCallback` NOW RETURNS UNDEFINED, which reads as false, so
	// the command hides itself from the palette rather than offering an action
	// that cannot work. That is the right direction to fail in.
	addCommand(cmd: Command) {
		const c = cmd;
		try {
			const id = (c && c.name) ? c.name : ((c && c.id) ? c.id : 'a command');
			const bag = c as unknown as Record<string, unknown>;
			for (const k of ['callback', 'checkCallback',
				'editorCallback', 'editorCheckCallback']) {
				const fn = bag[k];
				if (typeof fn === 'function') bag[k] = wsGuard(fn as (...args: never[]) => unknown, 'the “' + id + '” command');
			}
		} catch (_) { wsCatch('addCommand: const id = (c && c.name) ? c.name : ((c && c.id) ? c.id : \'a …', _); }
		if (typeof super.addCommand === 'function') return super.addCommand(c);
		return c;
	}

	// AND ONE DOOR FOR VAULT AND WORKSPACE EVENTS. `registerEvent` takes an
	// EventRef, not a function — the callback is already inside `.on(...)` by
	// the time it is handed over — so this is the one boundary that cannot be
	// closed by an override and has to be called instead of it. A checker
	// keeps the bare form from coming back.
	onAppEvent(emitter: Events, name: string, cb: (...data: never[]) => unknown) {
		try {
			// THE ONE PLACE `registerEvent` IS STILL CALLED BARE, and it has to
			// be: this is the wrapper. The checker below knows this line by
			// name — a sweep that converts every plain shape converted THIS
			// one too on its first run, into a call to itself.
			return this.registerEvent(emitter.on(name, wsGuard(cb, 'the ' + name + ' handler')));
		} catch { return undefined; }
	}

	// ════════════════════════════════════════════════════════════════════════
	// LIFECYCLE
	// ════════════════════════════════════════════════════════════════════════

	// THE GUARD'S NOTICE. A method rather than a closure in onload, so a test
	// whose fixture never runs onload can build one and look at it. The button
	// copies where it stopped, the stack, and the diagnostics: a report can
	// carry all three without the reporter opening a console. Returns the
	// fragment.
	guardNotice(where: string, err: unknown) {
		let frag = null;
		try {
			frag = createFragment();
			const p = createDiv();
			p.textContent = 'Word-Smith: something went wrong in ' + where
				+ '. The rest of Obsidian is unaffected. This is said once a session.';
			frag.appendChild(p);
			const b = createEl('button');
			b.textContent = 'Copy details';
			b.className = 'ws-guard-copy';
			b.addEventListener('click', (ev) => { void (async () => {
				try { ev.stopPropagation(); } catch (_) { wsCatch('guardNotice: ev.stopPropagation();', _); }
				let text = 'Word-Smith: ' + where + '\n' + ((err instanceof Error && err.stack) || wsStr(err)) + '\n\n';
				try { text += this.diagnostics(); } catch (_) { wsCatch('guardNotice: text += this.diagnostics();', _); }
				try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; }
				catch { b.textContent = 'Could not copy'; }
			})(); });
			frag.appendChild(b);
			new Notice(frag, 20000);
		} catch (_) { wsCatch('guardNotice: frag = createFragment();', _); }
		return frag;
	}

	// ── THE START GUARD AND THE INSTALLER GATE ─────────────────────────────
	//
	// One mark per vault per device, in localStorage rather than data.json:
	// synchronous, no disk write on every launch, and a sync client cannot
	// carry it to a machine that did not freeze. `startStore` is a door for
	// the tests (a DOM's localStorage can throw on an opaque origin).
	startStore() {
		try { return window.localStorage || null; } catch { return null; }
	}

	startGuardKey() {
		const id = (this.app && this.app.appId) || 'vault';
		return 'word-smith:starting:' + id;
	}

	// Returns true when the last start never took its mark away.
	startGuardBegin() {
		let tripped = false;
		try {
			const st = this.startStore();
			if (!st) return false;
			const k = this.startGuardKey();
			tripped = st.getItem(k) != null;
			st.setItem(k, String(Date.now()));
		} catch { return false; }
		return tripped;
	}

	startGuardEnd() {
		try { const st = this.startStore(); if (st) st.removeItem(this.startGuardKey()); } catch (_) { wsCatch('startGuardEnd: const st = this.startStore();', _); }
	}

	// null, or { kind: 'refuse' | 'safe', text }. Read once, after settings.
	startBlocked() {
		const v = this.installerVerdict(this.installerVersion());
		if (v.kind === 'refuse') return { kind: 'refuse', text: v.text };
		if (this._startTripped) {
			return { kind: 'safe', text: 'Word-Smith: the last start did not finish, so everything is off this time.'
				+ ' Settings \u2192 Word-Smith has a button to try again; if it freezes again, check your installer version (Settings \u2192 General) and open an issue.' };
		}
		return null;
	}

	// The door on the banner: a real off-and-on through Obsidian, so every
	// command, event and extension the blocked start skipped is registered.
	async startAgain() {
		const id = (this.manifest && this.manifest.id) || 'word-smith';
		const pl = this.app && this.app.plugins;
		if (!pl || !pl.disablePlugin || !pl.enablePlugin) return false;
		await pl.disablePlugin(id);
		await pl.enablePlugin(id);
		return true;
	}

	async onload() {
		// FIRST LINE, so the first phase includes the field initialisation
		// below it — three hundred assignments is not free and it is exactly
		// the kind of thing nobody thinks to measure.
		this.loadMark('start');
		// THE CRASH-LOOP GUARD. A freeze at start repeats at every start until
		// the plugin is removed by hand. A mark is written here and taken away
		// two seconds after the first real refresh; a mark found at the NEXT
		// start means the last one never got that far, and this start builds
		// nothing. The verdict is read after the settings load, in
		// startBlocked().
		this._startTripped = this.startGuardBegin();
		// ONE SENTENCE, ONCE A SESSION, when something this plugin owns throws
		// and is contained. The console has the detail and the site; a writer
		// whose Obsidian froze could not open the console to read it, which is
		// the whole reason there is a Notice at all. Wired here rather than in
		// the helper because `Notice` does not exist under the tests. The notice
		// carries a copy button, so a report can carry the stack and the
		// diagnostics without the reporter opening a console.
		wsGuardTell((where, err) => this.guardNotice(where, err));
		// ── Mask / letterbox state ─────────────────────────────────────────────
		this.maskTopEl        = null;
		this.maskBottomEl     = null;
		this.arrowsTopEl      = null;
		this.arrowsBottomEl   = null;
		this.maskResizeObserver = null;
		this._maskRaf         = null;

		// ── Retro bar state ───────────────────────────────────────────────────
		this.retroStatusBarEl = null;
		// Peek state for a hidden bar (see syncBarPeekState).
		this._peekArmed    = false;
		this._peekZoneTop  = Infinity;
		this._barPeek      = false;
		this._barPeekTimer = null;
		this._barBoxHeight = 0;
		this.retroPlinthEl = null;
		this.clockInterval    = null;
		this.batteryLevel     = null;
		this.batteryCharging  = false;
		this._batteryManager  = null;   // kept so listeners can be detached on unload
		this._batteryHandler  = null;
		this._wsLastTotalWordCount = 0;
		this._docStatsCache   = null;   // { doc, totalWC, charCount, paras } keyed on CM doc identity
		this._capsLockOn      = false;  // tracked from keyboard events for {caps}
		this._numLockOn       = false;  // tracked from keyboard events for {nump}
		this._statusRowEls    = [];     // per-row elements, for per-row text fitting
		this._goalWasMet      = null;   // previous goal state, to fire the celebration once
		this._fenceCache      = null;   // { doc, set } of non-prose line numbers
		this._paraCache       = null;   // { doc, val } paragraph geometry
		this._lastTypo        = null;   // last typography substitution, for backspace-to-revert
		this._barPicker       = null;   // open bar popup, if any
		this._barPickerDismiss = null;
		this._barPickerKey    = (e) => { if (e.key === 'Escape') this.closeBarPicker(); };
		this._vimMapped       = false;  // whether our vim motion maps are installed
		this._fmCache         = {};     // path -> frontmatter overrides
		this._hemFlashTimer   = null;   // clears the blocked-key flash class
		this._scopeGen        = 0;      // bumped on file/layout change; keys the per-editor scope cache
		this._lastScopeInScope = null;  // last known scope state of the active file

		// ── Scroll / resize handlers ──────────────────────────────────────────
		this.currentScroller  = null;
		this.scrollHandler    = null;
		this.windowResizeHandler = null;

		// ── Paragraph tagger ──────────────────────────────────────────────────

		// ── Style injection ───────────────────────────────────────────────────

		// ── Word count cache ──────────────────────────────────────────────────
		this.explorerObserver = null;
		this.wordCountCache   = new Map();
		this._patchScheduled  = false;

		// ── Zen state ─────────────────────────────────────────────────────────
		this._isTogglingZen   = false;
		this._wasZenMode      = false;
		this._tabContainersCache = null;

		// ── Surface gate ──────────────────────────────────────────────────────
		// Whether zen's sidebar collapse is currently suspended because the
		// active pane is not a note, and what to put back when it is again.
		this._sidebarsSuspended = false;
		this._suspendedLeft     = false;
		this._suspendedRight    = false;
		// Last value written to --ws-bar-reserve, so the mask pass (which
		// runs on scroll) only touches :root when the strip actually
		// changes depth.
		this._barReserve        = null;

		// ── Drag / refresh bookkeeping ────────────────────────────────────────
		this._activeDragCleanup = null;   // aborts an in-flight mask drag on unload
		this._refreshTimer      = null;   // debounced saveSettings → refresh

		// ── Live selection rAF ────────────────────────────────────────────────
		this._selectionRaf    = null;

		// ── The docked menu's revival: one pass in flight at a time ──
		this._reviving        = null;

		// ── Theme observer ────────────────────────────────────────────────────
		this._themeObserver   = null;

		this.loadMark('fields');
		await this.loadSettings();
		// THE ONE MOST LIKELY TO BE THE ANSWER: it reads data.json, runs
		// every migration, and on a fresh vault writes defaults back.
		this.loadMark('loadSettings');
		// ── AN OLD INSTALLER IS NOT AN OLD APP ──────────────────────────────
		//
		// `minAppVersion` in the manifest gates the APP version, which
		// auto-updates — but the INSTALLER is the Electron shell, which never
		// does. A writer can be on a current app inside an old installer, sail
		// past the manifest gate, and get a stylesheet full of declarations
		// their Chromium has never heard of: `color-mix()` needs Chromium 111
		// and `:has()` needs 105. Both fail INVISIBLY — an invalid declaration
		// is dropped, not reported — so it files itself as "the plugin looks
		// broken".
		//
		// AND THE GATE: installers 1.5.12 and 1.8.3 froze Obsidian on enable,
		// 1.12.7 lagged, and every one of them was cured by a fresh installer.
		// Below 1.9 the plugin refuses to start and says why, once per launch;
		// between 1.9 and 1.13 it warns once per installer, remembered in
		// settings — a warning on every launch is a warning that gets turned
		// off in the reader's head. The version is the `obsidian/x.y.z` token
		// in the user agent, which is the INSTALLER speaking (the app can say
		// 1.13.7 while the token says 1.13.4); a phone has no token and is
		// never refused, and iOS has no Chromium to be warned about.
		try {
			const v = this.installerVerdict(this.installerVersion());
			if (v.kind === 'warn' && this.settings.oldInstallerSaid !== v.major) {
				this.settings.oldInstallerSaid = v.major || 0;
				void this.saveSettings(true);
				new Notice(v.text, 30000);
			}
		} catch (_) { wsCatch('onload: const v = this.installerVerdict(this.installerVersion());', _); }
		// A BLOCKED START BUILDS NOTHING. The settings tab is the one surface
		// that still opens, carrying the reason and, in safe mode, the door.
		// AND THE MARK COMES OFF AT ONCE: a blocked start builds nothing, so
		// there is nothing in it to freeze, and leaving the mark would make
		// every later start blocked too. Thirty seconds, not for ever: the
		// settings tab carries the reason for as long as it takes.
		const blocked = this.startBlocked();
		if (blocked) {
			this._startBlocked = blocked;
			this.startGuardEnd();
			try { new Notice(blocked.text, 30000); } catch (_) { wsCatch('onload: new Notice(this._startBlocked.text, 30000);', _); }
			this._settingsTab = new WordSmithSettingTab(this.app, this);
			this.addSettingTab(this._settingsTab);
			this.loadMark('blocked');
			return;
		}
		// Settle the Glass borrow, if this vault has one outstanding. Runs
		// once and clears itself; see barThemeGlassRepay. (`saveSettings`
		// catches its own write, so this catch is a belt over a belt — kept
		// because it costs nothing.)
		if (this.barThemeGlassRepay()) { try { await this.saveSettings(); } catch (_) { wsCatch('onload: await this.saveSettings();', _); } }
		this._wasZenMode = this.zenOn();

		// Zen mode persists across restarts, but _wasZenMode above makes
		// setSidebarVisibility() a no-op on the first refresh() — so a vault
		// relaunched in zen mode could come back with body classes applied yet
		// sidebars open. Force the sidebars into the zen state once the
		// workspace layout exists, without touching the saved pre-zen
		// leftSidebar/rightSidebar restore state.
		this.app.workspace.onLayoutReady(() => {
			// THE ORDER, BEFORE THE FIRST SORT. `sortFolderItems` runs inside
			// Obsidian's own render and cannot wait for a file, so the store
			// is read once here and the tree is asked to sort again when it
			// lands. Without the second half the first draw of a session is
			// alphabetical and stays that way until something else moves.
			// THE CAPABILITIES ARE PROBED FOR EVERY VAULT, not only one with the
			// tree order on: the diagnostics dump and capMissing read them.
			try { this.caps = wsCompat(this.app).caps; } catch { this.caps = {}; }
			if (!this.settings.pluginEnabled || !this.settings.treeOrder) return;
			// ASKED WHEN THERE ARE PANES TO ASK. Half the table is about views
			// that do not exist during `onload`, and a look that runs too early
			// answers `null` for everything — honest and useless. `caps` is read
			// by the diagnostics dump.
			void this.treeOrderLoad().then(() => this.patchExplorerSort());
		});

		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.pluginEnabled || !this.zenOn()) return;
			const ws = this.app.workspace;
			if (ws.leftSplit  && !ws.leftSplit.collapsed)  ws.leftSplit.collapse();
			if (ws.rightSplit && !ws.rightSplit.collapsed) ws.rightSplit.collapse();
		});

		// Before anything draws a flag: the table every label and shape is
		// read from is built from the settings, not from the source.
		try { this.flagsApply(); } catch (_) { wsCatch('onload: this.flagsApply();', _); }

		this._settingsTab = new WordSmithSettingTab(this.app, this);
		this.addSettingTab(this._settingsTab);
		this.loadMark('settings tab');
		void this.setupBattery();

		// Commands
		// The panel: registered whenever the setting is on, so a workspace
		// saved with the pane open restores it at startup rather than
		// needing the writer to open it again.
		if (this.settings.menuDock) this.registerMenuPanel();
		// REGISTERED UNCONDITIONALLY AND AT LOAD, which is not the same as
		// building anything. Obsidian restores a saved workspace by asking
		// for the view type by name; a plugin that registers it lazily leaves
		// a writer's pane as an empty "no view of type" box until they happen
		// to run the command. Registering is a map entry — the tree is built
		// in `onOpen`, and only if the pane is actually there.
		this.registerOutlinerPane();
		// THE METHODS STAY WHERE THEY HAVE OTHER CALLERS: `openOutlinerPane` is
		// how `orgOpenTab` opens a tab that is not open, and `openOutlinerPopout`
		// is the window’s own pop-out door. `openWritingLayout` had no caller but
		// its command and goes with it.
		// A REPORT A WRITER CAN PASTE. Two freeze reports carried an OS, a
		// version and two console lines, one of which blamed Obsidian for a
		// method it has. This carries what would have answered them — and it
		// copies, because one of those writers could not open the console
		// after the freeze.
		this.addCommand({
			id: 'repair-display',
			name: 'Repair the display (draw everything again)',
			callback: () => { this.repairDisplay(); new Notice('Word-Smith: repaired.', 4000); }
		});
		this.addCommand({
			id: 'copy-settings',
			name: 'Copy your settings as text',
			callback: async () => {
				try { await navigator.clipboard.writeText(this.settingsCopyText()); new Notice('Word-Smith: settings copied.', 4000); }
				catch { new Notice('Word-Smith: could not reach the clipboard.', 6000); }
			}
		});
		this.addCommand({
			id: 'paste-settings',
			name: 'Paste settings from the clipboard (replaces everything; the settings can undo it)',
			callback: async () => {
				let text = '';
				try { text = await navigator.clipboard.readText(); } catch { new Notice('Word-Smith: could not read the clipboard.', 6000); return; }
				const r = await this.settingsPasteText(text);
				new Notice('Word-Smith: ' + (r.error !== undefined ? r.error : (r.applied + ' setting(s) pasted' + (r.repaired.length ? ', ' + r.repaired.length + ' reset' : '') + '.')), 8000);
			}
		});
		this.addCommand({
			id: 'copy-diagnostics',
			name: 'Copy diagnostics for a bug report',
			callback: async () => {
				// A PAUSE FIRST: on a phone this runs from the command palette, whose
				// search field has the keyboard up and the workspace shrunk. 1200ms is
				// inside the five seconds a user gesture keeps the clipboard open for.
				await new Promise((r) => window.setTimeout(r, 1200));
				try { await this.sheetSelfTest(); } catch (_) { wsCatch('onload / callback: await this.sheetSelfTest();', _); }
				let text = '';
				try { text = this.diagnostics(); }
				catch (e) { text = 'Word-Smith: diagnostics failed — ' + wsErrMsg(e); }
				try {
					await navigator.clipboard.writeText(text);
					new Notice('Word-Smith: diagnostics copied. Paste them into the '
						+ 'issue.', 6000);
				} catch {
					// THE CLIPBOARD CAN REFUSE — no permission, or no focus. The
					// console is the fallback and NOT the plan: a writer who
					// cannot open it has been told that much by the failure.
					try { console.warn(text); } catch (_e) { wsCatch('onload / callback: console.warn(text);', _e); }
					new Notice('Word-Smith: could not reach the clipboard — the '
						+ 'diagnostics are in the developer console instead.', 8000);
				}
			}
		});
		this.addCommand({
			id: 'open-export',
			name: 'Export a manuscript\u2026',
			callback: () => this.openExportModal()
		});
		this.addCommand({
			id: 'open-menu-panel',
			name: 'Open the menu in a panel',
			callback: async () => {
				if (!this.settings.menuDock) {
					new Notice('Word-Smith: switch on the panel first, in the settings under Powermenu.');
					return;
				}
				await this.openMenuPanel(true);
			}
		});
		this.addCommand({
			id: 'toggle-retro-bar',
			name: 'Toggle the Powerline bar',
			// Mirrors the settings-tab switch: flip the master, repaint, and
			// save with a full refresh — the refresh is what lifts/reapplies
			// the inline display:none on Obsidian's native status bar.
			callback: async () => {
				// ON A PHONE WITH ITS OWN SWITCH OFF, SAY WHY NOTHING HAPPENS rather
				// than flip a master that changes nothing on this screen.
				if (typeof Platform !== 'undefined' && Platform && Platform.isPhone
					&& !this.settings.retroBarOnPhone) {
					new Notice('Word-Smith: the bar is off on phones by default. Switch it on in the settings, under Powerline.', 6000);
					return;
				}
				this.settings.enableRetroStatus = !this.settings.enableRetroStatus;
				this.updateStatusBar();
				this.updateRetroStatusBar();
				await this.saveSettings(true);
			}
		});
		this.addCommand({
			id: 'toggle-wordsmith',
			name: 'Turn everything on or off',
			callback: () => this.toggleFullPlugin()
		});
		this.addCommand({
			id: 'cycle-bar-preset',
			name: 'Cycle Powerline presets',
			callback: () => this.cycleBarPreset(1)
		});

		// ── Feature toggles ───────────────────────────────────────────────
		// One shape for all of them: flip the master flag, save with an
		// immediate refresh so the change is on screen before the palette
		// has finished closing, and say which way it went. The Notice is
		// not decoration — several of these are invisible on a note that
		// happens not to trigger them (no passive voice, no long sentences),
		// and a toggle you cannot confirm reads as a toggle that did nothing.
		const featureToggle = (id: string, name: string, key: WsBoolKey, label: string) => {
			this.addCommand({
				id, name,
				callback: async () => {
					this.settings[key] = !this.settings[key];
					await this.saveSettings(true);
					new Notice(label + (this.settings[key] ? ' on' : ' off'));
				}
			});
		};
		featureToggle('toggle-letterbox', 'Toggle letter box mode',
			'enableLetterbox', 'Letter box mode');
		featureToggle('toggle-typewriter', 'Toggle typewriter mode',
			'enableTypewriter', 'Typewriter mode');
		featureToggle('toggle-hemingway', 'Toggle Hemingway mode',
			'hemingwayEnabled', 'Hemingway mode');
		featureToggle('toggle-syntax', 'Toggle syntax highlighting',
			'posEnabled', 'Syntax highlighting');
		featureToggle('toggle-prose-checks', 'Toggle prose checks',
			'checksEnabled', 'Prose checks');

		// Zen is not a plain flag — it collapses sidebars, hides chrome and
		// records what to put back — so it routes through its own method
		// rather than being flipped here.
		this.addCommand({
			id: 'toggle-zen',
			name: 'Toggle zen mode',
			callback: () => this.toggleZen()
		});

		// The id is NOT renamed with the label. It is the key a user's
		// hotkey is bound to, and a hotkey that silently stops working is a
		// worse defect than the wrong noun in a palette.
		this.addCommand({
			id: 'open-report',
			name: 'Show the writing report',
			callback: () => this.openReportModal()
		});

		// Its own command, not a mode of the report's: they are two windows
		// now, and one of them works with no note open.
		this.addCommand({
			id: 'open-history',
			name: 'Show the writing history',
			callback: () => this.openHistoryModal()
		});

		// THE UNIFIED WINDOW — a tree with the report and the history beside
		// it. Its own command while it is being built, rather than taking
		// over the four the palette already has: those still open the four
		// windows, and a writer who finds this one wanting can go straight
		// back to them. When the Export tab lands and the old four become
		// wrappers, this becomes the way in and they point at it.
		this.addCommand({
			id: 'open-manuscript',
			name: 'Open the Organizer',
			// THE PANE: the id and the name are promised to every saved hotkey and
			// stay. THE SWITCH: off, the command is not offered.
			checkCallback: (checking: boolean) => {
				if (this.settings.organizerOn === false) return false;
				if (!checking) void this.orgOpenTab('organizer');
				return true;
			}
		});

		// Quick panels — the left/right sidebar toggle and "reveal the view"
		// as one keystroke, with the sidebar closing again once you have
		// picked something.
		//
		// checkCallback, not callback: returning false while `checking` is
		// true takes the command OUT of the palette, which is the official
		// way to make one conditional. Obsidian has no public
		// removeCommand, so a plain callback gated on the setting would
		// leave a dead entry in the palette whenever the toggle was off.
		const quickCmd = (id: string, name: string, key: WsBoolKey, viewType: string) => this.addCommand({
			id, name,
			checkCallback: (checking: boolean) => {
				if (!this.settings[key]) return false;
				if (!checking) void this.toggleQuickPanel(viewType);
				return true;
			}
		});
		// Capture, so the translation happens before the view sees a letter
		// it has no use for. Registered once and gated inside, rather than
		// hooked and unhooked as the setting changes.
		this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => this.quickCycleVimKey(e), true);

		quickCmd('quick-file-explorer', 'Quick file explorer',
			'quickExplorer', 'file-explorer');
		quickCmd('quick-outline', 'Quick outline', 'quickOutline', 'outline');

		// Quick cycle. Four commands, no default hotkeys — Alt+arrows and
		// Alt+hjkl are both good bindings and which one a writer wants
		// depends on whether they think in vim, so the choice is left in
		// Obsidian's Hotkeys pane where it can be either or both. Alt is
		// untouched by vim mode, so neither conflicts in any mode.
		this.addCommand({
			id: 'open-menu',
			name: 'Open the menu',
			callback: () => this.openBarMenu()
		});

		for (const dir of ['left', 'right', 'up', 'down']) {
			this.addCommand({
				id: 'quick-cycle-' + dir,
				name: 'Quick cycle: focus ' + dir,
				checkCallback: (checking: boolean) => {
					if (!this.settings.quickCycle) return false;
					if (!checking) void this.quickCycleMove(dir);
					return true;
				}
			});
		}

		// The mark, registered before anything can ask for it.
		try { if (addIcon) addIcon(WS_ICON, WS_ICON_SVG); } catch (_) { wsCatch('onload: if (addIcon) addIcon(WS_ICON, WS_ICON_SVG);', _); }
		// The icon first: the ribbon is about to ask for it by name.
		this.loadMark('commands');
		this.registerWsIcon();
		// "WS" badge ribbon button — OPENS THE MENU. On mobile Obsidian lists
		// ribbon items by this label, so the label is the only thing a phone
		// shows — it has to say what the button does. Obsidian's addRibbonIcon
		// expects a Lucide icon name; we replace the SVG it inserts with a text
		// badge and use a class hook for styling. The label doubles as the
		// tooltip. It opens the menu and not the master switch: the most
		// visible button must not be the most destructive one, a mis-click
		// that strips the workspace. MADE BY ITS OWN METHOD: the master switch
		// takes it off the ribbon and puts it back, and both need the same
		// builder.
		if (this.settings.pluginEnabled !== false) this.wsRibbonMake();

		// Workspace events
		// OUR ROWS ON OBSIDIAN'S OWN TREE, where the writer is already standing
		// when the thought occurs — the same place Obsidian puts every other
		// thing you can do to a folder.
		//
		// AND NOT ON OUR OWN, WHICH WOULD ADD THEM TWICE. The Organizer builds
		// its context menu by calling `fileMenuFor` directly — deliberately
		// BEFORE Rename and Delete, so both trees answer a right-click the same
		// way — and then broadcasts `file-menu` so a writer's other plugins
		// still work in this window. `fileMenuFor` is not idempotent (it appends
		// rows to a menu it did not build), so this listener skips the broadcast
		// by its source string: every other plugin still hears the event, and
		// the one listener that has already had its say stays quiet.
		this.onAppEvent(this.app.workspace, 'file-menu',
			(menu: Menu, file: TAbstractFile, source: string) => {
				if (source === 'word-smith-outliner') return;
				this.fileMenuFor(menu, file);
			});
		// SEVERAL ROWS AT ONCE: select folders in Obsidian's tree, right-click,
		// "Export these".
		this.onAppEvent(this.app.workspace, 'files-menu',
			(menu: Menu, files: TAbstractFile[], source: string) => {
				if (source === 'word-smith-outliner') return;
				this.filesMenuFor(menu, files);
			});

		this.onAppEvent(this.app.workspace, 'file-open', (file: TAbstractFile) => {
			// THE NOTE YOU OPEN IS FOLLOWED by every open Organizer.
			this.orgTreeFollow(file && file.path);
			this.syncScope();
			this.applyEditorFont();
			this.applyVimMotionMaps();
			this.updateWorkspaceAesthetics();
		});
		this.onAppEvent(this.app.workspace, 'active-leaf-change', () => {
			this.syncScope();
			this.applyEditorFont();
			// Vim state is rebuilt with the editor, taking our maps with it.
			this.applyVimMotionMaps();
			this.updateWorkspaceAesthetics();
			this.scheduleExplorerPatch();
			if (this.zenActive() && this.settings.focusedFileMode) void this.updateFocusedFileMode();
			this.typewriterScroll();
			// A tab put behind another is a leaf-change, not a layout-change;
			// the tree's boxes belong to a tab that is on screen.
			this.orgTicksSchedule();
		});
		this.onAppEvent(this.app.workspace, 'editor-change', () => {
			this.updateRetroStatusBar();
			this.typewriterScroll();
		});
		this.onAppEvent(this.app.workspace, 'resize', () => {
			this.scheduleMaskPosition();
			// Re-measure: a narrower window drops tokens, a wider one puts
			// them back.
			this.scheduleFit();
		});
		this.onAppEvent(this.app.workspace, 'layout-change', () => {
			this._tabContainersCache = null;
			this._scopeGen++;
			// An explorer leaf that was just opened has rows with no ticks yet;
			// nothing to do unless a window wants them.
			this.orgTicksSchedule();
			// The masks come off in reading view, and that is a refresh rather
			// than a re-measure: letterboxActive() changes answer, so the body
			// classes and the Modes popup have to change with it.
			this.applyBodyClasses();
			// Switching between editing and reading is a layout change, and
			// nothing else re-measures the masks when it happens. Without
			// this the geometry stamped before the swap is what stays on
			// screen until an unrelated event happens to run the pass —
			// which is why issue #1 could be cleared by changing note or
			// toggling zen, and by nothing you would think to try.
			this.scheduleMaskPosition();
			if (this.zenActive() && this.settings.focusedFileMode) void this.updateFocusedFileMode();
			// The explorer/outline observers are scoped to their leaf
			// containers, which layout changes can recreate — re-bind them.
			// …AND THE FLAGS COUNT AS A REASON TO WATCH. This asked only
			// about the two COUNT switches, so a vault with flags on and
			// counts off attached no observer and scheduled no pass: the
			// tree drew nothing until something else in the plugin happened
			// to call the patch, which is why flags appeared only after a
			// click on the bar's own token. A feature that draws in the
			// explorer has to be in every condition that decides whether the
			// explorer is drawn.
			if (this.settings.pluginEnabled && this.explorerWanted()) {
				this.attachExplorerObserver();
				this.scheduleExplorerPatch();
			}
			// THE SORT IS ITS OWN QUESTION, and it is asked here rather than
			// inside `explorerWanted()`: that condition decides whether to
			// WATCH the explorer's DOM, which the order does not need — it
			// goes through the view's own comparator. What it does need is a
			// re-patch, because a layout change can build a new view object
			// and the old patch went with the old one.
			if (this.settings.pluginEnabled) this.patchExplorerSort();
		});
		// THE MODE-SWITCH FIX: 'css-change' is the only event that fires when
		// the writer flips light/dark, and nothing above listens to it — which
		// left a scheme's dark half painted onto a light workspace until some
		// unrelated refresh happened by. See barThemeOnCssChange for why the
		// cursor bridge is deliberately not resynced from here.
		// Every leaf change is a chance to note which markdown view is
		// current, so a panel click later can still answer for it.
		this.onAppEvent(this.app.workspace, 'active-leaf-change', () => {
			this.rememberActiveMarkdown();
			// The panel shows live state — word counts, the current mode —
			// so it redraws when the writer moves, like any other pane.
			this.refreshMenuPanels();
		});
		this.onAppEvent(this.app.workspace, 'file-open', () => {
			this.rememberActiveMarkdown();
		});
		this.onAppEvent(this.app.workspace, 'css-change', () => {
			this.barThemeOnCssChange();
			// A THEME SWITCH IS WHEN THE OTHER COLOUR BECOMES THE RIGHT ONE.
			// Without this, a writer moving from dark to light keeps flags
			// chosen for the dark one and wonders why they have gone faint.
			this.flagsApply();
		});

		// Mobile rebuilds the app container when Obsidian resumes, which
		// discards inline body styles. These are the events that follow a
		// rebuild; the guard is a no-op unless something actually went
		// missing, so listening broadly costs nothing.
		this.onAppEvent(this.app.workspace, 'resize', () => this.barThemeGuard());
		this.onAppEvent(this.app.workspace, 'active-leaf-change', () => this.barThemeGuard());
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (!document.hidden) this.barThemeGuard();
		});


		// DOM events
		this.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => {
			this.updateModifierState(evt);
			this.updateRetroStatusBar();
			this.typewriterScroll();
		});
		// Peeking at a hidden bar. Deliberately the whole handler: everything
		// it could need is precomputed by syncBarPeekState, so a pointer move
		// with peeking disarmed costs one property read.
		this.registerDomEvent(document, 'mousemove', (evt: MouseEvent) => {
			if (!this._peekArmed) return;
			this.onPointerForBarPeek(evt.clientY);
		});
		this.registerDomEvent(document, 'mouseup', () => {
			this.updateRetroStatusBar();
			this.typewriterScroll();
		});
		// Live selection word count. selectionchange fires only when the
		// selection actually changes (mouse drag, shift+arrows, double-click),
		// unlike the old document-wide mousemove listener that re-derived
		// word counts on every pointer frame even with no selection at all.
		this._selectionRaf = null;
		this.registerDomEvent(document, 'selectionchange', () => {
			if (this._selectionRaf) return;
			this._selectionRaf = window.requestAnimationFrame(() => {
				this._selectionRaf = null;
				this.updateRetroStatusBar();
			});
		});
		// Escape exits zen mode (from new zen plugin — respects vim mode and excalidraw)
		this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
			this.updateModifierState(evt);
			// zenActive(), not settings.zenMode: the two disagree whenever the
			// master is off, and `zenMode` alone stays true after a bar-badge
			// exit — so this fired on Escape in a note that was not in zen,
			// and toggleZen() would then have taken it as a request to ENTER.
			if (evt.key === 'Escape' && this.settings.zenEscExits !== false && this.zenActive()) {
				const target = evt.target as HTMLElement | null;
				if (target) {
					const cmEditor = target.closest('.cm-editor');
					if (cmEditor) {
						const vault = this.app.vault;
						if (vault.config && vault.config.vimMode === true) {
							// In vim, Escape belongs to vim: it is how you
							// leave insert, visual and replace, and taking it
							// meant zen simply could not be left from the
							// keyboard — the guard here used to return
							// unconditionally.
							//
							// So it is taken only in NORMAL mode, where vim
							// has nothing left to do with it. The first
							// Escape drops you to normal as always; a second
							// one leaves zen. Nothing is stolen, and the
							// habit still works.
							if (this.getVimModeKey() !== 'normal') return;
						}
					}
					if (target.instanceOf(HTMLTextAreaElement) && target.className && target.className.includes('excalidraw')) return;
				}
				const activeModal = document.querySelector('.modal');
				if (!activeModal) { void this.toggleZen(); evt.preventDefault(); }
			}
		});

		// Track whether the note editor itself has focus. Used to gate the
		// elevated z-index (above Cursor Smith's canvas) so masks/arrows/bar
		// only float above everything while actually writing — not above the
		// command palette, settings, context menus, or other modals, which
		// take focus away from .cm-editor.
		const updateEditorFocusClass = () => {
			const active = document.activeElement;
			// WORD-SMITH'S OWN PANEL COUNTS AS WRITING. Focus in the docked
			// menu is not focus taken away by a modal or a palette — it is
			// the writer reaching for this plugin's own controls, and
			// dropping the masks the moment they do meant the letterbox
			// only appeared once they clicked back into the note. The pane
			// is part of the same act.
			const inEditor = !!(active && active.closest && (
				active.closest('.cm-editor') || active.closest('.ws-menu-panel')));
			document.body.classList.toggle('ws-editor-focused', inEditor);
			// The drag handles (the titlebar strip and the top mask) are
			// gated the OTHER way round from the z-index band: not "focus
			// is in the editor" but "focus is not inside anything that must
			// own its clicks". Two field reports shaped this. Gated on
			// editor focus alone, zen had NO drag handle whenever focus sat
			// elsewhere — "I can't drag the window". Widened to focus-on-
			// <body>, it STILL failed, because Obsidian parks focus on a
			// workspace container after ordinary clicks, not on body — a
			// whitelist here is a guess about Obsidian's focus routing that
			// each release can invalidate. The blacklist is the actual
			// invariant: dragging is wrong exactly while a modal, prompt,
			// suggestion popover or menu has focus, and those are stable,
			// purpose-named containers. Menus that take no focus at all are
			// covered separately: they carry their own no-drag later in the
			// DOM than the masks, which by invariant 12 (last element wins
			// the overlap) subtracts their rectangles from any grant
			// beneath.
			const blocked = !!(active && active.closest
				&& active.closest('.modal-container, .prompt, .suggestion-container, .menu'));
			document.body.classList.toggle('ws-drag-ok', !blocked);
			// {vim} reads focus, so the bar has to repaint on it — otherwise
			// the label lags by up to a second behind the palette opening.
			this.updateRetroStatusBar();
		};
		// `.ws-overlay-open` — is a modal, prompt, suggestion popover or menu
		// ON SCREEN? A different question from the focus one above, which
		// asks whether one HAS FOCUS: a menu can exist unfocused, and the
		// drag grants need to stand down for it either way.
		//
		// This was a `:has()` in the stylesheet, which needed no JS and was
		// the wrong tool: `body:not(:has(...))` puts the SUBJECT on body, so
		// the engine may re-check it on any change beneath body — and
		// beneath body is an editor whose DOM changes on every keystroke.
		//
		// The observer watches document.body's DIRECT CHILDREN only. That is
		// not a shortcut; it is why this is cheap. Obsidian appends all four
		// of these to body itself, so nothing here ever looks inside the
		// editor, and a keystroke produces no work at all.
		const OVERLAYS = '.modal-container, .prompt, .suggestion-container, .menu';
		const syncOverlayClass = () => {
			let open = false;
			try {
				for (const el of Array.from(document.body.children)) {
					if (el.matches && el.matches(OVERLAYS)) { open = true; break; }
				}
			} catch (_) { wsCatch('onload / syncOverlayClass: for (const el of Array.from(document.body.children))', _); }
			document.body.classList.toggle('ws-overlay-open', open);
		};
		syncOverlayClass();
		const overlayObserver = new MutationObserver(syncOverlayClass);
		overlayObserver.observe(document.body, { childList: true });
		this.register(() => {
			overlayObserver.disconnect();
			document.body.classList.remove('ws-overlay-open');
		});

		this.registerDomEvent(document, 'focusin', updateEditorFocusClass);
		this.registerDomEvent(document, 'focusout', () => window.requestAnimationFrame(updateEditorFocusClass));
		// Since 1.13 settings open in a separate window, which deactivates
		// this one WITHOUT firing focusin/focusout — activeElement keeps
		// reporting .cm-editor while the user is over in settings, so the
		// class stayed set and the masks/strip kept claiming
		// -webkit-app-region: drag, which is what made the settings window
		// un-draggable. Window blur is the event that does fire for it.
		//
		// hasFocus() is consulted here and ONLY here, and only to CLEAR.
		// Folding it into updateEditorFocusClass as a requirement for
		// setting the class turned out to break the letterbox outright:
		// hasFocus() reads false with DevTools focused (and misreports in
		// other Electron corner cases), and with it gating focusin the
		// class could stay off during ordinary typing — the masks then
		// never rose above full-viewport overlays (Cursor-Smith's canvas
		// at z 10000), which reads as "the letterbox doesn't display".
		// Clear-only means the worst a misreport can do is nothing.
		this.registerDomEvent(window, 'blur', () => window.requestAnimationFrame(() => {
			if (!document.hasFocus()) {
				document.body.classList.remove('ws-editor-focused');
				// And the drag class: this window's regions must not stay
				// claimed while another window (1.13 settings, a pop-out)
				// is the one being used — the original un-draggable
				// settings bug, on a second path.
				document.body.classList.remove('ws-drag-ok');
				this.updateRetroStatusBar();
			}
		}));
		this.registerDomEvent(window, 'focus', () => window.requestAnimationFrame(updateEditorFocusClass));
		updateEditorFocusClass();

		// Vault events
		this.onAppEvent(this.app.vault, 'modify', (file: TAbstractFile) => {
			if (this.wordCountCache) this.wordCountCache.delete(file.path);
			this.scheduleExplorerPatch();
			// Same event, one more reader. The history is debounced and gated
			// on its own opt-in inside historyNoteChange, so this line costs a
			// function call in a vault that has never turned it on.
			this.historyNoteChange(file);
			// EVERY TREE SHOWING A FIGURE ABOUT THIS NOTE. The Manuscript
			// window caches a word count per path and never asked again, so a
			// window left open beside the editor showed the count the note had
			// when the window opened — for the rest of the session. Reported as
			// "the word counts don't update automatically", and that is exactly
			// what it was: nothing wrong with the counting, and nothing asking
			// for it a second time.
			this.treeCountsChanged(file && file.path);
			// The store changing under us — synced from another device, or
			// edited by hand — is read back rather than ignored. This is what
			// replaces the "find it again" button: there is nothing to press,
			// because the plugin notices.
			void this.historyAdopt(file);
			// THE ORDER FILE, TOO. `ws-export.md` is a note in the vault: it
			// syncs from another device and a writer can reorder its lines by
			// hand, which its own header invites them to do. The parsed store
			// is cached for the life of the session, so without this the tree
			// would go on drawing an order that is no longer in the file.
			this.treeOrderAdopt(file);
		});
		this.onAppEvent(this.app.metadataCache, 'changed', (file: TAbstractFile) => {
			if (this._fmCache && file && file.path) delete this._fmCache[file.path];
			this._scopeGen++;
			// {backlinks} caches a walk of the whole vault against this.
			this._linkGen = (this._linkGen || 0) + 1;
			// The heading tokens read this cache, and it is the only thing on
			// the bar that does. A repaint that happened before the cache
			// answered has no headings to show and nothing that would make it
			// try again — see the 'resolved' handler below.
			const active = this.app.workspace.getActiveFile();
			if (file && active && file.path === active.path) {
				this.requestBarRebuild();
			}
		});
		// Fired once when the vault's links have all been resolved at startup,
		// and again after a batch of changes settles. Without it the first
		// backlink count of a session is whatever was resolvable at load.
		this.onAppEvent(this.app.metadataCache, 'resolved', () => {
			this._linkGen = (this._linkGen || 0) + 1;
			// AND repaint the bar.
			//
			// The heading tokens ({#} and the rest, {#>}) resolve through
			// metadataCache, which fills asynchronously. On a slower machine
			// the first paint of a session lands before it has answered, so
			// those tokens resolve to nothing — and a segment whose tokens
			// all resolve to nothing is dropped, by design. The row comes up
			// empty and stays empty, because nothing rebuilds it.
			//
			// Reported from ChromeOS, where a heading-only bar showed no left
			// or centre section at all; Windows and Android won the race and
			// never showed it. Forcing a repaint in the console fixed it and
			// it then held, which is what named this as a startup race rather
			// than a rendering fault.
			this.requestBarRebuild();
		});
		// A store that appears in the vault — first sync of a new install, or a
		// file the user pasted in — is picked up without being asked for.
		this.onAppEvent(this.app.vault, 'create', (file: TAbstractFile) => {
			// Every tree drawing this vault, once the vault knows about it.
			this.treeShapeChanged();
			// A new row in Obsidian's tree gets its export tick.
			this.orgTicksSchedule();
			if (this._historyPath || !this.settings.historyTracking) return;
			void this.historyAdopt(file);
		});
		this.onAppEvent(this.app.vault, 'rename', (file: TAbstractFile, oldPath: string) => {
			if (this.wordCountCache) this.wordCountCache.delete(oldPath);
			void this.renameScopePath(oldPath, file.path);
			this.historyRenamePath(oldPath, file.path);
			// FIRST, before anything writes: if the thing that moved was one
			// of this plugin's own files — or a folder holding one — the
			// path in settings has to follow it, or the next write makes a
			// fresh empty file at the address the writer just vacated.
			const followed = this.storeRenameFollow(oldPath, file.path);
			// Folders fire this too, so a folder rename carries the goals of
			// everything inside it.
			if (this.renameGoalPaths(oldPath, file.path) || followed) void this.saveSettings(true);
			// …and the export list, which is keyed by path twice over: the
			// rows inside a section, and the section's own scope.
			void this.structureRenameStore(oldPath, file.path);
			// The renamed row's export tick is read against its new path.
			this.orgTicksSchedule();
			// LAST, after the stores have followed the file. The trees redraw
			// from those stores, and redrawing before they were rewritten
			// would paint the order the vault had a moment ago.
			this.treeShapeChanged();
		});
		this.onAppEvent(this.app.vault, 'delete', (file: TAbstractFile) => {
			if (this.wordCountCache) this.wordCountCache.delete(file.path);
			void this.removeScopePath(file.path);
			this.historyForgetPath(file.path);
			// AND THE MIRROR: a deleted ws-settings.md returns with the next save
			// instead of waiting for a setting to move.
			this.settingsMirrorForget(file.path);
			// …AND THE ORDER STORE, which had no delete arm at all. See
			// `structureForgetPath`: the rename half has been here since
			// 1.41 and this half never was, so a deleted note left its row
			// and a deleted folder left its whole section. Folders fire this
			// event too, which is what makes one call enough.
			void this.structureForgetStore(file.path);
			// …AND THE GOALS, THE FLAGS AND THE COLOURS, which had no delete
			// arm either. The rename half two handlers up has carried them
			// since 1.41; this half never has, so a deleted note kept its
			// target at an address nothing could reach — and `renameGoalPaths`
			// lets an existing key WIN, so re-using that path later gave the
			// new note the dead one's goal.
			if (this.forgetGoalPaths(file.path)) void this.saveSettings(true);
			this.treeShapeChanged();
		});

		// Theme observer. Guarded on pluginEnabled: disablePlugin() removes
		// body classes, which fires this very observer — without the guard
		// it would recreate the injected styles and re-stamp CSS variables
		// immediately after they were removed.
		//
		// ── AND IT MUST NOT ANSWER ITSELF (GitHub #14) ──────────────────────
		//
		// This observer watches body's `class` and `style`; everything it
		// calls WRITES body's class and style. A callback that re-triggers
		// itself never lets the microtask queue drain, and Obsidian hangs with
		// no error and no crash — on a fresh install, the moment the plugin is
		// enabled. TWO HALVES, both in: the writers do not write when nothing
		// has changed (see `applyThemeClass`), and this flag stops the callback
		// re-entering while its own writes land. The `_themeGuarding` flag
		// inside `barThemeGuard` only protects that one function from calling
		// itself; it never covered this callback reaching `applyCssVariables`
		// directly.
		this._themeObsBusy = false;
		this._themeObserver = new MutationObserver(() => {
			if (!this.settings.pluginEnabled) return;
			if (this._themeObsBusy) return;
			this._themeObsBusy = true;
			try {
				this.applyCssVariables();
				this.applyStyleProps();
				// Cursor-Smith's torch flips a body class of its own
				this.applyTorchVars();
				// A worn scheme has to survive whoever else writes to body.
				this.barThemeGuard();
			} finally {
				// CLEARED ON A TASK, not in the finally alone: the records
				// this callback's own writes queued are delivered at the next
				// microtask checkpoint, which is still inside this turn. A
				// flag cleared synchronously would be false again by then and
				// the loop would resume.
				window.setTimeout(() => { this._themeObsBusy = false; }, 0);
			}
		});
		this._themeObserver.observe(document.body,
			{ attributes: true, attributeFilter: ['class', 'style'] });

		this.loadMark('events + chrome');
		// CM6 decoration extensions (focus dimming + hidden markers)
		this.setupEditorExtensions();
		this.scheduleVimMotionMaps();
		this.loadMark('editor extensions');

		this.refresh();
		// THE FIRST PAINT, and the one that stands the whole plugin down
		// during `onload` because there is no leaf yet — see the note below.
		this.loadMark('first refresh');

		// The surface gate reads the most recent leaf in the MAIN area, and
		// during onload there is not one: every pane the workspace is about
		// to restore is still to come, so the refresh above necessarily
		// answers "not a note" and stands the whole plugin down. Ask again
		// once there is something to ask about.
		//
		// Registered here, at the end of onload, and not beside the zen
		// sidebar collapse near the top: onLayoutReady fires SYNCHRONOUSLY
		// when the layout is already ready, which is exactly what happens
		// when the plugin is switched on from the settings page — a refresh
		// registered up there would run against a half-built plugin.
		// EVERYTHING SYNCHRONOUS IS DONE. What follows is a callback, and on a
		// cold start it runs after Obsidian has built the workspace — so it is
		// timed separately rather than folded into the load.
		this.loadMark('onload done');
		this.app.workspace.onLayoutReady(() => {
			// THE GUARD'S MARK COMES OFF two seconds after this callback, and
			// before the enabled check: a vault with the plugin OFF finishes
			// its start too. A synchronous freeze inside the refresh below
			// never reaches the timer, which is the whole point.
			window.setTimeout(() => this.startGuardEnd(), 2000);
			if (!this.settings.pluginEnabled) return;
			const t0 = performance.now();
			this.refresh();
			this.checkStylesheetVersion();
			this.checkManifestVersion();
			// A SECOND PASS ONCE THE STYLESHEET IS CERTAINLY UP. Everything
			// this plugin MEASURES is measured against rules that
			// styles.css supplies, and when the plugin is switched on from
			// the settings page this callback runs synchronously — before
			// Obsidian has necessarily applied them. The bar is the case a
			// writer sees: it is laid out by CSS, it was measured while
			// there was none, and it came up the wrong width until the
			// next note switch happened to rebuild it. Cheap, once, and it
			// costs nothing when the stylesheet was already there — the
			// refresh is idempotent.
			window.setTimeout(() => {
				if (this.settings && this.settings.pluginEnabled) this.refresh();
			}, 0);
			try {
				if (!this._loadMarks) this._loadMarks = [];
				this._loadMarks.push(['layout ready',
					this._loadMarks[this._loadMarks.length - 1][1]
						+ (performance.now() - t0)]);
			} catch (_) { wsCatch('onload: if (!this._loadMarks) this._loadMarks = [];', _); }
			// AND THE PANEL DOCKS ITSELF. Registering the view type is what lets
			// Obsidian RESTORE a pane it already has in the workspace — it does
			// not create one; on a fresh install, or after any start where the
			// workspace had no leaf of ours, the writer would have to dock it by
			// hand. `menuDock` is the writer's statement that they want the panel;
			// turning it off is how they say otherwise, and that path already
			// detaches the pane. Opened with `active: false` and no reveal, so a
			// docked pane appears where it belongs without stealing focus from
			// the note or, on a phone, throwing the sidebar open over what they
			// were reading. A pane Obsidian kept as a placeholder counts as one
			// that exists — reviveMenuPanel wakes it. A placeholder left by an
			// unload of a LIVE pane is not yet a leaf of our type while onload
			// runs — Obsidian makes it one, deferred, a moment later — so the
			// wake runs again on every layout change; it costs a look at a few
			// leaves and settles the moment nothing is a ghost.
			if (this.settings.menuDock) {
				void this.reviveMenuPanel().then(() => { if (!this.menuPanelLeaves().length) return this.openMenuPanel(false); return null; });
				this.onAppEvent(this.app.workspace, 'layout-change', () => { if (this.settings.menuDock) void this.reviveMenuPanel(); });
			}
			// MARKERS MOVED OUT OF TEXT OPTIONS, so a vault that had them on
			// under the old arrangement keeps them on under the new one.
			// Without this the fix would read to an existing writer as "the
			// update turned my markers off" — a worse bug than the one it
			// fixes.
			if (this.settings.markersEnabled !== true
				&& this.settings.showHiddenMarkers && this.settings.miscEnabled) {
				this.settings.markersEnabled = true;
				void this.saveSettings();
			}
			// The goals file, read after the vault is up — it cannot be
			// read in onload, where getAbstractFileByPath answers for a
			// vault Obsidian has not finished indexing.
			//
			// THE MIRROR GOES FIRST, and for the same reason it is here at all
			// rather than in loadSettings: finding it means reading files. It
			// restores only when data.json had nothing in it, so on every
			// ordinary start this is one `getAbstractFileByPath` and a return.
			this.settingsMirrorRestore(this._rawData)
				.catch(() => false)
				.then(() => this.goalsFileLoad())
				.then(() => this.refresh())
				.catch(() => {});
			// Only worth asking when the panel is on: a writer who never
			// docks it has no stake in whether the tree's classes moved,
			// and a notice they cannot act on is noise.
			if (this.settings.menuDock) this.checkAppClasses();
			// Read the store once the vault's file list exists — finding the
			// file means looking through it. Nothing is recorded until this
			// resolves; historyCapture waits on the same promise, so an edit
			// made during startup is counted rather than dropped.
			if (this.settings.historyTracking) void this.historyLoad();
		});
	}

	// ── ONE WAY TO MAKE A WINDOW, AND IT IS ON THE REGISTER ────────
	//
	// A window must not outlive the plugin that drew it: after a reload,
	// a disable or an update, a window still on screen belongs to a
	// destroyed object — every listener in it is dead, so it eats
	// keystrokes and clicks and looks perfectly alive doing it. `onunload`
	// closes everything on the register.
	//
	// THE REGISTER IS KEPT AT THE CONSTRUCTOR, not asked of the callers:
	// "remember to register your modal" is a rule the sixth creation site
	// forgets. There is one way to make one, and a test counts the
	// constructor calls to keep it that way.
	wsModal() {
		if (!Modal) return null;
		const m = new Modal(this.app);
		if (!this._openModals) this._openModals = new Set();
		this._openModals.add(m);
		// AND OFF AGAIN WHEN IT SHUTS, or the set grows for the life of
		// the session and holds a dead modal per open.
		//
		// WRAPPED, NOT ASSIGNED. `modalHost` wraps `onClose` too, and so
		// does anything else that wants to know; each wrapper keeps the
		// one it found. This is the innermost and so runs last.
		const was = m.onClose ? m.onClose.bind(m) : null;
		m.onClose = () => {
			try { this._openModals.delete(m); } catch (_) { wsCatch('wsModal: this._openModals.delete(m);', _); }
			if (was) was();
		};
		return m;
	}
	onunload() {
		// THE SETTINGS TAB'S OBSERVER: it lives for the tab's life — not
		// disconnected on hide(), since Obsidian 1.13 re-renders the last
		// definitions on reopen without asking for them again — so this is the
		// one place it is cut; a watch on the settings window's body with no
		// plugin behind it is a leak.
		try { if (this._settingsTab) this._settingsTab.teardown(); } catch (_) { wsCatch('onunload: this._settingsTab.teardown();', _); }
		this._settingsTab = null;
		// THE WINDOWS GO FIRST, before anything they might read is torn
		// down. `close()` and not a DOM removal: the modal is Obsidian's,
		// and it has a focus trap, a scroll lock and a scope to give back.
		// OVER A COPY, because closing removes from the set being walked.
		//
		// AND ONLY WHAT IS ACTUALLY ON SCREEN. `wsModal` registers at
		// CONSTRUCTION, which is the only place a rule can be enforced — but
		// a modal built at the top of a method can still return without ever
		// calling `open()`, and closing one of those takes Obsidian into its
		// own stack for a window that was never on it ("e.isShown is not a
		// function"). `containerEl.isConnected` is the honest test of "is this
		// window on screen" — it is what `close()` is for and nothing else
		// needs closing.
		try {
			if (this._openModals) {
				for (const m of Array.from(this._openModals)) {
					try {
						if (m && m.containerEl && m.containerEl.isConnected) m.close();
					} catch (_) { wsCatch('onunload: if (m && m.containerEl && m.containerEl.isConnected) m.close();', _); }
				}
				this._openModals.clear();
			}
		} catch (_) { wsCatch('onunload: if (this._openModals)', _); }
		// THE WINDOW CONTROLS GO BACK. They are Electron's, not ours, and
		// they outlive the plugin: a writer who disables Word-Smith and
		// keeps a recoloured strip in the corner of their window has been
		// left a mess with no way to trace it.
		try { this.setWindowControlColours(false); } catch (_) { wsCatch('onunload: this.setWindowControlColours(false);', _); }
		// …AND SO DOES THE TREE'S ORDER, for the same reason and a sharper
		// one: this is a patched method on an object Obsidian owns and goes
		// on using. Leaving it in place after unload means a disabled plugin
		// still deciding what order a vault is in, with nothing on screen to
		// say why.
		try { this.unpatchExplorerSort(); } catch (_) { wsCatch('onunload: this.unpatchExplorerSort();', _); }
		// (The eye button was removed at 352; there is no longer a control of
		// ours in their header to take down.)
		// …and the sort MENU, which is a second patched method on the same
		// object Obsidian goes on using. A disabled plugin must not be
		// putting rows in somebody's menus.
		try { for (const v of this.explorerViews()) this.unpatchExplorerSortMenu(v); } catch (_) { wsCatch('onunload: for (const v of this.explorerViews()) this.unpatchExplorerSortMenu(v);', _); }
		// …and the sort button gets its own icon back.
		try {
			if (this.settings) this.settings.treeOrder = false;
			this.paintExplorerSortIcon();
		} catch (_) { wsCatch('onunload: if (this.settings) this.settings.treeOrder = false;', _); }
		// Anything counted since the last lazy save, before the timers that
		// would have written it are torn down. Synchronous-looking on purpose:
		// the promise is not awaited because onunload cannot await, but the
		// saveData call is issued before anything else is dismantled.
		if (this._historyTimers) {
			for (const t of this._historyTimers.values()) window.clearTimeout(t);
			this._historyTimers.clear();
		}
		if (this.settings && this.settings.historyTracking) {
			try { void this.historyFlush(true); } catch (_) { wsCatch('onunload: this.historyFlush(true);', _); }
		}
		// The linger timer holds a reference to this plugin instance and
		// would keep it alive past unload.
		this.endBarPeek(true);
		// The theme, by name. Uninstalling or updating the plugin unloads
		// it without ever calling disablePlugin(), and inline properties on
		// body outlive the stylesheet — so without this a removed plugin
		// leaves the workspace wearing a scheme it can no longer take off.
		this.barThemeUndress();
		// A CLEAN UNLOAD IS A START THAT FINISHED: a freeze never gets here, a
		// reload always does, so two reloads inside two seconds do not trip the
		// guard.
		try { this.startGuardEnd(); } catch (_) { wsCatch('onunload: this.startGuardEnd();', _); }
		// Clean up retro bar
		this.removeCustomElements();
		this.stopClockTick();
		// Clean up style injection
		this.clearStyleProps();
		// Clean up para tagger
		// Clean up word count observer
		this.detachExplorerObserver();
		this.removeWordCounts();
		// The tree's remote: the folder click listener. The windows have closed
		// by now and dropped their doors, but a start that never finished may
		// not have.
		this.orgTreeHookDetach();
		// …and the export ticks it painted into Obsidian's tree.
		this.orgTicksClear();
		// Clean up scroll/resize handlers
		this.detachScrollHandler();
		this.detachResizeHandler();
		// Clean up theme observer
		if (this._themeObserver) { this._themeObserver.disconnect(); this._themeObserver = null; }
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }
		// Abort an in-flight mask drag (its move/up listeners would otherwise
		// outlive the plugin)
		if (this._activeDragCleanup) this._activeDragCleanup();
		// Detach battery listeners — they hold a reference to this plugin
		// instance and would keep it alive after unload
		if (this._batteryManager && this._batteryHandler) {
			this._batteryManager.removeEventListener('levelchange',    this._batteryHandler);
			this._batteryManager.removeEventListener('chargingchange', this._batteryHandler);
			this._batteryManager = this._batteryHandler = null;
		}
		// Cancel a pending debounced refresh
		if (this._refreshTimer) { window.clearTimeout(this._refreshTimer); this._refreshTimer = null; }
		if (this._hemFlashTimer) { window.clearTimeout(this._hemFlashTimer); this._hemFlashTimer = null; }
		if (this._hemScreenTimer) { window.clearTimeout(this._hemScreenTimer); this._hemScreenTimer = null; }
		if (this._hemIconTimer) { window.clearTimeout(this._hemIconTimer); this._hemIconTimer = null; }
		if (this._hemScreenEl) { this._hemScreenEl.remove(); this._hemScreenEl = null; }
		this.closeBarPicker();
		document.querySelectorAll('.cm-editor.ws-hem-blocked')
			.forEach(el => el.classList.remove('ws-hem-blocked'));
		// Leave zen cleanly. The MASTER goes down, matching how toggleZen()
		// leaves — and nothing is saved here, so data.json keeps both flags
		// and zen resumes when the plugin is loaded again.
		if (this.zenOn()) {
			this.settings.zenEnabled = false;
			this.applyBodyClasses();
			this.setSidebarVisibility();
		}
		this.settings.vimSoftWrapMotion = false;
		this.applyVimMotionMaps();
		this.clearAllBodyState();
		// Only the containers focused-file mode actually wrote to, and back to
		// what they held before. See _focusTabRestore.
		this._focusTabRestore();
		// THE NATIVE STATUS BAR: hidden by `body.zenmode-hide-status-bar` alone,
		// which clearAllBodyState above has just taken off; there is no inline
		// write to leave.
	}

	// ════════════════════════════════════════════════════════════════════════
	// SETTINGS: load, save, migrate
	// ════════════════════════════════════════════════════════════════════════

	// SETTINGS AS TEXT. The copy is exactly what data.json holds: wsForDisk
	// strips the session keys, as the save does. A paste goes through the
	// same door a load does — the defaults underneath, the repair pass over
	// the shape — so a hand-edited or foreign JSON cannot crash the plugin.
	// The previous settings are kept for one Undo.
	settingsCopyText() {
		return JSON.stringify(wsForDisk(this.settings), null, 2);
	}

	async settingsApplyRaw(raw: Record<string,unknown>) {
		const merged = Object.assign({}, DEFAULT_SETTINGS, raw);
		const repaired = wsRepairSettings(merged, DEFAULT_SETTINGS);
		for (const k of WS_SESSION_KEYS) delete merged[k];
		this.settings = merged;
		await this.saveSettings(true);
		return repaired;
	}

	async settingsPasteText(text: string): Promise<WsSettingsPasted> {
		let raw: unknown = null;
		try { raw = JSON.parse(String(text || '')); } catch { raw = null; }
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			return { error: 'the clipboard does not hold a settings object \u2014 copy one from this tab first.' };
		}
		this._settingsUndo = wsForDisk(this.settings);
		const bag = raw as Record<string, unknown>;
		const repaired = await this.settingsApplyRaw(bag);
		return { applied: Object.keys(bag).length, repaired };
	}

	async settingsUndoPaste(): Promise<WsSettingsPasted> {
		const prev = this._settingsUndo;
		if (!prev) return { error: 'there is nothing to undo.' };
		this._settingsUndo = null;
		const repaired = await this.settingsApplyRaw(prev);
		return { applied: Object.keys(prev).length, repaired };
	}

	// RESET A GROUP, by key. The settings tab hands over the keys a group's
	// rows write — read off its definitions, so there is no second table to
	// hold to the render. A reset drops those keys from the disk shape and
	// goes through the same door a load and a paste do, so the defaults come
	// back underneath and the repair pass runs; the previous settings are
	// kept for the one Undo the paste has. A key on no row — the window's, a
	// picker's — is never in a list, so never touched.
	async settingsResetKeys(keys: string[]) {
		if (!Array.isArray(keys) || !keys.length) return { error: 'nothing to reset.' };
		this._settingsUndo = wsForDisk(this.settings);
		const raw = wsForDisk(this.settings);
		let changed = 0;
		const base = wsBag(DEFAULT_SETTINGS);
		for (const k of keys) {
			if (JSON.stringify(raw[k]) !== JSON.stringify(base[k])) changed++;
			delete raw[k];
		}
		await this.settingsApplyRaw(raw);
		// A RESET OF THE HISTORY GROUP STARTS THE RECORD OVER: with no store
		// file anywhere in the vault, the memory of one goes too, so the next
		// write — the toggle, or Delete all history — makes a first rather than
		// a notice that none was made. A file that is there is left alone: the
		// reset is about the switches, not the record. The group is known by
		// its switch.
		if (keys.includes('historyTracking')) {
			try {
				if (this.settings.historySeen && !(await this.historyFindFile())) {
					this.settings.historySeen = false;
					await this.saveSettings();
				}
			} catch (_) { wsCatch('settingsResetKeys: if (this.settings.historySeen && !(await this.historyFindFile()))', _); }
		}
		return { changed, keys: keys.length };
	}

	async loadSettings() {
		// The RAW file is kept alongside the merged copy: a migration that
		// asks "did this vault ever have an opinion about X" cannot ask the
		// merged object, where every key is present because the defaults put
		// it there.
		const raw: WsRawSettings = ((await this.loadData()) as WsRawSettings | null) || {};
		// KEPT, and kept as it came. The settings mirror restores only when
		// data.json had nothing to say, and "nothing" cannot be asked of the
		// merged object — every key is present there because the defaults put
		// it there. `loadData` answers null for a file that is not there and
		// `{}` for one that is empty; both are the restore case, and the
		// difference is worth nothing to us, so the coalesce above is safe.
		this._rawData = raw;
		// THE FILE MEETS THE SCHEMA: the defaults with the file's values over them,
		// said to be the schema's shape here and MADE so by `wsRepairSettings`
		// below, which holds every key to its kind.
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw as Partial<WordSmithSettings>);
		// ── AND THE SESSION KEYS START FRESH ─────────────────────────────
		//
		// A `data.json` written by an older build still carries them, and
		// honouring them would be the old behaviour outliving the change that
		// removed it. Deleted rather than overwritten, so every reader falls
		// through to its own default. REPAIR ON READ comes first: before the
		// session keys are dropped (a dropped key is undefined — an absent
		// shape, not a wrong one), before any migration reads a value, and
		// before any reader trusts a shape. The migrations below read from
		// `raw`, which is untouched — a repaired key is a key the file held in
		// a shape no migration was written for. Told once, in the console, by
		// name; and kept on the instance for the diagnostics dump.
		this._repairedKeys = wsRepairSettings(this.settings, DEFAULT_SETTINGS);
		if (this._repairedKeys.length) {
			try {
				console.warn('Word-Smith: ' + this._repairedKeys.length
					+ ' setting(s) in data.json had the wrong shape and were reset to their defaults: '
					+ this._repairedKeys.join(', '));
			} catch (_) { wsCatch('loadSettings: console.warn(\'Word-Smith: \' + this._repairedKeys.length', _); }
		}
		for (const k of WS_SESSION_KEYS) delete wsBag(this.settings)[k];

		// Immediately, not lazily. That merge is SHALLOW, so every nested
		// default is shared by reference with DEFAULT_SETTINGS until something
		// replaces it — and the baseline cache is written on a hot path.
		// Building the real object here means no later code path can be the
		// first to touch it and mutate the table.
		this.historyBaselines();

		// letterboxCustomColors arrived in 1.11, and the four arrow/line
		// pickers it now gates were unconditional before it. A vault that had
		// picked its own colours WAS using them, so the toggle comes up on
		// for that vault and its letterbox looks the same after the upgrade
		// as before. One still on the shipped four gets the new default,
		// which is to follow the theme's text colour.
		//
		// Guarded on the key being absent from the raw file, so this decides
		// exactly once and can never overrule a choice made later.
		if (raw.letterboxCustomColors === undefined) {
			this.settings.letterboxCustomColors = ['arrowDarkColor', 'arrowLightColor',
				'lineDarkColor', 'lineLightColor']
				.some(k => raw[k] !== undefined && raw[k] !== wsBag(DEFAULT_SETTINGS)[k]);
		}
		// `barThemeLight` lived one unreleased day; a vault that ran that build
		// carries it.
		delete this.settings.barThemeLight;
		// editorFont once shipped with a real font name as its default, so every
		// vault that saved has that name in data.json whether or not anyone chose
		// it. Cleared exactly once, and only when the value is still character-
		// for-character the old default: a writer who picked another face has a
		// different string and is not touched.
		// THE TREE'S ORDER COMES ON ONCE, FOR EVERYONE. The default alone could
		// not do it: `saveSettings` persists the MERGED object, so every vault
		// that has saved settings even once already carries `treeOrder` and the
		// raw value wins the merge above. SO IT IS FORCED, EXACTLY ONCE, and the
		// flag is what keeps the switch a switch: without it every reload would
		// re-assert the order, and the toggle in Settings → File tree — and
		// "Custom sort" in the explorer's own menu, which writes the same key —
		// would both appear to do nothing the next time the plugin loaded.
		if (!this.settings.treeOrderForcedOn) {
			this.settings.treeOrder = true;
			this.settings.treeOrderForcedOn = true;
		}
		// ── THE FILE ICONS GO, ONCE ──────────────────────────────────────
		//
		// Both keys already exist in older vaults, so a default cannot reach
		// them; this is the `treeOrderForcedOn` idiom instead — forced exactly
		// once, with a marker that keeps the switch a switch. The switches are
		// not deleted: off is one click from on.
		if (!this.settings.fileIconsOffOnce) {
			this.settings.orgFileIcons = false;
			this.settings.fileTreeKindIcons = false;
			this.settings.fileIconsOffOnce = true;
		}
		if (!this.settings.editorFontDefaultCleared) {
			if (this.settings.editorFont === 'JetBrainsMono Nerd Font') {
				this.settings.editorFont = '';
			}
			this.settings.editorFontDefaultCleared = true;
		}
		// THE SAME TRAP, AND THE SAME CURE: the Outline flag becomes Sketch.
		//
		// Changing a default is not enough. `flags` is in DEFAULT_SETTINGS, so
		// every vault that has ever saved its settings has the old labels
		// written into data.json — exactly the reason the editorFont fix above
		// exists, and it was learned the hard way there.
		//
		// The label moved because the tab beside it is called Outliner now, and
		// a window with an Outliner tab whose rows can be flagged "Outline" is
		// one word meaning two things eight inches apart.
		//
		// ONLY WHEN IT IS STILL CHARACTER-FOR-CHARACTER THE OLD DEFAULT, and
		// only once. A writer who renamed that flag to something of their own
		// is not touched; one who had deliberately chosen the identical word
		// loses it once and types it back. THE ID IS NOT TOUCHED AT ALL — it is
		// what is written against a path in the vault, and rewriting it would
		// drop the flag off every note carrying one.
		if (!this.settings.outlineFlagRenamed) {
			try {
				for (const f of (this.settings.flags || [])) {
					if (f && f.id === 'outline' && f.label === 'Outline') f.label = 'Sketch';
				}
			} catch (_) { wsCatch('loadSettings: for (const f of (this.settings.flags || []))', _); }
			this.settings.outlineFlagRenamed = true;
		}
		// TYPEWRITER: the two "lines" settings become one anchor percentage.
		// LOSSLESS, because the old pair was never a pair of line counts —
		// the scroll code reduced it to `above / (above + below)` and used
		// that as a fraction of the viewport height. So the ratio IS the new
		// number, and every existing vault keeps the caret exactly where it
		// had it. Read from `raw` rather than from the merged settings so a
		// vault that never touched them is not migrated onto a default.
		if (raw.typewriterAnchor === undefined
			&& (raw.typewriterLinesAbove !== undefined || raw.typewriterLinesBelow !== undefined)) {
			const a = Math.max(0, Number(raw.typewriterLinesAbove) || 0);
			const b = Math.max(0, Number(raw.typewriterLinesBelow) || 0);
			const t = a + b;
			this.settings.typewriterAnchor = t > 0 ? Math.round((a / t) * 100) : 50;
		}
		delete this.settings.barThemeMarginalia;
		delete this.settings.marginaliaGutter;
		delete this.settings.typewriterLinesAbove;
		delete this.settings.typewriterLinesBelow;
		// Migrate old letterboxRatio
		if (this.settings.letterboxRatio != null) {
			if (this.settings.letterboxPx == null)
				this.settings.letterboxPx = this.settings.letterboxRatio * 200;
			delete this.settings.letterboxRatio;
		}
		// Migrate the old single-field retro bar format into the center slot
		// of the new left/center/right layout.
		if (this.settings.statusFormatText != null) {
			this.settings.statusFormatCenter = this.settings.statusFormatText;
			delete this.settings.statusFormatText;
		}
		// Fold the flat left/center/right keys into row 0 of the multi-row
		// model, then drop them. Done before the normalisation below so a
		// vault upgrading from either older shape lands in the same place.
		if (this.settings.statusFormatLeft   != null ||
			this.settings.statusFormatCenter != null ||
			this.settings.statusFormatRight  != null) {
			const rows = Array.isArray(this.settings.statusRows)
				? this.settings.statusRows.slice()
				: DEFAULT_SETTINGS.statusRows.map(r => Object.assign({}, r));
			const row0 = Object.assign({ left: '', center: '', right: '' }, rows[0] || {});
			if (this.settings.statusFormatLeft   != null) row0.left   = this.settings.statusFormatLeft;
			if (this.settings.statusFormatCenter != null) row0.center = this.settings.statusFormatCenter;
			if (this.settings.statusFormatRight  != null) row0.right  = this.settings.statusFormatRight;
			rows[0] = row0;
			this.settings.statusRows = rows;
			delete this.settings.statusFormatLeft;
			delete this.settings.statusFormatCenter;
			delete this.settings.statusFormatRight;
		}
		// {wpm} was removed. Scrub it from saved rows, or anyone who used it
		// is left staring at the literal text "{wpm}" in their bar forever.
		if (Array.isArray(this.settings.statusRows)) {
			for (const row of this.settings.statusRows) {
				if (!row) continue;
				for (const slot of ['left', 'center', 'right'] as const) {
					if (typeof row[slot] === 'string' && row[slot].includes('{wpm}')) {
						row[slot] = row[slot].replace(/\s*\{wpm\}\s*(wpm)?/g, '').trim();
					}
				}
			}
		}
		delete this.settings.wpmWindowSec;
		// Positioning the gutter against the text column was more trouble
		// than the distance it saved; the numbers sit where CodeMirror puts
		// them again.
		for (const dead of ['lineNumberGap', 'lineNumberWidth', 'showLineNumbers',
			'lineNumberMode', 'lineNumberVisual', 'lineNumberSize']) {
			delete wsBag(this.settings)[dead];
		}
		// One symmetric padding became two, so the split starts from whatever
		// the single value was rather than snapping back to the default.
		// Settings arrive merged over DEFAULT_SETTINGS, so the two new keys are
		// never null by the time this runs — guarding on them would make the
		// whole migration a no-op. The presence of the retired key is the
		// signal, and it is enough on its own.
		if (this.settings.statusBarPadding != null) {
			const pad = this.settings.statusBarPadding;
			this.settings.statusBarPadTop    = pad;
			this.settings.statusBarPadBottom = pad;
			delete this.settings.statusBarPadding;
		}
		// The auto-hiding bar was replaced by a command.
		for (const dead of ['zenAutoHideBar', 'zenAutoHideDelay', 'zenAutoHideZone']) {
			delete wsBag(this.settings)[dead];
		}
		// {nump} became {num}; {toc}, {textview} and {lock} were removed — the
		// last of those because the H badge in {mode} already says the same
		// thing. Rewrite saved rows so nobody is left with literal token text.
		if (Array.isArray(this.settings.statusRows)) {
			for (const row of this.settings.statusRows) {
				if (!row) continue;
				for (const slot of ['left', 'center', 'right'] as const) {
					if (typeof row[slot] !== 'string') continue;
					const before = row[slot];
					let v = before
						.split('{nump}').join('{num}')
						.replace(/\s*\{(toc|textview|lock)\}\s*/g, ' ')
						.replace(/[ \t]{2,}/g, ' ');
					// Only tidy the edges of a slot a token was actually
					// removed from: that slot's spacing is changing anyway, and
					// the substitution leaves a space of its own behind. Slots
					// left alone keep whatever padding was deliberately typed.
					if (v !== before) v = v.trim();
					row[slot] = v;
				}
			}
		}
		// Prose analysis (adverb / passive / hedge marking) was removed; only
		// its code-skipping preference carries over, since syntax highlight
		// wants the same answer.
		// The flash used to be a boolean that outlined the editor. Screen is
		// the closest equivalent of "on".
		if (this.settings.hemFlashOnBlock != null) {
			this.settings.hemFlashTarget = this.settings.hemFlashOnBlock ? 'screen' : 'none';
			delete this.settings.hemFlashOnBlock;
		}
		if (this.settings.proseSkipCode != null) {
			this.settings.syntaxSkipCode = !!this.settings.proseSkipCode;
		}
		for (const dead of ['proseEnabled', 'proseSkipCode', 'proseHighlightStyle',
			'proseAdverbs', 'proseAdverbColor', 'prosePassive', 'prosePassiveColor',
			'proseWeasel', 'proseWeaselColor']) {
			delete wsBag(this.settings)[dead];
		}
		// The unified-colours feature and the preset system (saved looks +
		// share codes) were removed. Their keys are dropped from data.json
		// so a hand-read config does not suggest features that no longer
		// exist; any override an older version left inline on body.style is
		// wiped by clearChromeColors() on the first apply pass.
		for (const dead of ['uiColorsEnabled', 'uiBgColor', 'uiTextColor',
			'uiUnifyChrome', 'presets']) {
			delete wsBag(this.settings)[dead];
		}
		// The file-goal hairline (a progress line on the bar's top edge) was
		// removed. Its toggle, its gauge-style selector and the three goal
		// colours went with it — those colours tinted the hairline and
		// nothing else, so keeping pickers for them would have meant
		// controls that change nothing. folderGoalHairline was already dead
		// before this and is swept up here too.
		for (const dead of ['fileGoalHairline', 'folderGoalHairline',
			'goalGaugeStyle', 'goalShowGauge', 'goalCustomColors',
			'goalColor', 'fileGoalColor', 'folderGoalColor']) {
			delete wsBag(this.settings)[dead];
		}
		// The note mini-theme ("Customise background and text") was removed
		// outright. It repainted the whole window from two picked colours
		// and never became reliable across themes; what survives is the
		// cleanup below, because the two colours it stamped lived inline on
		// body.style and an inline custom property outlives an upgrade.
		for (const dead of ['noteCustomColors', 'noteDarkBgColor',
			'noteDarkTextColor', 'noteLightBgColor', 'noteLightTextColor']) {
			delete wsBag(this.settings)[dead];
		}
		// ── THE DEAD KEYS, DELETED RATHER THAN IGNORED ───────────────────
		//
		// A value that still parses under a plausible name is a value somebody
		// reuses: the ch store was once written under `uniCols`, read a vault's
		// old PIXELS as characters, and drew four columns 432px wide. So every
		// retired key is deleted on load, and none is converted.
		//
		// `uniCols`: per-column widths in pixels; a pixel count depends on the
		// font it was dragged in, which is not recorded.
		delete this.settings.uniCols;
		// `folderGoals`: a number typed on a FOLDER used to beat the sum of the
		// notes under it; there is one answer now and it derives.
		delete this.settings.folderGoals;
		// `uniColCh`: the same store in characters; the handles that wrote it
		// are gone and every reading column sizes itself to its contents.
		delete this.settings.uniColCh;
		// `exportTicksAlways`: the export ticks in Obsidian's tree are on only
		// while an Export pane is open.
		delete this.settings.exportTicksAlways;
		// `manuscriptRoots`: the folders that were THE WRITING — what the counts
		// counted, what the compile compiled. Everything in the vault is the
		// writing now. A stale list here is not inert: a vault held `["Booksa"]`,
		// an empty folder, and every total in it was about nothing with no
		// visible sign.
		delete this.settings.manuscriptRoots;
		// `organizerRoot`: one folder the Organizer's tree, totals and compile
		// hung from; the folder the writer clicked (`organizerFolder`) is the
		// visible start now. The `manuscriptRoots` shape exactly — a stale path
		// a future reader could treat as the root.
		delete this.settings.organizerRoot;
		// `uniRootShut`: the fold of the Organizer's own tree, gone with that
		// tree.
		delete this.settings.uniRootShut;
		// `organizerRootShut`: the table's root fold; the subject row that
		// switched it is the Total row now.
		delete this.settings.organizerRootShut;
		// `uniTreeWidth`: dragged by the grip between two panes; there is one
		// pane.
		delete this.settings.uniTreeWidth;
		// `uniShut`: that tree's own fold set.
		delete this.settings.uniShut;
		// `fileTreeGoals`: the tree's goal percentage; the switch is gone.
		delete this.settings.fileTreeGoals;

		// SEVEN GOAL KEYS NOTHING EVER READ: each carried a default and a slot
		// in every vault's data.json, and `settings.<key>` appears nowhere in
		// the plugin (`goalsFile` hid behind `goalsFileSync` and its kin — the
		// goals file syncs on a SIGNATURE and asks no switch). Deleting them
		// removes a line from a file, not a feature.
		delete this.settings.goalsFile;
		delete this.settings.goalBaseline;
		delete this.settings.goalRingWeight;
		delete this.settings.goalOrientation;
		delete this.settings.goalLenWriting;
		delete this.settings.goalLenFile;
		delete this.settings.goalLenFolder;

		// `organizerMode`: Outline mode is gone; the only mode is the table.
		delete this.settings.organizerMode;
		// …and the stores the mode owned:
		delete this.settings.organizerOutlineProps;
		// `synopsisKey`: the frontmatter key a synopsis was read from; nothing
		// displays that field.
		delete this.settings.synopsisKey;
		// `organizerOutlineProp`, `organizerOutlineReads`: the outline's chosen
		// property and its readings.
		delete this.settings.organizerOutlineProp;
		delete this.settings.organizerOutlineReads;
		// `organizerLongFields`: written by the ★ column, the properties an
		// Outline card drew in full. It was never in DEFAULT_SETTINGS: a
		// default is never absent, and a shipped `['synopsis']` would have
		// overruled a writer's own key.
		delete this.settings.organizerLongFields;
		// `organizerNameColPx` → `uniColPx.name`: the Name column had ONE
		// number; twelve columns need twelve, so there is one map and the Name
		// column is a member of it. KEYED ON `raw`, DECIDED ONCE: it runs only
		// where the map is ABSENT, so a writer who has since dragged the Name
		// column cannot have the old number put back over it. Read from `raw`,
		// not `this.settings`, where the defaults have already been merged in.
		if (raw.uniColPx === undefined) {
			const px = Number(raw.organizerNameColPx);
			if (isFinite(px) && px > 0) this.settings.uniColPx = { name: Math.round(px) };
		}
		// And the old key goes.
		delete this.settings.organizerNameColPx;
		// `folderStatus`: only files have flags. A stale map of folder paths is
		// a list a future reader could treat as flagged. The structure file
		// stops being written with folder flags, `goalsStoreAdopt` stops
		// reading them back and `renameGoalPaths` stops following them; delete
		// here alone and the next structureRead puts the key straight back.
		delete this.settings.folderStatus;
		// `uniScope`: a PERSISTED narrowing of the table — the `manuscriptRoots`
		// fault one storey up; the search box and the filters answer per
		// glance.
		delete this.settings.uniScope;
		// `uniBoard`, `uniBoardTags`: the corkboard; a vault that reinstalls
		// with `uniBoard: true` must not wake a view that no longer exists.
		delete this.settings.uniBoard;
		delete this.settings.uniBoardTags;
		// `uniNameCh`: the name-drag width; the table's name column is capped by
		// max-width and the browser owns every width.
		delete this.settings.uniNameCh;
		// readTimeWpm: {readtime} is fixed at READ_WPM now.
		// dateFormat:  {date} became {dd} {mm} {yyyy} {yy}, composed in the
		//              row format, so there is no format string to store.
		// powerlineCapStyle: the end cap follows the row's own dividers.
		// statusBarPadSide (a left/right inset for the bar) never took effect
		// in the field across three implementations — margin, left/right from
		// a custom property, and an inline write on the element — so it was
		// removed rather than left as a control that does nothing.
		for (const dead of ['readTimeWpm', 'dateFormat', 'powerlineCapStyle',
			'statusBarPadSide']) {
			delete wsBag(this.settings)[dead];
		}
		// Row height range moved from 20-60 to 12-30. A saved value outside
		// the new bounds has to be clamped here: the slider would render
		// pinned at an end while the bar kept drawing at the old size, and
		// nothing the user did to the control would change anything until
		// they happened to drag past the stored value.
		// Text colours went from six to four. A saved ;5 or ;6 in a row now
		// wraps to ;1/;2 rather than failing, so the format strings are left
		// alone; only the dead keys are swept.
		delete this.settings.powerlineText5;
		delete this.settings.powerlineText6;
		if (typeof this.settings.statusBarHeight === 'number') {
			this.settings.statusBarHeight =
				Math.max(12, Math.min(30, this.settings.statusBarHeight));
		}
		// Groove and Ridge were removed from the Line style dropdown. This
		// has to be a REWRITE, not a delete: the value is stamped straight
		// into a CSS border-style, so a saved 'groove' would keep rendering
		// while the dropdown — asked to select a value it no longer offers —
		// showed whatever its first option is. Solid is the nearest thing
		// either of them was pretending to be, and both were fetched by
		// someone who wanted a line there.
		if (this.settings.statusBarBorderStyle === 'groove'
			|| this.settings.statusBarBorderStyle === 'ridge') {
			this.settings.statusBarBorderStyle = 'solid';
		}
		// The same value can arrive inside a SAVED PRESET, which is applied
		// wholesale and never passes through the check above.
		for (const snap of Object.values(this.settings.barPresets || {})) {
			if (snap && (snap.statusBarBorderStyle === 'groove'
				|| snap.statusBarBorderStyle === 'ridge')) {
				snap.statusBarBorderStyle = 'solid';
			}
		}
		// {date} in saved rows would otherwise render as the literal text
		// "{date}" forever. Rewritten to the pair it almost always meant;
		// anyone wanting a different order edits the row.
		for (const row of (this.settings.statusRows || [])) {
			for (const slot of ['left', 'center', 'right'] as const) {
				if (typeof row[slot] === 'string' && row[slot].includes('{date}')) {
					row[slot] = row[slot].replace(/\{date\}/g, '{dd}/{mm}');
				}
			}
		}
		// Always end up with exactly three well-formed row slots, whatever
		// was in data.json — hand-edited configs included.
		{
			const src = Array.isArray(this.settings.statusRows) ? this.settings.statusRows : [];
			this.settings.statusRows = [0, 1, 2].map(i =>
				Object.assign({ left: '', center: '', right: '' }, src[i] || {}));
		}
		// The old fill bar drew Unicode block characters in the interface font,
		// which is why it read as a terminal artifact. It has been replaced by
		// a drawn ring; goalBarCells is the marker that data.json predates the
		// change, so anyone who was on the block bar lands on the ring.
		// The border was a single on/off flag; the style None is the "off" (not
		// weight 0, which `|| 1` drew as 1px for a year and is the hairline now).
		// goalDisplay, goalRingPercent and goalShapeLabel collapsed into one
		// mode shared by all three goals. The block bar became a ring long
		// before that, so 'bar' resolves the same way 'ring' does: to the
		// default percentage mode.
		if (this.settings.goalShapeLabel != null || this.settings.goalRingPercent != null ||
			this.settings.goalDisplay != null) {
			if (this.settings.goalDisplay === 'fraction')     this.settings.goalLabelMode = 'fraction';
			else if (this.settings.goalShapeLabel != null)    this.settings.goalLabelMode = this.settings.goalShapeLabel;
			else if (this.settings.goalRingPercent === false) this.settings.goalLabelMode = 'none';
			delete this.settings.goalDisplay;
			delete this.settings.goalRingPercent;
			delete this.settings.goalShapeLabel;
		}
		if (this.settings.statusBarBorder != null) {
			if (!this.settings.statusBarBorder) this.settings.statusBarBorderStyle = 'none';
			delete this.settings.statusBarBorder;
		}
		// 'hairline' was briefly a rule STYLE; it is the rule WEIGHT 0. A vault
		// that chose it keeps the look: Solid at 0. Keyed on the value, which
		// nothing can write again.
		if (this.settings.statusBarBorderStyle === 'hairline') {
			this.settings.statusBarBorderStyle = 'solid';
			this.settings.statusBarBorderWidth = 0;
		}
		// 'squiggle' was a mark STYLE through 1.5.4, and the checks' default. A
		// vault that chose it, or never chose, lands on Line — the nearest mark.
		// Keyed on the value, which nothing can write again.
		if (this.settings.syntaxStyle === 'squiggle') this.settings.syntaxStyle = 'line';
		if (this.settings.checkStyle === 'squiggle') this.settings.checkStyle = 'line';
		if (this.settings.goalBarCells != null) delete this.settings.goalBarCells;
		// The slim bar was dropped; the ring is the only indicator now.
		// goalLabel used to place text beside the indicator. The percentage
		// now lives inside the ring, so the old setting maps onto the toggle.
		if (this.settings.goalLabel != null) {
			if (this.settings.goalLabel === 'none') this.settings.goalLabelMode = 'none';
			// Goal tokens are gone from the bar — goals live in settings and
			// on the hairline edges now. Saved bars that still carry the old
			// tokens would otherwise print them as literal text.
			if (Array.isArray(this.settings.statusRows)) {
				for (const r of this.settings.statusRows) {
					for (const k of ['left', 'center', 'right'] as const) {
						if (r && typeof r[k] === 'string' && /\{(?:goal|filegoal|foldergoal)\}/.test(r[k])) {
							r[k] = r[k].replace(/\{(?:goal|filegoal|foldergoal)\}/g, '').replace(/  +/g, ' ').trim();
						}
					}
				}
			}
			delete this.settings.goalLabel;
		}
		// The ASCII arrow style was removed (too similar to Chevron) — carry
		// anyone still on it over to the closest replacement.
		if (this.settings.arrowStyle === 'ascii') {
			this.settings.arrowStyle = 'chevron';
		}
		// The vim command line was restyled shorter, so any height measured
		// under the old rules over-reserves the gutter and leaves the bar
		// floating above the panel until the next `:` re-measures. Drop it
		// once and let it be taken again; 0 simply means "not measured yet"
		// and falls back to a snapped row.
		if (this.settings.vimPanelHeight > 34) this.settings.vimPanelHeight = 0;
		// The cursor-position memory was removed. It kept a growing
		// path -> {line, ch, scroll} map in data.json, so drop it rather
		// than leave a dead table there forever.
		delete this.settings.restoreCursorPosition;
		delete this.settings.cursorMemory;
		// Transient UI state that older versions leaked into data.json, plus
		// settings for the removed exit button. Dropped on next save.
		delete this.settings._lastArrowCount;
		delete this.settings.exitButtonVisibility;
		delete this.settings.autoHideButtonOnDesktop;
		// Zen padding, removed. The bottom half never worked in the field
		// (five attempts) and the
		// top half went with it rather than leaving half a group behind.
		// Dropped from data.json on the next save so nobody carries two
		// settings that nothing reads.
		delete this.settings.topPadding;
		delete this.settings.bottomPadding;
		// {writechecks} became {prose} in 1.10. Rewritten in place so the
		// panel shows the current spelling; the substitution table still
		// accepts the old one, which is what keeps a share code or a preset
		// written before the rename working. Both halves are needed — this
		// reaches only this vault's rows, and the alias reaches everything
		// that arrives later.
		if (Array.isArray(this.settings.statusRows)) {
			for (const row of this.settings.statusRows) {
				if (!row) continue;
				for (const slot of ['left', 'center', 'right'] as const) {
					if (typeof row[slot] === 'string' && row[slot].includes('{writechecks}')) {
						row[slot] = row[slot].replace(/\{writechecks\}/g, '{prose}');
					}
				}
			}
		}
		// {outliner} became {organizer}: the substitution table still ACCEPTS
		// the old spelling, and this rewrites the rows a vault already has so
		// the settings panel shows the new one.
		if (Array.isArray(this.settings.statusRows)) {
			for (const row of this.settings.statusRows) {
				if (!row) continue;
				for (const slot of ['left', 'center', 'right'] as const) {
					if (typeof row[slot] === 'string' && row[slot].includes('{outliner}')) {
						row[slot] = row[slot].replace(/\{outliner\}/g, '{organizer}');
					}
				}
			}
		}

		// Seed the shipped bar presets into the library, exactly once. The
		// flag is what makes a deleted built-in stay deleted — the obvious
		// version of this (add any name that is missing) resurrects them on
		// every launch, so "delete" would only ever mean "until restart".
		// The identity check is the third clause for the usual reason: the
		// merge in loadSettings is shallow, so on a vault that has never saved
		// one, `settings.barPresets` IS the literal in DEFAULT_SETTINGS, and
		// the seeding below would write the shipped presets into the defaults
		// table rather than into this vault's copy.
		if (!this.settings.barPresets || typeof this.settings.barPresets !== 'object'
			|| this.settings.barPresets === DEFAULT_SETTINGS.barPresets) {
			this.settings.barPresets = {};
		}
		// SEEDED BY NAME. A flag alone means a vault seeded with two presets
		// never receives a third: each shipped name is seeded once and
		// remembered, so a new one arrives on the next launch and a deleted one
		// stays deleted. A vault that carries the flag and no list was seeded
		// when Plain and Code were the whole set. Never overwrite: a vault from
		// before the flag may already hold a user's own preset under one of
		// these names.
		{
			// AN EMPTY LIST IS NO LIST: the default is `[]`, and it reaches a
			// vault that was seeded before the list existed, so the flag has
			// to be asked — and it says those vaults had Plain and Code.
			const had = Array.isArray(this.settings.barPresetsSeededNames)
				? this.settings.barPresetsSeededNames.slice() : [];
			const seeded = had.length ? had
				: (this.settings.barPresetsSeeded ? ['Plain', 'Code'] : []);
			let grew = false;
			for (const [name, snap] of Object.entries(DEFAULT_BAR_PRESETS)) {
				if (seeded.indexOf(name) !== -1) continue;
				if (!(name in this.settings.barPresets)) {
					this.settings.barPresets[name] = barCloneValue(snap);
				}
				seeded.push(name);
				grew = true;
			}
			if (grew || !Array.isArray(this.settings.barPresetsSeededNames)) {
				this.settings.barPresetsSeededNames = seeded;
			}
			this.settings.barPresetsSeeded = true;
		}
		// THE INK PRESET IS RETIRED. A vault that got it from the seeder (its
		// name is in barPresetsSeededNames) loses it here, edited or not; a bar
		// the writer saved under that name themselves, in a vault the seeder
		// never gave one, is theirs and stays. The name stays in the seeded
		// list, so it is never seeded again.
		try {
			const seededInk = Array.isArray(this.settings.barPresetsSeededNames) && this.settings.barPresetsSeededNames.indexOf('Ink') !== -1;
			if (seededInk && this.settings.barPresets && this.settings.barPresets.Ink) delete this.settings.barPresets.Ink;
		} catch (_) { wsCatch('loadSettings: the retired Ink preset', _); }

		// The bar a brand-new vault comes up with.
		//
		// The DEFAULT_SETTINGS values for BAR_KEYS are frozen — barShareFields
		// emits only what DIFFERS from them and the recipient fills the rest
		// back in from their own copy, so retuning one silently changes what
		// every share code already in the wild decodes to (see the note above
		// BAR_KEYS). The defaults therefore stay exactly as they are, and the
		// opening bar is chosen by APPLYING a preset over them instead. Same
		// result on screen, no reinterpretation of anyone's code, and the
		// presets that leave a key unstated still inherit what they always
		// did.
		//
		// Guarded on the saved file being empty, not on a flag: an empty
		// data.json means this vault has never expressed an opinion about
		// anything, which is the only case where overwriting the bar is
		// certainly safe. An upgrading vault — including one that never
		// touched the Retro Bar tab — keeps the bar it has.
		if (!Object.keys(raw).length && DEFAULT_BAR_PRESETS.Plain) {
			this.applyBarSnapshot(DEFAULT_BAR_PRESETS.Plain);
			this._activeBarPreset = 'Plain';
		}
	}

	// ─────────────────────────────────────────────────────────────────────────

	// Whether Obsidian's Vim key bindings are on. The vim ":" line only
	// exists when they are, and it is the reason the gutter is reserved.
	isVimKeysOn() {
		try {
			const vault = this.app.vault;
			return !!(vault && vault.config && vault.config.vimMode === true);
		} catch { return false; }
	}

	// ─────────────────────────────────────────────────────────────────────────

	// Persist settings. By default the full refresh() (mask/observer teardown
	// and rebuild) is debounced so a slider drag firing onChange every tick
	// doesn't rebuild the world per tick — only the trailing call applies.
	// Pass applyImmediately for state changes that must land now (zen toggle,
	// master switch).
	// ── A FAILED SAVE MUST NOT REACH THE CALLERS ─────────────────────
	//
	// A rejection here — a full disk, a locked vault, a sync conflict —
	// would walk out to every caller with no handler: an unhandled
	// rejection, and a setting that silently did not persist. Caught at
	// the function, not at the callers: a `.catch` bolted onto every call
	// site is eighty-seven chances to forget the eighty-eighth.
	//
	// AND EVERYTHING BELOW STILL RUNS: `goalsFileSync` and
	// `settingsMirrorSync` write the writer's OWN files, and
	// `ws-settings.md` exists precisely to survive the loss of data.json.
	// A save that just failed makes the mirror more important, not less,
	// so a failure here is reported and passed over rather than returned
	// on.
	async saveSettings(applyImmediately = false) {
		try {
			// STRIPPED, NOT DELETED. `wsForDisk` hands back a copy with the
			// session-only keys removed; the live `this.settings` keeps them,
			// because a writer changing the chart and then changing a colour must
			// not have the chart reset by the colour's save.
			await this.saveData(wsForDisk(this.settings));
			// IT WORKED, so the next failure is news again.
			this.storeWriteOk(WS_WRITE.settings);
		} catch (e) { this.settingsSaveFailed(e); }
		// The flags follow the settings from ONE place, for the same reason
		// the goals file does: they are set from a settings tab, a count, and
		// four widgets per row, and hooking each of those is four chances to
		// miss one.
		try { this.flagsApply(); } catch (_) { wsCatch('saveSettings: this.flagsApply();', _); }
		// The goals file follows the settings, and follows them from ONE
		// place: goals are set from the gauge, from three settings rows and
		// from a rename, and hooking each of those would be four chances to
		// miss one. It writes only when the targets have actually changed.
		this.goalsFileSync();
		// …and the settings mirror, from the same one place and for the same
		// reason: settings are changed from six tabs, a menu, a dozen widgets
		// and a rename, and hooking each of those would be a dozen chances to
		// miss one. Debounced hard — the mirror is the least urgent thing in
		// the plugin, and a write per keystroke in a colour picker is noise in
		// the vault and in sync.
		this.settingsMirrorSync();
		if (applyImmediately) {
			if (this._refreshTimer) { window.clearTimeout(this._refreshTimer); this._refreshTimer = null; }
			this.refresh();
		} else {
			this.scheduleRefresh();
		}
	}

	// ── …AND THE WRITER IS TOLD, ONCE ────────────────────────────────
	//
	// A settings save that fails is SILENT DATA LOSS: the choice is on
	// screen, it is in memory, and it is not on disk. Nobody opens a
	// console — the export says "export failed —" in a Notice for the
	// same reason.
	//
	// ONCE PER RUN OF FAILURES, re-armed by the next save that works. A
	// disk that is full stays full, and `saveSettings` is called from a
	// dozen widgets: without the latch a stuck vault would paint a wall
	// of toasts and bury the one that mattered.
	//
	// AND IT NAMES THE WAY OUT, because the mirror really is one: the
	// same call goes on to write `ws-settings.md`, which is read back
	// into an empty data.json. That is not consolation, it is the
	// instruction.
	//
	// THROUGH THE ONE REPORTER: `storeWriteFailed` is the console line,
	// the latch and the Notice for every store write; the settings are
	// simply the first subject it was written for. ONE LATCH TABLE, NOT A
	// FLAG BESIDE IT — two mechanisms for one idea is how the second
	// stops being re-armed, and the symptom of that is silence.
	settingsSaveFailed(e: unknown) {
		return this.storeWriteFailed(WS_WRITE.settings, e,
			'They are still set for this session, and are mirrored to '
			+ 'ws-settings.md.');
	}

	scheduleRefresh() {
		if (this._refreshTimer) window.clearTimeout(this._refreshTimer);
		this._refreshTimer = window.setTimeout(() => {
			this._refreshTimer = null;
			this.refresh();
		}, 120);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Core refresh
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// APPLY: the single path from settings to the DOM
	// ════════════════════════════════════════════════════════════════════════

	refresh() {
		// NOTHING IS BUILT ON A BLOCKED START. onload returned before the
		// commands, the events and the editor extensions were registered; a
		// refresh reached through a settings toggle would build the surfaces
		// over a half-registered plugin. Try again is a real off-and-on.
		if (this._startBlocked) return;
		this.updateWsRibbonState();
		if (!this.settings.pluginEnabled) { this.disablePlugin(); this.reconfigureEditors(); return; }
		// Back on: the ribbon returns, and the panel returns to the side it
		// was taken from. Both are no-ops when nothing was removed, so this
		// costs a running plugin nothing.
		void this.restoreMenuPanelSpot();
		// Scope decides what the rest of this method may apply, and the list
		// may have just changed, so it is resolved first.
		this._scopeGen++;
		this._lastScopeInScope = this.isActiveFileInScope();
		this.applyBodyClasses();
		this.applyCssVariables();
		this.applyEditorFont();
		this.applyStyleProps();
		this.updateWorkspaceAesthetics();
		this.setSidebarVisibility();
		// After setSidebarVisibility, never before: that is the zen toggle's
		// own pass and it must see the sidebars as the toggle left them.
		this.syncSurfaceSidebars();
		void this.updateFocusedFileMode();
		this.typewriterScroll();
		// The dim/marker decorations read settings only when (re)built, so a
		// settings change needs the editors reconfigured to take effect.
		this.reconfigureEditors();
		if (this.explorerWanted()) {
			this.attachExplorerObserver();
			// AND A PASS, not only an observer. Attaching watches for the
			// NEXT change to the tree; a writer who has just switched flags
			// on is looking at a tree that is not going to change until they
			// touch it.
			this.scheduleExplorerPatch();
		} else {
			this.detachExplorerObserver();
			this.removeWordCounts();
		}
		// …and the order, which patches or unpatches itself from one call.
		// Switching it OFF has to put the tree back within the same gesture:
		// a writer turning it off and seeing their tree still in book order
		// would reasonably conclude the switch does nothing.
		this.patchExplorerSort();
	}

	disablePlugin() {
		// The theme comes off first, and by name: clearChromeColors below
		// is exempted from theme variables ON PURPOSE (see the janitor),
		// so it is the one sweep that cannot do this job.
		this.barThemeUndress();
		// The chrome override lives on body, not in the stylesheet, so it
		// outlives clearStyleProps() unless it is cleared by hand.
		this.clearChromeColors();
		this.endBarPeek(true);
		this._peekArmed = false;
		this.clearBarBounds();
		this.removeCustomElements();
		this.stopClockTick();
		this.clearStyleProps();
		this.detachExplorerObserver();
		this.removeWordCounts();
		this.orgTreeHookDetach();
		this.orgTicksClear();
		this.detachScrollHandler();
		this.detachResizeHandler();
		// THE PANEL AND THE RIBBON GO TOO. A kill switch that leaves a pane
		// in the sidebar and a button on the ribbon has not switched the
		// plugin off — it has switched off the parts that were easy to find,
		// and those two are Word-Smith's most visible surfaces.
		//
		// The panel's SIDE is remembered first, so enabling puts it back
		// where the writer had it rather than in Obsidian's default sidebar.
		// A pane that returns to the wrong place is its own small insult.
		this.rememberMenuPanelSpot();
		this.closeMenuPanel();
		// (The ribbon button is taken off the ribbon by `updateWsRibbonState`,
		// which `refresh` runs before this.)
		// Both caches hold a reference to a CodeMirror document; drop them so
		// a disabled plugin does not pin one.
		this._fenceCache = null;
		this._paraCache = null;
		this._docStatsCache = null;
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }
		// Strip all body classes and attributes
		this.clearAllBodyState();
		// Vim maps live on a global adapter, not in our extensions, so they
		// have to be released by hand.
		this.applyVimMotionMaps();
		document.body.removeAttribute('data-zen-hide-inline-title');
		document.body.removeAttribute('data-zen-focused-file');
		// The horizontal padding rule is unscoped (applies always), so it
		// needs its own reset when the plugin itself is turned off. The
		// vertical pair is zen-scoped and would stop applying anyway once
		// the body classes are cleared above, but clearing them keeps a
		// disabled plugin from leaving any of its variables on :root.
		document.documentElement.style.removeProperty('--ws-editor-padding-h');
		// Left behind by the removed zen padding. An inline custom property
		// on :root outlives the stylesheet that read it, so a vault that had
		// the feature keeps the value forever unless it is actively cleared
		// — the same failure mode as the note mini-theme's three.
		document.documentElement.style.removeProperty('--zen-mode-top-padding');
		document.documentElement.style.removeProperty('--zen-mode-bottom-padding');
		// Restore tab containers — only the ones we changed, and to their own
		// previous values. This line used to reach every .workspace-tabs in
		// the workspace and blank its inline flex, which is where a sidebar's
		// pane sizes went. See _focusTabRestore.
		this._focusTabRestore();
		// Restore sidebars
		const ws = this.app.workspace;
		if (ws.leftSplit && !ws.leftSplit.collapsed)   ws.leftSplit.expand();
		if (ws.rightSplit && !ws.rightSplit.collapsed) ws.rightSplit.expand();
		// Exit fullscreen
		if (document.fullscreenElement && document.exitFullscreen) {
			document.exitFullscreen().catch(() => {});
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Paragraph tagger (double-enter indent)
	// ─────────────────────────────────────────────────────────────────────────

	// ─────────────────────────────────────────────────────────────────────────
	// Zen mode toggle (from new zen plugin)
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// TOGGLES
	// ════════════════════════════════════════════════════════════════════════

	// Flip a boolean setting and apply it now (no debounce — these are
	// hotkey-driven). Pass ensurePos to also switch the master POS toggle on,
	// so "Syntax highlight: verbs" does what it says from a cold start.
	async toggleSetting(key: WsBoolKey, ensurePos?: boolean) {
		this.settings[key] = !this.settings[key];
		if (ensurePos && this.settings[key]) this.settings.posEnabled = true;
		await this.saveSettings(true);
	}

	// ── THE RIBBON BUTTON GOES WITH THE SWITCH ───────────────────────
	//
	// Hiding the element is the desktop half of the job: the phone lists
	// the ribbon from `leftRibbon.items`, skipping only what is flagged
	// hidden, so a button that is `display: none` is still offered there.
	// The switch does what Obsidian's own unload does — `removeRibbonAction`
	// (the id is `<plugin id>:<title>`, as `addRibbonIcon` builds it) and
	// the element detached — and then the one thing unload leaves behind,
	// the entry in the array, goes too, or the phone would still list it
	// and its tap would call a callback that had been deleted. On: made
	// again through the same builder onload used, so it is the same button.
	// A ribbon-config "hide" the writer had set on our button is not kept
	// across an off-and-on: Obsidian keys that on the array entry, and the
	// entry is what had to go.
	wsRibbonMake() {
		if (this.wsRibbonEl) return;
		// "WS" badge ribbon button — OPENS THE MENU. (It toggled the whole
		// plugin until 1.3.0; this comment said so for a while after it
		// stopped being true, which is its own small lesson.) On mobile
		// Obsidian lists ribbon items by this label, so the label is the
		// only thing a phone shows — it has to say what the button does.
		// Obsidian's addRibbonIcon expects a Lucide icon name; we replace
		// the SVG it inserts with a text badge and use a class hook for
		// styling. The label doubles as the tooltip.
		const el = this.addRibbonIcon('type', WS_RIBBON_TITLE, () => this.openBarMenu());
		if (!el) return;
		this.wsRibbonEl = el;
		el.addClass('ws-ribbon-btn');
		el.empty();
		// A SERIF W — THE REGISTERED ICON, the same one the docked leaf
		// wears. It was a styled text span here and a drawn glyph there,
		// and the two sat one above the other in the sidebar looking
		// almost but not quite alike. Almost is worse than different.
		// One icon, set through Obsidian's own setIcon, and the question
		// cannot come back.
		//
		// (An S sat behind it for one build. Two letters in an 18px square
		// is a monogram at a size that cannot hold one — at ribbon scale
		// the pair read as a smudge.)
		const badge = el.createSpan({ cls: 'ws-ribbon-badge' });
		let iconSet = false;
		try {
			if (setIcon) { setIcon(badge, WS_ICON); iconSet = !!badge.querySelector('svg'); }
		} catch (_) { wsCatch('wsRibbonMake: if (setIcon) setIcon(badge, WS_ICON);', _); }
		// The text span stays as the fallback for a build where the icon
		// did not register: a blank ribbon button is worse than a letter
		// that is merely close.
		if (!iconSet) badge.createSpan({ cls: 'ws-ribbon-w', text: 'W' });
	}
	wsRibbonDrop() {
		const el = this.wsRibbonEl;
		if (!el) return;
		this.wsRibbonEl = null;
		const id = this.manifest.id + ':' + WS_RIBBON_TITLE;
		try {
			const ribbon = this.app.workspace.leftRibbon;
			if (ribbon && typeof ribbon.removeRibbonAction === 'function') ribbon.removeRibbonAction(id);
			if (ribbon && Array.isArray(ribbon.items)) {
				const at = ribbon.items.findIndex((i) => i && i.id === id);
				if (at !== -1) ribbon.items.splice(at, 1);
			}
		} catch (_) { wsCatch('wsRibbonDrop: ribbon.removeRibbonAction(id)', _); }
		try { el.detach(); } catch { try { el.remove(); } catch (_2) { wsCatch('wsRibbonDrop: el.detach();', _2); } }
	}
	updateWsRibbonState() {
		if (this.settings && this.settings.pluginEnabled === false) this.wsRibbonDrop();
		else this.wsRibbonMake();
	}

	// ── AND OUR OWN WINDOW IS NOT "ANOTHER FILE" ─────────────────────
	//
	// `isActiveFileInScope` asks for the active MARKDOWN view, and one of
	// our panes is not one — so focusing the Organizer would read as "no
	// note here", the bar would come down, and the native bar it hides
	// would come back with the note's word count under the writer's table.
	// The Organizer, Export and History are windows ONTO the writing, so
	// the bar keeps the answer it had for the note in hand.
	//
	// THE NOTE IN HAND, not "the last true answer": a cached boolean would
	// outlive the note that made it true and light the bar over somebody
	// else's vault. `activeNoteFile` falls through to the workspace's own
	// active file, which is the note the pane was opened beside.
	wsOwnViewActive() {
		// THROUGH `getActiveViewOfType`, not `workspace.activeLeaf`: the
		// sanctioned door, and it answers null for a deferred view rather than
		// a shell with no type. The three panes are three instances of the one
		// view class.
		try {
			if (!WsOutlinerView) return false;
			const ws = this.app.workspace;
			const v = ws && typeof ws.getActiveViewOfType === 'function' ? ws.getActiveViewOfType(WsOutlinerView) : null;
			return !!v;
		} catch (_) { wsCatch('wsOwnViewActive: const v = ws.getActiveViewOfType(WsOutlinerView);', _); return false; }
	}


	// ─────────────────────────────────────────────────────────────────────────
	// Scope
	//
	// Scope gates the writing surface — masks, retro bar, text options, all
	// four editor decorations and the Hemingway lock. It deliberately does not
	// gate zen mode's workspace chrome or sidebar state: zen is a mode you
	// enter by hotkey for a session, and flinging the sidebars open every time
	// you glance at an out-of-scope note would be worse than useless. Sidebar
	// word counts stay vault-wide too — those are for navigating, not writing.
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// SCOPE: path lists + per-note frontmatter
	// ════════════════════════════════════════════════════════════════════════

	// ── Per-note overrides ───────────────────────────────────────────────────
	// Path lists handle projects; frontmatter handles this note today.
	//
	//   wordsmith: off       the plugin does nothing in this note
	//   ws-zen: true         override a mode for this note only
	//   ws-typewriter: false
	//   ws-hemingway: true
	//   ws-syntax: true      the word classes, and the prose checks —
	//   ws-checks: false     a journal wants neither, a draft wants both
	//   ws-typography: false
	//
	// THE KEYS ARE THE ONES A NOTE CAN MEAN: how it is written (a mode), and
	// what is marked in it. A per-note font and per-note markers were here
	// and are not — a font is the vault's, the markers are a way of looking
	// — and `ws-goal` is not: a target has one home, `ws-goals.md`, where it
	// can be seen beside its neighbours.
	//
	// Cached per path and dropped whenever the metadata cache reports a
	// change, so editing the frontmatter takes effect on the next repaint.
	getOverrides(file: TAbstractFile | null | undefined) {
		if (!file || !file.path) return null;
		if (!this._fmCache) this._fmCache = {};
		if (Object.prototype.hasOwnProperty.call(this._fmCache, file.path)) {
			return this._fmCache[file.path];
		}
		let fm = null;
		try {
			const cache = this.app.metadataCache && this.app.metadataCache.getFileCache(file);
			fm = cache && cache.frontmatter;
		} catch { fm = null; }

		let out: Record<string, boolean | string> | null = null;
		if (fm) {
			// YAML gives booleans for true/false but strings for on/off/yes/no,
			// and people write all of them.
			const isOff = (v: unknown): boolean => v === false || /^(false|off|no)$/i.test(wsStr(v));
			const isOn  = (v: unknown): boolean => v === true  || /^(true|on|yes)$/i.test(wsStr(v));
			const add   = (k: string, v: boolean | string) => { (out = out || {})[k] = v; };

			if ('wordsmith' in fm) add('__disabled', isOff(fm.wordsmith));
			const MAP: Record<string, string> = {
				'ws-zen':        'zenMode',
				'ws-typewriter': 'enableTypewriter',
				'ws-hemingway':  'hemingwayEnabled',
				'ws-syntax':     'posEnabled',
				'ws-checks':     'checksEnabled',
				'ws-typography': 'typographyEnabled'
			};
			for (const key in MAP) {
				if (!(key in fm)) continue;
				if (isOn(fm[key]))       add(MAP[key], true);
				else if (isOff(fm[key])) add(MAP[key], false);
			}
		}
		this._fmCache[file.path] = out;
		return out;
	}

	// Effective value of a setting for a given note.
	optFor<K extends keyof WordSmithSettings>(file: TFile | null, key: K): WordSmithSettings[K] | boolean | string {
		const o = this.getOverrides(file);
		if (o && Object.prototype.hasOwnProperty.call(o, key)) return o[key];
		return this.settings[key];
	}

	// Same, for the note in the active pane.
	opt<K extends keyof WordSmithSettings>(key: K) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return this.optFor(view ? view.file : null, key);
	}

	// And for whichever note a given editor is showing.
	optForView<K extends keyof WordSmithSettings>(cmView: EditorView & { cm?: WsCm5Facade }, key: K) {
		return this.optFor(this.getFileForEditorView(cmView), key);
	}

	// Obsidian keeps its right-to-left preference in appearance config, and
	// also sets it per note. Either is enough to mirror the text options.
	// The Text Options master switch, honoured at RUNTIME rather than only in
	// the settings pane.
	//
	// It used to hide the controls and nothing else: `miscEnabled` appeared
	// exactly once outside the settings tab, in its own default. So switching
	// the tab off left the horizontal padding, the paragraph indent, the line
	// limit, the justification, the line spacing and the hidden markers all
	// still applied, with no visible control left to turn any of them off
	// again. A master switch that only hides its own controls is worse than no
	// master switch, because it lies about what it did.
	//
	// Everything the tab owns is read through this one accessor, so a new
	// setting added to that tab cannot forget to be gated — it is gated by the
	// only route there is to its value.
	textOpt(key: WsBoolKey, whenOff: boolean): boolean;
	textOpt(key: WsNumberKey, whenOff: number): number;
	textOpt(key: WsBoolKey | WsNumberKey, whenOff: boolean | number): boolean | number {
		if (!this.settings.miscEnabled) return whenOff;
		const v = this.settings[key];
		return v === undefined ? whenOff : v;
	}

	// The markers' own gate. Separate from textOpt on purpose: a switch
	// that turns on a marker must not be able to turn on a line-length cap.
	markerOpt(key: WsBoolKey, whenOff: boolean): boolean {
		if (!this.settings.markersEnabled) return whenOff;
		const v = this.settings[key];
		return v === undefined ? whenOff : v;
	}

	isRightToLeft() {
		try {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view && view.editor && view.editor.cm && view.editor.cm.contentDOM) {
				const dir = view.editor.cm.contentDOM.getAttribute('dir');
				if (dir) return dir === 'rtl';
			}
		} catch { /* editor not ready */ }
		try {
			if (this.app.vault.getConfig) return !!this.app.vault.getConfig('rightToLeft');
		} catch (_) { wsCatch('isRightToLeft: if (this.app.vault.getConfig) return …', _); }
		return false;
	}

	// ── Surface gate ─────────────────────────────────────────────────────
	// Word-Smith is a writing suite: everything it does — the bar, the
	// masks, zen's chrome hiding, the type options — is about a note being
	// written. On a canvas, a base, a PDF, the graph or an empty tab there
	// is no note, so it all stands down and Obsidian comes back exactly as
	// it was, native status bar included. This is the FIRST question every
	// scope check asks; the path list and frontmatter overrides only decide
	// between notes.
	//
	// Read from the most recent leaf in the main area, NOT from
	// workspace.activeLeaf: clicking the file explorer, the outline or a
	// search box makes a sidebar leaf active, and gating on that would tear
	// the bar down and put it back every time the pointer left the editor.
	// getMostRecentLeaf() ignores the sidebars, which is exactly the
	// question being asked.
	//
	// getViewType() rather than `instanceof MarkdownView`: since 1.7
	// Obsidian defers unopened tabs, and a deferred view is not an instance
	// of anything useful while still reporting the type it will become.
	//
	// Fails OPEN on a throw. A future API change that breaks this should
	// leave the plugin working everywhere, not disable it everywhere.
	isNoteSurfaceActive() {
		try {
			const ws = this.app.workspace;
			// Fast path, and the only one that can see a markdown view in
			// a pop-out window: if the active view IS a note, it is a note.
			if (ws.getActiveViewOfType && ws.getActiveViewOfType(MarkdownView)) return true;
			let leaf = null;
			try { leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf() : null; } catch (_) { wsCatch('isNoteSurfaceActive: leaf = ws.getMostRecentLeaf ? ws.getMostRecentLeaf() : null;', _); }
			const view = leaf && leaf.view;
			if (!view) return false;   // no pane at all
			const type = view.getViewType ? view.getViewType() : '';
			// AN EMPTY TAB IS A NOTE SURFACE WAITING FOR A NOTE. A canvas,
			// a PDF or a base is a different KIND of thing and the bar
			// rightly stands down for them — but a new tab is where a
			// writer lands between notes, and Obsidian's own bar reappearing
			// there for a second read as the plugin flickering off. The
			// bar shows what it can (the clock, the mode, the buttons) and
			// leaves the file readouts empty, which is what they are.
			// WORD-SMITH'S OWN PANEL IS NOT A CHANGE OF SURFACE. Clicking a
			// row in the docked menu makes it the most recent leaf, and
			// this then answered "no note here" — so the masks came down
			// and the letterbox only reappeared once the writer clicked
			// back into the note. The pane is a control surface for the
			// note they are still in; the question is what they are
			// WRITING in, not what they last touched.
			if (type === WS_MENU_VIEW) {
				return !!this.activeNoteFile();
			}
			return type === 'markdown' || type === 'empty';
		} catch { return true; }
	}

	// Whether a given CodeMirror view belongs to a markdown leaf. Canvas
	// cards, base formula fields and embedded editors are real CM6 views
	// that no leaf walk can identify — getFileForEditorView returns null
	// for them, which is indistinguishable from "a note whose leaf is not
	// wired up yet". The leaf container's data-type answers it directly.
	//
	// Fails OPEN for the same reason as above, and specifically so that an
	// editor in some container this does not recognise keeps its
	// decorations rather than silently losing them.
	editorViewIsNote(cmView: EditorView) {
		try {
			const dom = cmView && cmView.dom;
			if (!dom || !dom.closest) return true;
			const host = dom.closest('.workspace-leaf-content[data-type]');
			if (!host) return true;
			return host.getAttribute('data-type') === 'markdown';
		} catch { return true; }
	}

	hasScopeLimits() {
		return Array.isArray(this.settings.scopePaths) && this.settings.scopePaths.length > 0;
	}

	// True when the path is named by the list, either exactly (a note) or as
	// an ancestor (a folder). Prefix matching appends the separator so that
	// "Novel" does not also claim "Novel Ideas/draft.md".
	countExcludeList() {
		const s = this.settings;
		if (!Array.isArray(s.countExclude)) s.countExclude = [];
		return s.countExclude;
	}

	// Whole path segments only, so excluding "Book/Notes" does not also
	// exclude "Book/Notebook.md". The same rule the goal renames and the
	// history scoping use.
	isPathExcludedFromCounts(path: string|string[]) {
		if (!path) return false;
		for (const entry of this.countExcludeList()) {
			if (!entry) continue;
			const base = String(entry).replace(/\/+$/, '');
			if (!base) continue;
			if (path === base || path.indexOf(base + '/') === 0) return true;
		}
		return false;
	}

	isStoreFile(path: string) {
		if (!path) return false;
		try {
			if (path === this._historyPath) return true;
			if (path === this.structurePathNow()) return true;
			if (path === this.goalsFilePath()) return true;
			// …AND THE SETTINGS MIRROR, which was the one store this did not
			// know. CURRENT.md carried it as debt for pairs.
			//
			// It is the same fault the other three are here for, and worse in
			// one way: `settingsMirrorSync` rewrites this note on nearly every
			// settings change — a colour picker, a slider drag, a toggle — so
			// CHANGING A SETTING counted as writing. The plugin saw a modify,
			// counted the words, moved the day's total and repainted the bar.
			// A record of the writing recording itself being kept.
			//
			// THROUGH THE ACCESSOR, not the raw setting: `settingsMirrorPathFor`
			// is what every other reader uses and it is what strips a leading
			// slash. Comparing against `settings.settingsMirrorPath` directly
			// would go on counting in any vault whose path began with one.
			if (path === this.settingsMirrorPathFor()) return true;
		} catch (_) { wsCatch('isStoreFile: if (path === this._historyPath) return true;', _); }
		return false;
	}

	isFileCounted(file: TAbstractFile) {
		if (!file || !file.path) return false;
		// The history store is a note in the vault, and the History tab tells
		// people to keep it beside their manuscript — so without this it lands
		// INSIDE the folder whose goal it would then inflate, growing by a row
		// a day while it does so. It is already excluded from the history
		// itself by path; this is the same exclusion for every other total.
		if (this._historyPath && file.path === this._historyPath) return false;
		// …AND THE OTHER TWO STORES, for the same reason and a worse one.
		// The export list is rewritten every time a box is ticked and the
		// goals file every time a target changes — so ticking a scene in
		// the Export window counted as WRITING: it moved the day's word
		// count, repainted the bar, and glitched the whole interface while
		// a writer was choosing files. A record of the writing should not
		// record itself being kept.
		if (this.isStoreFile(file.path)) return false;
		if (!this.isFileInScope(file)) return false;
		return !this.isPathExcludedFromCounts(file.path);
	}

	pathMatchesScope(path: string) {
		if (!path) return false;
		for (const entry of this.settings.scopePaths) {
			if (!entry) continue;
			if (entry === '/') return true;                 // vault root
			if (path === entry) return true;
			if (path.startsWith(entry.endsWith('/') ? entry : entry + '/')) return true;
		}
		return false;
	}

	isFileInScope(file: TAbstractFile | null | undefined) {
		// `wordsmith: off` in the frontmatter wins over any path list, and
		// `wordsmith: on` opts a note back in past an excluding one.
		const ov = this.getOverrides(file);
		if (ov && ov.__disabled === true)  return false;
		if (ov && ov.__disabled === false) return true;
		if (!this.hasScopeLimits()) return true;
		const exclude = this.settings.scopeMode === 'exclude';
		// No file at all (an empty pane, a non-markdown view): in scope only
		// when the list is naming things to leave out.
		if (!file || !file.path) return exclude;
		const hit = this.pathMatchesScope(file.path);
		return exclude ? !hit : hit;
	}

	isActiveFileInScope() {
		// Surface first: a canvas or a base is out of scope before any path
		// list or frontmatter is consulted, because there is no note to
		// consult them about.
		if (!this.isNoteSurfaceActive()) return false;
		// No "no limits configured" shortcut here: frontmatter can disable a
		// note on its own, and the shortcut used to return true before the
		// override was ever read. getOverrides is cached, so this is cheap.
		//
		// THE NOTE IN HAND, not the active view's file. A click in the file
		// explorer or in a docked pane makes a sidebar leaf the active one, and
		// the active MarkdownView is then null — asked about `null`, an include
		// list answered "out of scope", and the bar came down, Obsidian's own
		// bar came up and the note's font went, on every click beside the
		// editor. `activeNoteFile` is the view still open in the main area (the
		// remembered one), which is the note the question is about.
		return this.isFileInScope(this.activeNoteFile());
	}

	// Which file a given CodeMirror view is showing. Needed because split
	// panes can hold one in-scope and one out-of-scope note at the same time,
	// and the decorations have to follow their own editor, not the active one.
	getFileForEditorView(cmView: EditorView&{ cm?: WsCm5Facade; }) {
		let found: TFile | null = null;
		try {
			this.app.workspace.iterateAllLeaves(leaf => {
				if (found) return;
				const v = leaf && leaf.view;
				if (v && v.editor && v.editor.cm === cmView) found = v.file || null;
			});
		} catch (_) { wsCatch('getFileForEditorView: this.app.workspace.iterateAllLeaves(leaf =>', _); }
		return found;
	}

	// Memoised against a generation counter that every file/layout change
	// bumps, so the leaf walk above happens once per editor per change rather
	// than once per repaint.
	isEditorInScope(cmView: EditorView) {
		if (!cmView) return true;
		// Same reasoning as isActiveFileInScope: the file has to be resolved
		// even with no path list, because its frontmatter may opt out. The
		// generation memo below keeps that to one leaf walk per editor per
		// file/layout change rather than one per repaint.
		if (cmView._wsScope && cmView._wsScope.gen === this._scopeGen) return cmView._wsScope.in;
		// Not a note's editor at all — a canvas card, a base field — so no
		// decoration belongs in it, whatever file the pane behind it holds.
		const val = this.editorViewIsNote(cmView)
			&& this.isFileInScope(this.getFileForEditorView(cmView));
		cmView._wsScope = { gen: this._scopeGen, in: val };
		return val;
	}

	// Called on every leaf/file change. Cheap when no limits are configured.
	syncScope() {
		this._scopeGen++;
		if (!this.settings.pluginEnabled) return;
		const inScope = this.isActiveFileInScope();
		if (inScope === this._lastScopeInScope) return;
		this._lastScopeInScope = inScope;
		this.applyBodyClasses();
		this.reconfigureEditors();
		this.applyVimMotionMaps();
		// Crossing into or out of a note is also what suspends and restores
		// zen's collapsed sidebars.
		this.syncSurfaceSidebars();
	}

	// ════════════════════════════════════════════════════════════════════════
	// DOCUMENT ANALYSIS: counting, paragraphs, non-prose lines
	// ════════════════════════════════════════════════════════════════════════

	getFilePath(view: MarkdownView | null) {
		const file = view && view.file;
		if (!file) return 'no file';
		// _fitShortenFile is set by the fit pass and read HERE, at build
		// time. The first version of this rewrote the rendered element
		// instead, and the bar re-renders every second — the two fought and
		// the name visibly flipped back and forth. Deciding it while the
		// text is being produced means every render is self-consistent and
		// there is nothing to undo.
		if ((this.settings || {}).fileTokenFormat === 'name' || this._fitShortenFile) {
			return file.basename;
		}
		const parts = file.path.split('/');
		return (parts.length <= 1 ? '~/' : '~/' + parts.slice(0, -1).join('/') + '/') + file.basename;
	};

	// THE NOTE A PANEL SHOULD ANSWER ABOUT.
	//
	// `getActiveViewOfType(MarkdownView)` answers null the moment focus
	// leaves the editor — and clicking a row in a docked panel does
	// exactly that, because the panel IS the active leaf. So the Report
	// opened from the panel found no file and reported on "Current note",
	// which is the emptiest possible answer to "how long is this?".
	//
	// The last markdown view seen is remembered instead, and consulted
	// when the live one is gone. Obsidian's own `getActiveFile()` keeps
	// working this way for the same reason — a sidebar click is not a
	// change of note — so this only teaches the plugin what the app
	// already believes.
	rememberActiveMarkdown() {
		try {
			const v = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (v && v.file) this._lastMdView = v;
		} catch (_) { wsCatch('rememberActiveMarkdown: const v = this.app.workspace.getActiveViewOfType(MarkdownView);', _); }
	}

	activeMarkdownView() {
		try {
			const v = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (v && v.file) { this._lastMdView = v; return v; }
		} catch (_) { wsCatch('activeMarkdownView: const v = this.app.workspace.getActiveViewOfType(MarkdownView);', _); }
		// The remembered one, but only while its leaf is still open and
		// still holds a file: a view whose tab was closed must not go on
		// answering for a note nobody is looking at.
		const last = this._lastMdView;
		if (last && last.file) {
			try {
				const alive = this.app.workspace.getLeavesOfType('markdown')
					.some((l) => l.view === last);
				if (alive) return last;
			} catch { return last; }
		}
		// NO SYNTHETIC VIEW. This used to hand back `{ file }` from the
		// app's own active file when no real view could be found — enough
		// for the Report, which only wants a name, and POISON for the mask
		// layout, which asks the view for its scroller. That object has no
		// contentEl, so `stampMaskPositions` threw on every frame: the
		// letterbox set its class, the text took its padding, and nothing
		// was ever drawn. A flicker with no masks in it.
		//
		// This returns a REAL VIEW or nothing. Callers that only want the
		// file ask for the file.
		return null;
	}

	// The note a panel should answer ABOUT, by name. Falls back to the
	// app's own active file, which survives a sidebar click even when the
	// view lookup does not — this is the part the Report wanted, and the
	// part that must not be dressed up as a view.
	activeNoteFile() {
		const v = this.activeMarkdownView();
		if (v && v.file) return v.file;
		try { return this.app.workspace.getActiveFile() || null; } catch { return null; }
	}

	// ── The docked panel ─────────────────────────────────────────────────────
	// Registered once, at load, and only while the setting is on: an
	// unregistered view type in a saved workspace layout is simply skipped
	// by Obsidian, so switching this off cannot corrupt a layout — the
	// pane goes, and comes back where it was if the setting returns.
	// The serif W, drawn. Stroke-based rather than a glyph: an icon has no
	// text node to hang a font on, and a path is the same shape in every
	// vault whatever fonts are installed. The two short cross strokes are
	// the serifs at the top terminals.
	registerWsIcon() {
		if (!addIcon || this._wsIconDone) return;
		this._wsIconDone = true;
		try {
			// THE SAME LETTER AS THE RIBBON, and by the same means: a real
			// glyph in a real serif face. The first version drew a W as
			// stroked paths and did not match — a hand-drawn W is a
			// different letter from a typeset one, and the two sat inches
			// apart where anyone could see it. An <text> node inside the
			// icon's SVG renders the face the ribbon renders, so they are
			// the same shape by construction rather than by resemblance.
			addIcon(WS_ICON,
				'<text x="50" y="76" text-anchor="middle" fill="currentColor" '
				+ 'font-size="84" font-weight="500" '
				+ 'font-family="\'Iowan Old Style\', Georgia, \'Times New Roman\', '
				+ '\'Liberation Serif\', serif">W</text>');
		} catch (_) { wsCatch('registerWsIcon: addIcon(WS_ICON,', _); }
	}

	// Reads CapsLock/NumLock state off a keyboard event and refreshes the
	// retro bar when either changes. Not every keyboard event supports
	// getModifierState (and NumLock has no meaning on keyboards/OSes without
	// a physical numpad concept, e.g. most Mac laptops), so this fails quiet.
	updateModifierState(evt: { getModifierState: (key: string) => boolean } | null) {
		if (!evt || typeof evt.getModifierState !== 'function') return;
		let changed = false;
		try {
			const caps = evt.getModifierState('CapsLock');
			if (caps !== this._capsLockOn) { this._capsLockOn = caps; changed = true; }
		} catch { /* getModifierState with an unsupported key name can throw */ }
		try {
			const num = evt.getModifierState('NumLock');
			if (num !== this._numLockOn) { this._numLockOn = num; changed = true; }
		} catch (_) { wsCatch('updateModifierState: const num = evt.getModifierState(\'NumLock\');', _); }
		if (changed) this.updateRetroStatusBar();
	}

	// Best-effort Vim mode label for {vim}. Obsidian's Vim mode is backed by
	// @replit/codemirror-vim, which exposes its state on a CM5-compatible
	// facade at editor.cm.cm — not officially documented, but it's the same
	// access pattern community Vim-status plugins rely on. Falls back to ''
	// (token renders empty) any time the shape isn't what's expected, e.g.
	// Vim mode is off, or a future Obsidian version changes internals.
	// The caret is in the note itself, rather than in some dialog over it.
	editorHasFocus() {
		try {
			const a = document.activeElement;
			return !!(a && a.closest && a.closest('.cm-editor'));
		} catch { return true; }
	}
}

// The modules' methods onto the prototype (the class top says which is where).
Object.assign(WordSmith.prototype, historyMethods, exportMethods, themesMethods, storesMethods, menuMethods, barMethods, reportMethods, organizerWindowMethods, treeMethods, focusMethods, editorMethods, paintMethods, diagnosticsMethods);
