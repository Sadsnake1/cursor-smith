// THE TABLE'S CONTEXT, DECLARED.
//
// `orgTableMake(ctx)` reads the window through one bag: the closure's own
// state and draws (accessors written by hand in the window) and, lent by
// name from each Organizer module, the members the table reads. It was
// `Record<string, any>` — the mother of a third of the review's unsafe
// reads: `ctx.panel` alone fed 331 of them, every element born of it an
// `any` too. Each lent member's type is the MODULE'S, taken from the
// factory's return type, so a module typed tighter tightens the table
// with it, and a name lent that the module does not have, or read that
// the bag does not answer, is the checker's error and not the sweep's.
//
// The names are written twice — here and in the window's `.lend(...)`
// chain — and the assignment `const tableCtx: WsOrgCtx = …` holds the two
// lists to each other: a member named here and not lent is a missing
// property; one lent and not named here is simply not read.
import type { WordSmithSettings } from './settings';
import type { WsModEvent } from './plugin';
import type { WsSession } from './preamble';
import type { wsOrgCellsMake } from './organizer-cells';
import type { wsOrgChipsMake } from './organizer-chips';
import type { wsOrgColsMake } from './organizer-cols';
import type { wsOrgDragMake } from './organizer-drag';
import type { wsOrgFilesMake } from './organizer-files';
import type { wsOrgFlagsMake } from './organizer-flags';
import type { wsOrgJournalMake } from './organizer-journal';
import type { wsOrgLensMake } from './organizer-lens';
import type { wsOrgModeMake } from './organizer-mode';
import type { wsOrgPropsMake } from './organizer-props';
import type { wsOrgReadingsMake, WsOrgColAgg } from './organizer-readings';
import type { wsOrgRenameMake } from './organizer-rename';
import type { wsOrgRowsMake } from './organizer-rows';
import type { wsOrgScopeMake } from './organizer-scope';
import type { wsOrgSelMake } from './organizer-sel';
import type { wsOrgShapeMake } from './organizer-shape';
import type { wsOrgWidthsMake } from './organizer-widths';
import type { wsOrgWritesMake } from './organizer-writes';

// What the bar was last told to say, and until when.
export interface WsOrgBarSaid { msg: string; until: number }

// THE CLOSURE'S OWN: its state, its draws, its doors — what no module
// holds. Read-only from the table's side but for the bar's word, which
// `orgBarSay` writes on the context.
export interface WsOrgCtxOwn {
	orgBarSaid: WsOrgBarSaid | null;
	readonly colTextish: (col: { id: string; user?: boolean }) => boolean;
	readonly draw: () => void;
	readonly drawPanel: () => void;
	readonly fill: () => Promise<void>;
	readonly openRow: (it: { kind: string; path: string }, ev?: WsModEvent) => void;
	readonly orgFolder: string;
	readonly orgIsOpen: (p: string) => boolean;
	readonly orgNarrowNow: () => boolean;
	readonly orgOpenSet: (p: string, on: boolean) => void;
	readonly orgOpenSetMany: (paths: string[], on: boolean) => void;
	readonly orgHist: ReturnType<typeof wsOrgJournalMake>['api'];
	readonly orgPruneUserCols: () => boolean;
	readonly ownerWin: () => typeof window;
	readonly panel: HTMLDivElement;
	readonly s: WordSmithSettings;
	readonly ses: WsSession;
	readonly drawSubject: () => void;
	readonly tab: string;
	// THE TABLE'S OWN HOOKS, hung on the bag as it draws so the window can
	// call back into a draw it never sees: the bar's repaint, the
	// journal's, the subject row's aggregate cell writer, the Total row kept
	// for the foot, the selection's repaint. Absent until the table is drawn.
	orgBarSayPaint?: () => void;
	orgHistPaint?: () => void;
	orgAggInto?: (td: HTMLElement, agg: WsOrgColAgg) => void;
	orgTotalRow?: HTMLTableRowElement | null;
	orgSelPaint?: (body: HTMLElement) => void;
}

// LENT FROM THE MODULES, by name. `Pick` of each factory's return: the
// member's type is whatever the module says it is.
export type WsOrgCtx = WsOrgCtxOwn
	& Pick<ReturnType<typeof wsOrgWidthsMake>, 'ORG_COL_MIN' | 'ORG_GRIP_CLICK_MS' | 'orgColCeil' | 'orgColCeilReset' | 'orgColFitNow' | 'orgColGripBind' | 'orgColPx' | 'orgColStamp' | 'orgColUnfix' | 'orgGripReleasedAt' | 'orgNameGripBind' | 'orgNameLineNow' | 'orgNameRO' | 'orgNameStamp' | 'orgScrollTop' | 'orgScrollLeft'>
	& Pick<ReturnType<typeof wsOrgCellsMake>, 'orgBackCell' | 'orgOutCell' | 'orgCanHoldProps' | 'orgGoalBand' | 'orgGoalCell' | 'orgPropCell' | 'orgPropRefuse' | 'orgTagsCell'>
	& Pick<ReturnType<typeof wsOrgLensMake>, 'orgAddChip' | 'orgAt' | 'orgFilterByKey' | 'orgLens' | 'orgLensClear' | 'orgLensOn' | 'orgLensSet'>
	& Pick<ReturnType<typeof wsOrgReadingsMake>, 'orgColAgg' | 'orgColRaw' | 'orgColSortKey' | 'orgColText' | 'orgFolderIcon'>
	& Pick<ReturnType<typeof wsOrgPropsMake>, 'orgEditDone' | 'orgEditGuard' | 'orgFieldEditor' | 'orgOpenAfter' | 'orgPropPopClose' | 'orgPropPopEl' | 'orgPropPopOpen' | 'orgRedrawPending'>
	& Pick<ReturnType<typeof wsOrgShapeMake>, 'setShape' | 'showShape' | 'typeLabel' | 'typeRows'>
	& Pick<ReturnType<typeof wsOrgSelMake>, 'orgSelClick' | 'orgSelHas' | 'orgSelCount'>
	& Pick<ReturnType<typeof wsOrgColsMake>, 'SORTS' | 'colOff' | 'setCols'>
	& Pick<ReturnType<typeof wsOrgChipsMake>, 'orgChipHit' | 'orgPropKeys'>
	& Pick<ReturnType<typeof wsOrgFlagsMake>, 'orgFlagCell' | 'orgRepaintFlagCell'>
	& Pick<ReturnType<typeof wsOrgDragMake>, 'orgDragCol' | 'orgGroupDrop' | 'orgLastGrouping' | 'orgRowDrag'>
	& Pick<ReturnType<typeof wsOrgRowsMake>, 'orgFilePathCache' | 'orgRowList' | 'orgUnder'>
	& Pick<ReturnType<typeof wsOrgFilesMake>, 'nameOf' | 'orgCellHint' | 'orgDrawnSig'>
	& Pick<ReturnType<typeof wsOrgModeMake>, 'orgChevron'>
	& Pick<ReturnType<typeof wsOrgRenameMake>, 'orgMenuCtx'>
	& Pick<ReturnType<typeof wsOrgWritesMake>, 'orgPropSet'>
	& Pick<ReturnType<typeof wsOrgScopeMake>, 'orgNote' | 'showItem'>;
