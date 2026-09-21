// THE TESTS' ENTRY: the plugin class with the module-level names the tests
// reach as statics. Bundled to ws-dev/main.js by `node esbuild.config.mjs
// test`; never shipped. `export default`, and the test build's footer makes
// it `module.exports` itself (`export =` is not an ES module; esbuild would
// refuse it).
import WordSmith from './plugin';
import { WordSmithSettingTab } from './settings-tab';
import { wsCompat, wsCompatText, WS_INTERNALS } from './obsidian-internals';
import {
	wsCountFootnotes, wsOrgAgg, wsOrgDistinct, wsOrgDropBefore, wsOrgFolderWords, wsOrgIndex, wsOrgPathsUnder, wsOrgPut,
	wsOrgRemove, wsOrgRename, wsOrgStale, wsUnderIndex, wsUnderRow,
} from './org-index';
import {
	BAR_DIRECTIVE_BG, BAR_DIRECTIVE_TEXT, BAR_KEYS, BAR_KEYS_INERT, BAR_KEYS_LIVE, BAR_SHARE_VERSION,
	WS_AXIS_MED_MULT, WS_AXIS_PCT, wsAxisBound, wsQuantile,
	barCodeToPreset, barPresetToCode, barPresetWithDefaults, barShareFields,
	DEFAULT_BAR_PRESETS, DEFAULT_SETTINGS, HISTORY_HEAT, mixColors, parseColorRGB, pickBar,
	PL_BG_COUNT, PL_THEME_BGS, readBarDirective,
	WS_FLAG_SHAPES, WS_NARROW_FLIPS, WS_STATE_IDS, WS_STORM_PASSES,
	wsCatch, wsCatchReset, wsCatchSeen, wsColPrefCh, wsCtxScope, wsDeepestLevel, wsDemoteHeadings,
	wsExportRoot, wsFileHeadLevel, wsFitCols, wsFlagSvg, wsForDisk, wsGuard, wsGuardReport,
	wsGuardReset, wsGuardSeen, wsGuardTell, wsLabelCh, wsLineOfSnippet, WsMenuView, wsNarrowDecide,
	wsNarrowState, WsOutlinerView, wsPassState, wsPassStorm, wsRepairSettings, wsSecHeadLevel,
	wsSessionLens, wsSessionNew, wsShareText, wsStatusLabel, wsStatusNext, wsTaskSay, wsTocSteps,
	wsBuildDocx, wsStylesXml, wsBlocksFromMarkdown, wsInlineRuns, wsPara, wsPaperOf, wsTwipIn, WS_PAPERS,
	wsLineTwips, wsJoinMark, wsZip, wsUtf8, wsCrc32, wsXml, wsTable, wsHeaderXml, wsAnchorId, wsRoundWords,
	wsFontMatches, wsProbeInstalledFonts, wsUniqueFonts, WS_SAFE_FONTS, wsTitleWords, findDialogue, BAR_THEMES,
} from './preamble';

export default Object.assign(WordSmith, {
	// the 47 the slices exported
	wsStatusNext, wsStatusLabel, wsFlagSvg, WS_FLAG_SHAPES, wsCountFootnotes, WsOutlinerView,
	wsRepairSettings, wsLineOfSnippet, wsCtxScope, HISTORY_HEAT, WS_STATE_IDS, wsLabelCh,
	wsNarrowDecide, wsPassStorm, wsGuard, wsGuardReset, wsGuardSeen, wsGuardTell, wsGuardReport,
	wsCatch, wsCatchSeen, wsCatchReset, wsCompat, wsCompatText, WS_INTERNALS, wsPassState,
	WS_STORM_PASSES, wsNarrowState, WS_NARROW_FLIPS, wsColPrefCh, wsFitCols, wsExportRoot,
	wsDemoteHeadings, wsFileHeadLevel, wsSecHeadLevel, wsDeepestLevel, wsTocSteps, WsMenuView,
	wsSessionLens, wsTaskSay, DEFAULT_BAR_PRESETS, wsShareText, barCodeToPreset,
	DEFAULT_SETTINGS, wsSessionNew, wsForDisk,
	// the sixteen the bar probes reached through a `__test` line
	WordSmithSettingTab, PL_THEME_BGS, PL_BG_COUNT, readBarDirective, BAR_DIRECTIVE_BG,
	BAR_DIRECTIVE_TEXT, BAR_KEYS, BAR_KEYS_INERT, BAR_KEYS_LIVE, barPresetToCode,
	barPresetWithDefaults, pickBar, barShareFields, BAR_SHARE_VERSION, mixColors, parseColorRGB,
	// the fifteen the suites reached by rewriting the export line
	wsAxisBound, wsQuantile, WS_AXIS_PCT, WS_AXIS_MED_MULT, wsOrgDropBefore, wsOrgIndex, wsOrgPut,
	wsOrgRemove, wsOrgRename, wsOrgStale, wsOrgPathsUnder, wsOrgAgg, wsOrgDistinct, wsUnderIndex,
	wsUnderRow, wsOrgFolderWords,
	// the twenty-three the Word export audit and probe evaluated out of a slice of the text
	wsBuildDocx, wsStylesXml, wsBlocksFromMarkdown, wsInlineRuns, wsPara, wsPaperOf, wsTwipIn, WS_PAPERS,
	wsLineTwips, wsJoinMark, wsZip, wsUtf8, wsCrc32, wsXml, wsTable, wsHeaderXml, wsAnchorId, wsRoundWords,
	wsFontMatches, wsProbeInstalledFonts, wsUniqueFonts, WS_SAFE_FONTS, wsTitleWords,
	// the dialogue finder the menu probe evaluated out of the text, the bar themes the theme probe did
	findDialogue, BAR_THEMES,
});
