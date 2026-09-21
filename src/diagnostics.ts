// Word-Smith — Diagnostics: the self-checks: the installer, the versions, the app classes, the load marks, the geometry, the notes.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { MarkdownView, Menu, Notice, Platform, apiVersion } from 'obsidian';
import type { WordSmithSettings } from './settings';
import { wsCompat, wsCompatText } from './obsidian-internals';
import { STYLE_CLASSES, STYLE_PROPS, WS_INSTALLER_REFUSE, WS_INSTALLER_REFUSE_TEXT, WS_INSTALLER_WARN, WS_INSTALLER_WARN_TEXT, WS_PLUGIN_VERSION, WS_STORM_MS, WS_STORM_PASSES, WS_STYLESHEET_VERSION, wsCatch, wsCatchSeen, wsGuardSeen, wsLastKeyboard, wsLastSheet, wsMenu, wsSheetRecord, wsErrMsg, wsUserAgent } from './preamble';
import type WordSmith from './plugin';

export const diagnosticsMethods = {

	// The `obsidian/x.y.z` token is the installer; the app version is
	// elsewhere. `ua` is a parameter for the probes.
	installerVersion(this: WordSmith, ua?: null) {
		try {
			const m = /obsidian\/(\d+\.\d+\.\d+)/.exec(String(ua != null ? ua : wsUserAgent()));
			return m ? m[1] : null;
		} catch { return null; }
	},

	// { kind: 'ok' | 'warn' | 'refuse', major, text }. The two numbers are
	// the evidence, not a taste: refused below the oldest installer nobody
	// froze in, warned below the one this build is measured in.
	installerVerdict(this: WordSmith, ver: string | null) {
		const parts = String(ver || '').split('.').map((x) => parseInt(x, 10));
		if (parts.length < 2 || parts.some((x) => !isFinite(x))) return { kind: 'ok', major: null, text: '' };
		const key = parts[0] * 1000 + parts[1];
		const major = parts[0] * 100 + parts[1];
		const fix = ' Your app is up to date; the installer is the part that never updates itself.'
			+ ' Uninstall Obsidian and install it again from obsidian.md \u2014 your vaults and settings are untouched.';
		if (key < WS_INSTALLER_REFUSE) {
			return { kind: 'refuse', major,
				text: 'Word-Smith did not start: your Obsidian installer is ' + ver
				+ ', and Obsidian freezes on enable in installers before ' + WS_INSTALLER_REFUSE_TEXT + '.' + fix };
		}
		if (key < WS_INSTALLER_WARN) {
			return { kind: 'warn', major,
				text: 'Word-Smith: your Obsidian installer is ' + ver + ', older than the ' + WS_INSTALLER_WARN_TEXT
				+ ' this version was built in. If anything lags or looks broken, that is the first thing to change.' + fix };
		}
		return { kind: 'ok', major, text: '' };
	},

	// Whether styles.css in the vault matches this build.
	//
	// Deploying means copying main.js, styles.css AND manifest.json, and
	// copying only the first is a silent, total failure of every rule the
	// stylesheet holds — which reads as "the feature does nothing" and is
	// indistinguishable from a bug in the code. It has cost this project
	// several rounds. The check runs once at layout-ready and says the one
	// thing that would have saved them.
	//
	// Read from a probe rather than from :root directly: a custom property is
	// inherited, so any element resolves it, and body is guaranteed present.
	// ── The app's own classes, checked once ──────────────────────────────────
	//
	// The docked panel borrows Obsidian's file-explorer structure so the
	// app supplies its metrics — that is what finally made it match the
	// tree, after four rounds of matching numbers by hand. The cost is a
	// dependency on class names Obsidian may rename with no notice, and the
	// failure mode is the worst kind: nothing throws, nothing is logged,
	// the panel simply looks wrong and the writer has no way to know why.
	//
	// So it is checked, once, against a REAL file explorer — the app's own,
	// not ours. If the tree does not have these either, they are gone from
	// Obsidian rather than misused by us, and the notice says which. One
	// sentence beats an afternoon.
	checkAppClasses(this: WordSmith) {
		if (this._appClassesChecked) return;
		this._appClassesChecked = true;
		let explorer = null;
		try {
			const leaves = this.app.workspace.getLeavesOfType('file-explorer') || [];
			explorer = leaves.length && leaves[0].view ? leaves[0].view.containerEl : null;
		} catch { return; }
		// No file explorer open is not a finding. It is the commonest
		// reason to see nothing here, and reporting it would train the
		// writer to ignore this notice.
		if (!explorer) return;
		// NOR IS AN EMPTY OR COLLAPSED TREE — and this is what the notice
		// got wrong. Four of the six classes are STRUCTURAL: the app
		// writes them for any file it draws at all. The other two are
		// CONDITIONAL and simply do not exist in a tree with nothing to
		// show them with — `tree-item-children` only when a folder is
		// EXPANDED, `collapse-icon` only when a collapsible folder is
		// drawn at all. A vault of loose notes, or one whose folders are
		// all shut, therefore reported "Obsidian's classes have changed"
		// truthfully-worded and completely wrong, on every single start,
		// for a panel that was fine — the exact thing this check was
		// written to avoid teaching the writer to ignore.
		//
		// So: nothing is judged until the tree has actually drawn a row
		// (before that, absence means "not rendered yet", which at
		// layout-ready is common), and a conditional class is only
		// looked for when the tree HAS the thing that would carry it.
		if (!explorer.querySelector('.tree-item')) return;
		const need = [
			'nav-files-container',
			'tree-item',
			'tree-item-self',
			'tree-item-inner'
		];
		// An expanded folder is what draws a children container; a
		// collapsible row is what draws a chevron. Obsidian marks both,
		// so their presence is asked of the app rather than assumed.
		if (explorer.querySelector('.mod-collapsible, .nav-folder')) {
			need.push('collapse-icon');
		}
		if (explorer.querySelector('.is-collapsed') === null
			&& explorer.querySelector('.nav-folder, .mod-collapsible')) {
			need.push('tree-item-children');
		}
		const missing = need.filter(c => !explorer.querySelector('.' + c));
		if (!missing.length) return;
		const what = 'Obsidian\u2019s file-explorer classes have changed ('
			+ missing.join(', ') + ')';
		console.warn('Word-Smith: ' + what
			+ ' \u2014 the docked panel borrows them, so it may look wrong until '
			+ 'the plugin is updated.');
		new Notice('Word-Smith: ' + what + '.\nThe docked panel may look wrong '
			+ 'until the plugin is updated.', 12000);
	},

	// Reads the stamp the stylesheet leaves on :root. Returns null when the
	// stylesheet is not THERE — which is not the same as being old, and the
	// difference is the whole of the bug below.
	readStylesheetVersion(this: WordSmith) {
		try {
			const raw = getComputedStyle(document.body)
				.getPropertyValue('--ws-stylesheet-version').trim();
			return raw === '' ? null : parseInt(raw, 10);
		} catch { return null; }
	},

	// ASK AGAIN BEFORE ACCUSING ANYONE. This check runs from
	// onLayoutReady, which fires SYNCHRONOUSLY when the plugin is switched
	// on from the settings page — and at that instant Obsidian has not
	// necessarily applied the plugin's stylesheet yet. The variable reads
	// as absent, the check says "styles.css looks missing", and a moment
	// later everything is fine: a writer enabling the plugin for the first
	// time was greeted with a warning about a file that was sitting right
	// there. Reported from the field, along with its twin — the bar drawn
	// in that same too-early moment came up the wrong width and only
	// righted itself on the next note (see the refresh below).
	//
	// An ABSENT stamp is therefore retried, on a few widening delays, and
	// only becomes a warning if it is still absent when the last one
	// fires. A stamp that is present but WRONG is a real stale file and
	// says so immediately — retrying that would only delay the truth.
	checkStylesheetVersion(this: WordSmith, attempt?: number) {
		const found = this.readStylesheetVersion();
		if (found === WS_STYLESHEET_VERSION) {
			// The stylesheet arrived late: whatever was drawn before it did
			// was drawn without these rules. The bar is the visible case —
			// it is laid out by CSS and was measured while there was none.
			if (attempt) this.refresh();
			return;
		}
		if (found == null) {
			const waits = [0, 120, 400, 1200];
			const next = (attempt || 0);
			if (next < waits.length) {
				window.setTimeout(() => {
					if (this.settings && this.settings.pluginEnabled) {
						this.checkStylesheetVersion(next + 1);
					}
				}, waits[next]);
				return;
			}
		}
		// Never nag twice in a session, and never at all if it is somehow
		// NEWER than the script expects — that is a half-finished upgrade in
		// the other direction and the stylesheet is not the thing at fault.
		if (this._styleWarned || (found != null && found > WS_STYLESHEET_VERSION)) return;
		this._styleWarned = true;
		const what = found == null
			? 'styles.css looks missing or out of date'
			: 'styles.css is out of date (v' + found + ', expected v' + WS_STYLESHEET_VERSION + ')';
		console.warn('Word-Smith: ' + what
			+ ' — copy main.js, styles.css AND manifest.json into '
			+ '<vault>/' + this.app.vault.configDir + '/plugins/word-smith/, then reload Obsidian.');
		new Notice('Word-Smith: ' + what + '.\nCopy styles.css into the plugin '
			+ 'folder and reload Obsidian.', 12000);
	},

	// The same courtesy for the third file. Quiet console note plus one
	// Notice, once a session, and never when the manifest is NEWER — that
	// is an upgrade in the other direction and not the manifest's fault.
	checkManifestVersion(this: WordSmith) {
		let found = null;
		try { found = this.manifest && this.manifest.version; } catch { return; }
		if (!found || found === WS_PLUGIN_VERSION) return;
		if (this._manifestWarned) return;
		this._manifestWarned = true;
		const what = 'manifest.json is out of date (says v' + found
			+ ', this build is v' + WS_PLUGIN_VERSION + ')';
		console.warn('Word-Smith: ' + what
			+ ' \u2014 copy main.js, styles.css AND manifest.json into '
			+ '<vault>/' + this.app.vault.configDir + '/plugins/word-smith/, then reload Obsidian.');
		new Notice('Word-Smith: ' + what + '.\nCopy manifest.json into the plugin '
			+ 'folder and reload Obsidian.', 12000);
	},

	// THE REPAIR: the kill switch's off-and-on, without touching the
	// switch. Every surface is torn down and drawn again from the settings
	// as they are; the lifecycle test holds the round trip to a clean
	// document and a re-decorated explorer.
	repairDisplay(this: WordSmith) {
		try { this.disablePlugin(); this.reconfigureEditors(); } catch (_) { wsCatch('repairDisplay: this.disablePlugin();', _); }
		try { this.refresh(); } catch (_) { wsCatch('repairDisplay: this.refresh();', _); }
		return true;
	},

	// Every box in a powerline row, with the colour it paints and where its
	// edges actually land — the rendered geometry of a joint, which element
	// covers which pixel, in what colour, at what fractional offset.
	// Console only: app.plugins.plugins['word-smith'].barGeometry()
	//
	// ── WHAT A REPORT SHOULD HAVE SAID IN ITS FIRST MESSAGE ─────────────
	//
	// A freeze report carries an OS and a version; what answers it is which
	// of the file-tree painters were ON and whether their explorer scrolls,
	// and the console is not where that can be asked for — a writer who
	// cannot open it after the freeze has already said so. SO IT IS A
	// COMMAND, AND IT COPIES. EVERY LINE IS A THING A REPORT HAS ACTUALLY
	// NEEDED: the capability table answers "does your build still have the
	// private methods this leans on"; the switches answer "is the painter
	// even running"; the scroll answer is the one that separates two
	// machines, because the painter's fight with the virtual scroller only
	// exists when the tree scrolls.
	//
	// ── WHERE THE LOAD TIME GOES ─────────────────────────────────────
	//
	// Enabling this plugin costs ~200ms of its own work, and nothing outside
	// can say which part: wrapping prototype methods and cycling the plugin
	// returns no samples, because enabling re-requires the module and the
	// new instance has a new prototype. The marks have to be inside. ALWAYS
	// ON, because a `performance.now()` per phase is free and the whole
	// point is that a WRITER'S dump carries it — a number that only appears
	// when a developer turns it on is a number nobody ever has when the
	// report arrives.
	loadMark(this: WordSmith, name: string) {
		try {
			if (!this._loadMarks) this._loadMarks = [];
			this._loadMarks.push([name, performance.now()]);
		} catch (_) { wsCatch('loadMark: if (!this._loadMarks) this._loadMarks = [];', _); }
	},

	// The marks as phases: each one's cost is its distance from the one
	// before, which is the question — not when it happened, but what it took.
	loadPhases(this: WordSmith) {
		const m = this._loadMarks || [];
		if (m.length < 2) return [];
		const out = [];
		for (let i = 1; i < m.length; i++) {
			out.push({ name: m[i][0], ms: Math.round((m[i][1] - m[i - 1][1]) * 10) / 10 });
		}
		out.push({ name: 'TOTAL', ms: Math.round((m[m.length - 1][1] - m[0][1]) * 10) / 10 });
		return out;
	},

	// The pane on screen, not the first in the DOM: the root with the largest
	// box. Every root is listed too, so a zero-size one is visible as such.
	geometryLines(this: WordSmith) {
		const L = [];
		const R = (el: HTMLElement | null) => { if (!el) return 'none'; const r = el.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); };
		const q = (sel: string, root?: HTMLElement) => (root || document).querySelector<HTMLElement>(sel);
		try {
			const vv = window.visualViewport;
			L.push('geometry: window ' + window.innerWidth + 'x' + window.innerHeight
				+ (vv ? ', visual ' + Math.round(vv.width) + 'x' + Math.round(vv.height) + ' at ' + Math.round(vv.offsetTop) : '')
				+ ', dpr ' + window.devicePixelRatio + ', body ' + String(document.body.className || '').split(' ').filter((c) => /^is-/.test(c)).join(' '));
			const sup = (x: string) => (typeof CSS !== 'undefined' && CSS.supports ? (CSS.supports(x) ? 'yes' : 'NO') : '?');
			L.push('  engine: container queries ' + sup('container-type: inline-size') + ', :has ' + sup('selector(:has(a))') + ', color-mix ' + sup('color: color-mix(in srgb, red, blue)'));
			const probe = document.body.createDiv({ cls: 'ws-diag-probe' });
			const pc = getComputedStyle(probe);
			L.push('  safe area t/r/b/l ' + pc.paddingTop + ' ' + pc.paddingRight + ' ' + pc.paddingBottom + ' ' + pc.paddingLeft);
			// OBSIDIAN'S OWN INSET VARIABLES, which the app sets and env() may not
			// (this Android reported env() 0 while the clock sat over the pane).
			const bs = getComputedStyle(document.body);
			L.push('  obsidian vars: safe-area-inset-top ' + bs.getPropertyValue('--safe-area-inset-top').trim() + '  view-top-spacing ' + bs.getPropertyValue('--view-top-spacing').trim() + '  view-header-height ' + bs.getPropertyValue('--view-header-height').trim());
			probe.remove();
			L.push('  chain: body ' + R(document.body) + '  app ' + R(q('.app-container')) + '  main ' + R(q('.horizontal-main-container')) + '  workspace ' + R(q('.workspace')));
			const nav = q('.mobile-navbar') || q('.mobile-toolbar') || q('.mobile-tab-switcher') || q('[class*="mobile-navbar"]') || q('[class*="navbar"]');
			L.push('  navbar ' + (nav ? nav.className + ' ' + R(nav) : 'none by any name'));
			L.push('  last sheet ' + wsLastSheet());
			L.push('  sheet test ' + (this._sheetTest || 'not run (the command runs it before the report)'));
			L.push('  last keyboard ' + wsLastKeyboard());
			L.push('  active leaf ' + R(q('.workspace-leaf.mod-active .workspace-leaf-content')) + '   its view-content ' + R(q('.workspace-leaf.mod-active .view-content')) + '   its header ' + R(q('.workspace-leaf.mod-active .view-header')));
			const roots = Array.from(document.querySelectorAll('.ws-uni-modal'));
			L.push('  pane roots ' + roots.length + ': ' + roots.map((r) => R(r) + (r.classList.contains('ws-uni-pane') ? ' pane' : ' modal') + (r.classList.contains('is-narrow') ? '/narrow' : '')).join(' | '));
			let win = null, best = 0;
			for (const r of roots) { const b = r.getBoundingClientRect(); if (b.width * b.height > best) { best = b.width * b.height; win = r; } }
			if (!win) { L.push('  no pane root has a box'); return L; }
			L.push('  on screen: window ' + R(win) + '  body ' + R(q('.ws-uni-body', win)) + '  panel ' + R(q('.ws-uni-panel', win)) + '  subject ' + R(q('.ws-uni-subject', win)) + '  zoom tag ' + R(q('.ws-uni-zoomtag', win)) + '  foot ' + R(q('.ws-uni-foot', win)));
			const panel = q('.ws-uni-panel', win);
			if (panel) { const ps = getComputedStyle(panel); L.push('  panel: container-type ' + ps.containerType + ' name ' + ps.containerName + ' width ' + ps.width + ' display ' + ps.display + ' overflow-y ' + ps.overflowY + ' scroll ' + panel.scrollHeight + '/' + panel.clientHeight + ' top ' + panel.scrollTop); }
			const ro = q('.ws-hist-readout', win);
			if (ro) {
				const cs = getComputedStyle(ro);
				L.push('  readout ' + R(ro) + ' white-space ' + cs.whiteSpace + ' display ' + cs.display + ' scroll ' + ro.scrollWidth + '/' + ro.clientWidth + ' "' + String(ro.textContent || '').slice(0, 60) + '"');
				const chain = []; let e = ro.parentElement; while (e && chain.length < 8 && !e.classList.contains('workspace-leaf-content')) { chain.push(String(e.className || e.tagName).slice(0, 34)); e = e.parentElement; }
				L.push('  readout ancestors: ' + chain.join(' < '));
				// EVERY RULE THAT REACHES IT AND SETS white-space, with the
				// @container it sits in if any — the daily strip was nowrap on the
				// phone though the sheet’s wrap rule is there.
				const hits: string[] = [];
				for (const sheet of Array.from(document.styleSheets)) {
					let rules = null; try { rules = sheet.cssRules; } catch { continue; }
					const walk = (list: CSSRuleList | CSSRule[] | null, inside: string) => { for (const r of Array.from<CSSRule & Partial<CSSStyleRule> & Partial<CSSGroupingRule> & { conditionText?: string; containerQuery?: string; media?: MediaList }>(list || [])) {
						if (r.cssRules && r.cssRules.length && /^CSS(Media|Supports|Container)Rule$/.test(String(r.constructor && r.constructor.name))) { walk(r.cssRules, (inside ? inside + ' > ' : '') + '@' + (r.conditionText || r.containerQuery || r.media && r.media.mediaText || '?')); continue; }
						if (!r.selectorText || !r.style || !r.style.whiteSpace) continue;
						let m = false; try { m = ro.matches(r.selectorText); } catch { m = false; }
						if (m) hits.push((inside ? '[' + inside + '] ' : '') + r.selectorText + ' { white-space: ' + r.style.whiteSpace + ' }');
					} };
					walk(rules, '');
				}
				L.push('  white-space rules matching the readout (' + hits.length + '): ' + hits.join(' ; '));
			}
			const cr = q('.ws-cal-read', win);
			if (cr) L.push('  cal strip ' + R(cr) + ' scroll ' + cr.scrollHeight + '/' + cr.clientHeight + '   legend ' + R(q('.ws-cal-legend', win)));
			const th = Array.from<HTMLElement>(win.querySelectorAll('.ws-org-table thead th')).map((t) => (t.getAttribute('data-col') || '?') + ':' + Math.round(t.getBoundingClientRect().width));
			if (th.length) L.push('  columns ' + th.join(' '));
			const last = Array.from<HTMLElement>(win.querySelectorAll('.ws-uni-panel > *')).pop();
			if (last) L.push('  last thing in the panel ' + String(last.className).slice(0, 30) + ' ' + R(last));
			L.push('  ua ' + wsUserAgent().replace(/^.*?\) /, '').slice(0, 120));
		} catch (e) { L.push('  (geometry could not be read: ' + wsErrMsg(e) + ')'); }
		return L;
	},

	// THE SHEET TEST: a paste cannot carry a real sheet across the restart
	// Android does when the writer switches apps, so the command draws one
	// itself — six rows through `wsMenu()`, the height of the type chooser
	// — measures it after the slide and takes it down. Marked so the timer
	// does not store it as the last REAL sheet; the report prints both.
	async sheetSelfTest(this: WordSmith) {
		this._sheetTest = 'not run';
		let m = null;
		try {
			if (!Menu) { this._sheetTest = 'no Menu in this build'; return; }
			m = wsMenu();
			if (m.dom && m.dom.dataset) m.dom.dataset.wsSelftest = '1';
			for (let i = 1; i <= 6; i++) m.addItem((it) => it.setTitle('sheet row ' + i));
			m.showAtPosition({ x: 200, y: 200 });
			await new Promise((r) => window.setTimeout(r, 350));
			const phone = !!(typeof Platform !== 'undefined' && Platform && Platform.isPhone);
			this._sheetTest = m.dom ? wsSheetRecord(m.dom, phone, false) : 'no dom';
		} catch (e) { this._sheetTest = 'threw: ' + wsErrMsg(e); }
		try { if (m && typeof m.hide === 'function') m.hide(); } catch (_) { wsCatch('sheetSelfTest: m.hide();', _); }
	},

	diagnostics(this: WordSmith) {
		const L = [];
		const yn = (v: boolean | undefined) => (v === true ? 'on' : v === false ? 'off' : String(v));
		try {
			L.push('Word-Smith ' + (this.manifest ? this.manifest.version : '?')
				+ ' diagnostics');
			// THE API VERSION, NOT THE INSTALLER'S, and the label says so: they
			// differ, and a reporter quoting one when we asked for the other is
			// a round trip. `app.appVersion` measured undefined on 1.13.7.
			L.push('Obsidian api ' + (typeof apiVersion !== 'undefined' ? apiVersion : '?')
				+ '   platform ' + (typeof Platform !== 'undefined'
					? (Platform.isMobile ? 'mobile' : 'desktop') : '?')
				// the OS from the Platform API, not the navigator
				+ '   ' + (typeof Platform === 'undefined' ? ''
					: Platform.isWin ? 'windows' : Platform.isMacOS ? 'mac' : Platform.isLinux ? 'linux'
					: Platform.isIosApp ? 'ios' : Platform.isAndroidApp ? 'android' : ''));
			// ── GEOMETRY, FOR A PHONE REPORT ─────────────────────────────────
			//
			// A phone has no console to ask. The lines come from `geometryLines`
			// below, which the command calls AFTER a pause: measured at once, the
			// workspace is the one the command palette's keyboard has shrunk, and
			// the first pane root in the DOM is a hidden one.
			for (const line of this.geometryLines()) L.push(line);
			// IN ITS OWN TRY: the one line that can throw outside Obsidian
			// (a fixture with no window) used to stop the whole report at
			// line three, and the contained list below it was never read.
			let ss = '';
			try {
				ss = getComputedStyle(document.body)
					.getPropertyValue('--ws-stylesheet-version').trim();
			} catch (_) { wsCatch('diagnostics: ss = getComputedStyle(document.body)', _); }
			L.push('stylesheet v' + (ss || '(absent)') + ', script expects v'
				+ WS_STYLESHEET_VERSION
				+ (String(WS_STYLESHEET_VERSION) === ss ? '  OK' : '  <-- STALE'));
			let notes = '?';
			try { notes = String(this.app.vault.getMarkdownFiles().length); } catch (_) { wsCatch('diagnostics: notes = String(this.app.vault.getMarkdownFiles().length);', _); }
			L.push('vault: ' + notes + ' notes');
			// THE LAST STORE COMPARE: which file, its line endings on disk, and
			// whether the plugin handed it back or rewrote it — the one line that
			// answers "why is ws-structure.md in my recent files".
			try {
				const sl = this._storeLast;
				L.push('store:      ' + (!sl ? 'no store written this session'
					: sl.path + ' — ' + sl.eol + ' on disk, last compose '
						+ (sl.same ? 'the same text, handed back unwritten' : 'a different text, written')));
			} catch { L.push('store:      (could not read the last compare)'); }
			L.push('');
			// ── THE FILE-TREE PAINTERS ──────────────────────────────────
			//
			// The one-gesture triage: if these are off and it still freezes,
			// the painter is refuted in one message.
			const s: Partial<WordSmithSettings> = this.settings || {};
			L.push('file tree:  counts ' + yn(s.enableFileTreeCounts)
				+ ' · flags ' + yn(s.fileTreeFlags)
				+ ' · tasks ' + yn(s.fileTreeTasks)
				+ ' · folder icons ' + yn(s.fileTreeFolderIcons)
				+ ' · order ' + yn(s.treeOrder));
			// DOES THE TREE SCROLL? The painter's fight with Obsidian's
			// virtual scroller only exists when it does — a small screen with
			// a big vault. This is the line that separates the two machines.
			try {
				const leaf = document.querySelector(
					'.workspace-leaf-content[data-type="file-explorer"]');
				const sc = leaf && leaf.querySelector('.nav-files-container');
				const box = sc || leaf;
				// ZERO IN ZERO IS NOT “FITS”. A collapsed sidebar measures 0/0 on
				// everything, and reporting that as a tree that fits would answer
				// the one question this line exists for — does it scroll — with a
				// confident no. Measured: with the sidebar shut, every child of
				// the leaf reads 0/0.
				const h = box ? box.clientHeight : 0;
				L.push('explorer:   ' + (!box ? 'not open'
					: !h ? 'not visible (sidebar collapsed or pane hidden)'
						: box.scrollHeight > h
							? 'SCROLLS (' + box.scrollHeight + ' in ' + h + ')'
							: 'fits (' + box.scrollHeight + ' in ' + h + ')'));
			} catch { L.push('explorer:   (could not measure)'); }
			// AND HOW HARD IT HAS BEEN WORKING. A storm disconnects the
			// observer and says so; this is the count behind that decision.
			try {
				const marks = this._passState ? this._passState.marks.length : 0;
				L.push('painter:    ' + marks + ' pass(es) in the last '
					+ (WS_STORM_MS / 1000) + 's window, budget ' + WS_STORM_PASSES
					+ (this.explorerObserver ? '' : '  <-- OBSERVER IS OFF'));
			} catch (_) { wsCatch('diagnostics: const marks = this._passState ? this._passState.marks.length : 0;', _); }
			// ── WHERE THE LOAD TIME WENT ────────────────────────────────
			//
			// Sorted by cost, not by order: a reader wants the expensive one,
			// and the order it ran in is only interesting once they have it.
			try {
				const ph = this.loadPhases();
				if (ph.length) {
					L.push('');
					L.push('load, by phase:');
					const total = ph.filter(p => p.name === 'TOTAL')[0];
					const rest = ph.filter(p => p.name !== 'TOTAL')
						.sort((a, b) => b.ms - a.ms);
					for (const p of rest) {
						L.push('  ' + (p.ms + 'ms').padStart(8) + '  ' + p.name);
					}
					if (total) L.push('  ' + (total.ms + 'ms').padStart(8) + '  TOTAL');
				}
			} catch (_) { wsCatch('diagnostics: const ph = this.loadPhases();', _); }
			L.push('');
			// ── WHAT THIS BUILD OF OBSIDIAN STILL OFFERS ────────────────
			try {
				const rep = wsCompat(this.app);
				L.push('Obsidian internals this plugin leans on:');
				L.push(wsCompatText(rep));
			} catch { L.push('(the capability table could not be built)'); }
			// ── WHAT WAS CONTAINED THIS SESSION ─────────────────────────
			//
			// The named catches, once per site with a count and the last message,
			// and the guard's sites. The first thing a report needs and the one
			// thing a reporter without a console cannot see.
			try {
				const seen = wsCatchSeen();
				const guarded = wsGuardSeen();
				L.push('');
				L.push('contained this session: ' + seen.length + ' catch site'
					+ (seen.length === 1 ? '' : 's') + ', ' + guarded.length + ' guard site'
					+ (guarded.length === 1 ? '' : 's'));
				for (const g of guarded) L.push('  guard: ' + g);
				for (const c of seen.slice(0, 40)) {
					L.push('  ' + c.where + '  x' + c.n + (c.last ? '  ' + c.last : ''));
				}
				if (seen.length > 40) L.push('  … and ' + (seen.length - 40) + ' more');
			} catch { L.push('(the contained list could not be read)'); }
		} catch (e) {
			L.push('diagnostics stopped early: ' + wsErrMsg(e));
		}
		return L.join('\n');
	},

	// Everything the bottom-inset rules read, as it actually resolved.
	//
	// No longer a palette command — it was one while the zen padding bug was
	// being chased and is clutter now that the feature is gone. Kept because
	// it is the tool that finally answered a question three rounds of
	// reasoning could not, and it costs nothing sitting here. Call it from
	// the developer console when a geometry report is needed:
	//
	//   app.plugins.plugins['word-smith'].layoutDiagnostic()
	//
	// Deliberately reports the CHAIN — pane, editor, scroller — rather than
	// just the element a rule targets: the failure both previous attempts hit
	// was a rule applying correctly to a box that turned out not to be the one
	// constraining the editor's height. That only shows up when the boxes are
	// compared against each other.
	layoutDiagnostic(this: WordSmith) {
		const L = [];
		const px = (n: number) => (n == null ? '?' : Math.round(n * 10) / 10 + 'px');
		try {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return 'Word-Smith: no markdown view is active.';
			const pane     = view.contentEl.querySelector('.markdown-source-view')
				|| view.contentEl.querySelector('.markdown-reading-view');
			const editor   = view.contentEl.querySelector('.cm-editor');
			const scroller = view.contentEl.querySelector('.cm-scroller');
			const leaf     = pane && pane.closest ? pane.closest('.workspace-leaf') : null;
			const bar      = this.retroStatusBarEl;

			L.push('Word-Smith ' + (this.manifest ? this.manifest.version : '?') + ' layout diagnostic');
			// First line after the header, because it invalidates everything
			// below it: with a stale stylesheet the rules simply are not
			// loaded, and every computed inset here will read 0 for that
			// reason rather than for any reason worth debugging.
			const ss = getComputedStyle(document.body)
				.getPropertyValue('--ws-stylesheet-version').trim();
			L.push('styles.css: v' + (ss || '(absent)')
				+ ' — script expects v' + WS_STYLESHEET_VERSION
				+ (String(WS_STYLESHEET_VERSION) === ss ? '  OK' : '  <-- STALE, fix this first'));
			L.push('body: ' + Array.from(document.body.classList)
				.filter(c => /^(ws-|zenmode|theme-)/.test(c)).join(' '));
			L.push('leaf: ' + (leaf ? Array.from(leaf.classList).join(' ') : '(none)'));
			L.push('pane: ' + (pane ? pane.className : '(none)'));

			const rootStyle = getComputedStyle(document.documentElement);
			for (const v of ['--ws-bar-reserve',
				'--ws-status-bar-height', '--ws-vim-gutter']) {
				L.push('  ' + v + ' = ' + (rootStyle.getPropertyValue(v).trim() || '(unset)'));
			}
			L.push('  zenActive = ' + this.zenActive()
				+ ', barIsHidden = ' + this.barIsHidden());

			const box = (name: string, el: HTMLElement | null) => {
				if (!el) { L.push(name + ': (none)'); return; }
				const cs = getComputedStyle(el);
				const r  = el.getBoundingClientRect();
				L.push(name + ':');
				L.push('  rect      top ' + px(r.top) + '  bottom ' + px(r.bottom)
					+ '  height ' + px(r.height));
				L.push('  padding-bottom ' + cs.paddingBottom
					+ '   margin-bottom ' + cs.marginBottom);
				L.push('  min-height ' + cs.minHeight
					+ '  height ' + cs.height + '  box-sizing ' + cs.boxSizing
					+ '  position ' + cs.position
					+ '  display ' + cs.display
					+ (cs.display.includes('flex') ? ' (' + cs.flexDirection + ')' : '')
					+ '  flex ' + cs.flex + '  overflow-y ' + cs.overflowY);
			};
			box('pane', pane);
			box('.cm-editor', editor);
			box('.cm-scroller', scroller);

			if (bar) {
				const r = bar.getBoundingClientRect();
				L.push('bar: top ' + px(r.top) + '  height ' + px(r.height));
			} else {
				L.push('bar: (not present)');
			}
			// The settings' half of the stylesheet, as it stands on body: which
			// of the classes and properties applyStyleProps owns are set.
			L.push('style props: ' + STYLE_CLASSES.filter((c) => document.body.classList.contains(c)).join(' ')
				+ ' | ' + STYLE_PROPS.filter((p) => document.body.style.getPropertyValue(p)).length + ' of ' + STYLE_PROPS.length + ' properties set');
			L.push('caretFloorY = ' + px(this.caretFloorY())
				+ '   viewport height = ' + px(window.innerHeight));

			// The question both failed fixes were really asking. If this is
			// positive the editor still reaches under the bar, whatever the
			// stylesheet says, and no CSS inset on an ancestor is reaching it.
			if (scroller) {
				const over = scroller.getBoundingClientRect().bottom - this.caretFloorY();
				L.push('scroller reaches ' + px(over) + ' PAST the caret floor'
					+ (over > 1 ? '  <-- the inset is not shortening the editor'
						: '  <-- the editor stops clear, as intended'));
			}
		} catch (e) {
			L.push('threw: ' + wsErrMsg(e));
		}
		return L.join('\n');
	},
};
export type DiagnosticsMethods = typeof diagnosticsMethods;
