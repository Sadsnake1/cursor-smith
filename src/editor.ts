// Word-Smith — Editor: the editor’s own extensions: typography, Hemingway, the Vim motion maps.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import type { EditorView, KeyBinding } from '@codemirror/view';
import type { TransactionSpec } from '@codemirror/state';
import { wsEditorExtensions } from './editor-extensions';
import { WS_INTERNALS } from './obsidian-internals';
import { CM, TYPO_MAX_LOOKBACK, TYPO_OPENS_AFTER, TYPO_RULES, wsCatch, wsBag, wsVimOf } from './preamble';
import type WordSmith from './plugin';

export const editorMethods = {

	// Swaps the registered extension array's contents for freshly built
	// plugin instances, then reconfigures every open editor. Both halves are
	// required: updateOptions() alone with the same extension values is a
	// no-op (CM6 keeps the old instances), and swapping without
	// updateOptions() never reaches the editors. With the plugin disabled
	// the array is emptied, which fully removes the decorations.
	reconfigureEditors(this: WordSmith) {
		if (CM && this.editorExtensions) {
			this.editorExtensions.length = 0;
			this.editorExtensions.push(...this.buildEditorExtensions());
		}
		try { this.app.workspace.updateOptions(); } catch (_) { wsCatch('reconfigureEditors: this.app.workspace.updateOptions();', _); }
	},

	// ─────────────────────────────────────────────────────────────────────────
	// CM6 editor extensions: focus dimming + hidden markers
	// ─────────────────────────────────────────────────────────────────────────
	// Both features are implemented as CodeMirror decorations so they render
	// inside the editor's own pipeline — recomputed atomically with every
	// transaction, never racing CM6's DOM reconciliation the way the earlier
	// MutationObserver approach did (which is what caused the flicker).
	// The extensions read this.settings at build time, so they self-disable
	// when toggled off; refresh() calls workspace.updateOptions() to force a
	// rebuild whenever settings change.
	//
	// "Sentence" dim mode is approximated as the current line: decorations
	// could technically split a line into per-sentence marks, but Obsidian's
	// live-preview widgets (checkboxes, embeds, rendered links) sit inside
	// lines at unpredictable offsets, so line granularity is what's reliable.

	// ════════════════════════════════════════════════════════════════════════
	// CODEMIRROR EXTENSIONS
	// ════════════════════════════════════════════════════════════════════════

	setupEditorExtensions(this: WordSmith) {
		if (!CM) return; // @codemirror modules unavailable — features off
		// A mutable array is registered ONCE; reconfigureEditors() then swaps
		// its contents and calls workspace.updateOptions(), which is the
		// standard Obsidian pattern for dynamic editor extensions.
		this.editorExtensions = [];
		this.editorExtensions.push(...this.buildEditorExtensions());
		this.registerEditorExtension(this.editorExtensions);
	},

	// Factory that creates FRESH ViewPlugin values each call. This matters:
	// workspace.updateOptions() with unchanged extension values is a no-op —
	// CM6 keeps the existing plugin instances and never re-runs their
	// constructors — so settings toggles silently did nothing until some
	// unrelated edit/scroll happened to trigger an update(). Recreating the
	// plugins forces real reconfiguration and an immediate rebuild.
	buildEditorExtensions(this: WordSmith) {
		if (!CM || !this.settings.pluginEnabled) return [];
		// The body is wsEditorExtensions (src/04-editor-extensions.js): a
		// factory handed the plugin, since its inner classes have a `this` of
		// their own.
		return wsEditorExtensions(this, CM);
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Hemingway mode — write forward only
	//
	// Two layers, deliberately. The keymap at highest precedence is the
	// primary: it sits above CodeMirror's own bindings and above Obsidian's,
	// so Backspace and Mod-z never reach the commands behind them. The DOM
	// handlers are the backstop, because a keymap only sees keystrokes — it
	// cannot see the Edit menu, a right-click Cut, an IME deletion, or a
	// mobile keyboard's delete, all of which arrive as beforeinput instead.
	// Blocking only the keys would leave those routes wide open.
	// ─────────────────────────────────────────────────────────────────────────

	// ─────────────────────────────────────────────────────────────────────────
	// Smart typography
	//
	// A CodeMirror input handler rather than a decoration: this rewrites the
	// document, so what gets exported, synced and read elsewhere is the real
	// character. The substitution is one transaction, so a single undo puts
	// back exactly what was typed.
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// TYPOGRAPHY
	// ════════════════════════════════════════════════════════════════════════

	buildTypographyExtension(this: WordSmith) {
		if (!CM || !CM.EditorView || !this.settings.typographyEnabled) return [];

		// Prec.highest matters here. Obsidian's own "auto pair brackets" is an
		// input handler too, and it claims the quote keys — at default
		// precedence it ran first and inserted a straight pair, so curly
		// quotes never fired.
		const handler = CM.EditorView.inputHandler.of((view, from, to, text) => {
			if (text.length !== 1) return false;                 // paste, IME, multi-char
			const s = this.settings;
			if (!s.pluginEnabled || !this.isEditorInScope(view)) return false;

			const doc  = view.state.doc;
			const line = doc.lineAt(from);
			// Never rewrite inside code, math or frontmatter. The line scan
			// handles blocks; the backtick parity handles inline spans.
			if (this.getNonProseLines(doc).has(line.number)) return false;
			const before = doc.sliceString(line.from, from);
			if ((before.match(/`/g) || []).length % 2 === 1) return false;
			if ((before.match(/\$/g) || []).length % 2 === 1) return false;

			const groupOn: Record<string, boolean> = {
				ellipsis:    s.typoEllipsis,
				dashes:      s.typoDashes,
				arrows:      s.typoArrows,
				guillemets:  s.typoGuillemets,
				comparisons: s.typoComparisons,
				fractions:   s.typoFractions
			};

			const lookback = doc.sliceString(Math.max(line.from, from - TYPO_MAX_LOOKBACK), from);

			for (const rule of TYPO_RULES) {
				if (!groupOn[rule.group]) continue;
				if (rule.text.charAt(rule.text.length - 1) !== text) continue;
				const prefix = rule.text.slice(0, -1);
				if (!lookback.endsWith(prefix)) continue;
				if (rule.notAfter) {
					const preceding = lookback.charAt(lookback.length - prefix.length - 1);
					if (preceding && rule.notAfter.test(preceding)) continue;
				}
				this.applyTypography(view, from, to, text, rule.text, rule.insert);
				return true;
			}

			if (s.typoSmartQuotes && (text === '"' || text === "'")) {
				const prev  = lookback.charAt(lookback.length - 1);
				// TYPE OVER THE CLOSER THAT IS ALREADY THERE. Without this,
				// finishing a quotation the pair had already closed left
				// two closers — the feature's own output fighting the
				// writer's habit of typing the second mark. If the caret is
				// sitting directly in front of the very glyph being typed,
				// the keystroke moves past it instead of inserting.
				// Checked before anything else, because it is the one case
				// where the right answer is to add nothing at all.
				if (from === to) {
					const ahead = doc.sliceString(from, from + 1);
					const cust  = s.typoCustomQuotes;
					const at    = (k: string, f: string) => {
						const v = cust ? wsBag(s)[k] : '';
						return (typeof v === 'string' && v.length) ? v : f;
					};
					const closer = text === '"'
						? at('typoCloseDouble', '\u201d')
						: at('typoCloseSingle', '\u2019');
					if (ahead && ahead === closer) {
						view.dispatch({
							selection: { anchor: from + 1 },
							userEvent: 'select.typography'
						});
						return true;
					}
				}
				const opens = prev === '' || TYPO_OPENS_AFTER.test(prev);
				const custom = s.typoCustomQuotes;
				const pick = (key: string, fallback: string) => {
					const v = custom ? wsBag(s)[key] : '';
					return (typeof v === 'string' && v.length) ? v : fallback;
				};
				// After a letter, a single quote is either an apostrophe or the
				// end of a quotation, and the character alone cannot say which:
				// don't and 'b' look identical at the cursor. So look back for
				// an opening quote that has not been closed yet.
				const openCh  = pick('typoOpenSingle', '\u2018');
				const closeCh = pick('typoCloseSingle', '\u2019');
				const opens_  = before.split(openCh).length - 1;
				const closes_ = openCh === closeCh ? 0 : before.split(closeCh).length - 1;
				const inQuote = opens_ > closes_;
				const midWord = /[\p{L}\p{N}]/u.test(prev) && !inQuote;
				const glyph = text === '"'
					? (opens ? pick('typoOpenDouble', '\u201c') : pick('typoCloseDouble', '\u201d'))
					: (opens ? openCh : midWord ? pick('typoApostrophe', '\u2019') : closeCh);
				// IN PAIRS. An opening double quote brings its closer with
				// it and leaves the caret between them, so the pair is
				// balanced from the moment it exists and nobody has to
				// remember the second one — which is the whole reason a
				// straight quote ever survives into a finished draft.
				//
				// SINGLES PAIR TOO, by request. The reservation stands and is
				// worth keeping written down: a single quote at the start
				// of a word is as likely to be an apostrophe as an opening
				// — `'twas`, `'em`, `'90s` — and no rule reading one
				// character can tell those from the start of a quotation.
				// What makes it bearable is the pair being cheap to undo:
				// Backspace takes both halves (see applyTypography), and
				// typing the closer yourself steps over the one already
				// there rather than adding a second (see the type-over
				// above). An unwanted closer costs one keystroke.
				//
				// Closing quotes still never pair: a closer that brought
				// another closer would be the feature working against
				// itself.
				let tail = '';
				if (opens) {
					tail = text === '"'
						? pick('typoCloseDouble', '\u201d')
						: closeCh;
				}
				this.applyTypography(view, from, to, text, text, glyph, tail);
				return true;
			}
			return false;
		});
		return [CM.Prec ? CM.Prec.highest(handler) : handler];
	},

	// Two transactions, not one. A single transaction that swapped "--" for an
	// en dash undid straight *past* the literal characters, because the state
	// it restored never contained the second dash — the input handler had
	// suppressed it. So the sequence is: insert exactly what was typed, then
	// replace it as a separate, history-isolated step. One undo now lands on
	// the characters, which is what "undo" is expected to mean here.
	// `tail` is text inserted AFTER the caret and left there — the closing
	// half of a pair. Everything else about the call is unchanged, so the
	// rules that do not pair pass nothing and behave exactly as before.
	applyTypography(this: WordSmith, view: EditorView, from: number, to: number, typed: string, matched: string, glyph: string, tail?: string) {
		const after = typeof tail === 'string' ? tail : '';
		view.dispatch({
			changes: { from, to, insert: typed },
			selection: { anchor: from + typed.length },
			userEvent: 'input.type'
		});

		const end   = from + typed.length;
		const start = end - matched.length;
		const spec: TransactionSpec = {
			changes: { from: start, to: end, insert: glyph + after },
			// Setting the cursor explicitly keeps it off the end of a glyph
			// that is shorter than the text it replaced — and, when a pair
			// was inserted, puts it BETWEEN the two halves rather than past
			// the closer, which is the point of inserting them together.
			selection: { anchor: start + glyph.length },
			userEvent: 'input.typography'
		};
		if (CM && CM.isolateHistory) spec.annotations = CM.isolateHistory.of('before');
		view.dispatch(spec);

		// Remembered so Backspace can undo it too — that is the key people
		// actually reach for, and it is what the reference plugin does.
		// The revert span covers BOTH halves: backspacing a pair you did not
		// want should take the closer with it, not strand it after the
		// caret for you to find later.
		this._lastTypo = {
			from: start,
			to: start + glyph.length + after.length,
			// WHERE THE CARET ACTUALLY IS, which for a pair is between the
			// halves rather than past them. The revert below checks the
			// caret against this, not against the end of the span — with a
			// pair those are different positions, and comparing against the
			// end would have quietly switched backspace-to-revert off for
			// exactly the substitution most likely to be unwanted.
			caret: start + glyph.length,
			glyph: glyph + after,
			original: matched,
			time: Date.now()
		};
	},

	// Backspace immediately after a substitution puts the typed characters
	// back rather than deleting the glyph. Guarded on the text still being
	// exactly what was inserted, the cursor still sitting after it, and the
	// substitution being recent — otherwise Backspace behaves normally.
	buildTypographyRevertKeymap(this: WordSmith) {
		if (!CM || !CM.keymap || !this.settings.typographyEnabled) return [];
		const km = CM.keymap.of([{ key: 'Backspace', run: (view) => {
			const t = this._lastTypo;
			if (!t || Date.now() - t.time > 5000) return false;
			if (!this.isEditorInScope(view)) return false;
			const sel = view.state.selection.main;
			if (!sel.empty || sel.from !== (t.caret != null ? t.caret : t.to)) return false;
			if (view.state.doc.sliceString(t.from, t.to) !== t.glyph) return false;
			view.dispatch({
				changes: { from: t.from, to: t.to, insert: t.original },
				selection: { anchor: t.from + t.original.length },
				userEvent: 'delete.typography'
			});
			this._lastTypo = null;
			return true;
		} }]);
		return [CM.Prec ? CM.Prec.highest(km) : km];
	},

	// ════════════════════════════════════════════════════════════════════════
	// HEMINGWAY LOCK
	// ════════════════════════════════════════════════════════════════════════

	buildHemingwayExtensions(this: WordSmith) {
		if (!CM || !CM.keymap || !this.settings.hemingwayEnabled) return [];
		const { keymap, EditorView, Prec } = CM;

		// Returning false means "not handled", so the keystroke falls through
		// to normal editing — which is exactly what an out-of-scope note wants.
		// `what` is the word the once-a-session line names: "paste",
		// "backspace", "the arrow keys". The flash says no; the line says
		// what and where.
		const blocked = (view: EditorView, what: string) => {
			if (view && !this.isEditorInScope(view)) return false;
			this.flashHemingway();
			this.hemingwaySay(what);
			return true;   // handled → CodeMirror calls preventDefault for us
		};
		const keyWhat = (key: string) => {
			if (/Backspace|Ctrl-h/.test(key)) return 'backspace';
			if (/Delete|Ctrl-d/.test(key) && !/Shift-Delete/.test(key)) return 'delete';
			if (/Mod-z|Mod-y/.test(key)) return 'undo';
			if (/Mod-x|Shift-Delete/.test(key)) return 'cut';
			if (/Mod-v|Mod-Shift-v/.test(key)) return 'paste';
			if (/Mod-a/.test(key)) return 'select all';
			if (/Arrow/.test(key)) return 'the arrow keys';
			if (/Home|End|Page/.test(key)) return 'the jump keys';
			return 'that key';
		};
		const locked = (view: EditorView) => this.isEditorInScope(view);

		// Collected in a Set because several keys belong to more than one lock
		// (Shift-Delete is both a delete and the legacy cut), and a duplicate
		// binding would just make CodeMirror try the same blocker twice.
		const keys = new Set<string>();
		const addKeys = (...ks: string[]) => ks.forEach(k => keys.add(k));
		const c = this.settings;

		if (c.hemBlockBackspace) addKeys('Backspace', 'Shift-Backspace', 'Mod-Backspace', 'Alt-Backspace', 'Ctrl-h');
		if (c.hemBlockDelete)    addKeys('Delete', 'Mod-Delete', 'Alt-Delete', 'Ctrl-d');
		if (c.hemBlockUndo)      addKeys('Mod-z', 'Mod-Shift-z', 'Mod-y');
		if (c.hemBlockCut)       addKeys('Mod-x', 'Shift-Delete');
		if (c.hemBlockPaste)     addKeys('Mod-v', 'Mod-Shift-v');
		if (c.hemBlockSelectAll) addKeys('Mod-a');
		if (c.hemBlockArrows) {
			for (const dir of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
				addKeys(dir, 'Shift-' + dir, 'Mod-' + dir, 'Alt-' + dir,
					'Mod-Shift-' + dir, 'Alt-Shift-' + dir);
			}
		}
		if (c.hemBlockJumpKeys) {
			for (const k of ['Home', 'End', 'PageUp', 'PageDown']) {
				addKeys(k, 'Shift-' + k, 'Mod-' + k, 'Mod-Shift-' + k);
			}
		}

		const binds: KeyBinding[] = [];
		keys.forEach(key => binds.push({ key, run: (view: EditorView) => blocked(view, keyWhat(key)), preventDefault: true }));

		const handlers = EditorView ? EditorView.domEventHandlers({
			// inputType is the honest signal: it names the *edit* rather than
			// the keystroke, so it catches menu actions, IME and mobile alike.
			beforeinput: (e, view) => {
				if (!locked(view)) return false;
				const t = (e && e.inputType) || '';
				const k = this.settings;
				if (k.hemBlockBackspace && /^delete(ContentBackward|WordBackward|SoftLineBackward|HardLineBackward)$/.test(t)) return blocked(view, 'backspace');
				if (k.hemBlockDelete    && /^delete(ContentForward|WordForward|SoftLineForward|HardLineForward)$/.test(t))   return blocked(view, 'delete');
				if (k.hemBlockBackspace && t === 'deleteContent') return blocked(view, 'backspace');
				if (k.hemBlockUndo      && (t === 'historyUndo' || t === 'historyRedo')) return blocked(view, 'undo');
				if (k.hemBlockCut       && t === 'deleteByCut')   return blocked(view, 'cut');
				if (k.hemBlockPaste     && /^insertFromPaste/.test(t)) return blocked(view, 'paste');
				if (k.hemBlockMouse     && t === 'deleteByDrag')  return blocked(view, 'dragging text');
				// Typing over a selection is a deletion wearing a different
				// inputType. Without this, select-all-then-type still wipes the
				// note even with every delete key locked.
				if (k.hemBlockBackspace && /^insert/.test(t)) {
					try {
						if (view && !view.state.selection.main.empty) return blocked(view, 'typing over a selection');
					} catch { /* older CM state shape — fall through */ }
				}
				return false;
			},
			cut: (e, view) => { return this.settings.hemBlockCut   ? blocked(view, 'cut') : false; },
			paste: (e, view) => { return this.settings.hemBlockPaste ? blocked(view, 'paste') : false; },
			mousedown: (e, view) => {
				if (!this.settings.hemBlockMouse || !locked(view)) return false;
				// Swallowing mousedown outright would also swallow the click
				// that focuses the editor, leaving no way back in after
				// visiting another pane. Focus explicitly instead — CodeMirror
				// restores the existing selection rather than moving the caret.
				if (!view.hasFocus) { view.focus(); return true; }
				return blocked(view, 'the mouse');
			},
			contextmenu: (e, view) => { return this.settings.hemBlockMouse ? blocked(view, 'the mouse') : false; },
			dragstart: (e, view) => { return this.settings.hemBlockMouse ? blocked(view, 'the mouse') : false; },
			drop: (e, view) => { return this.settings.hemBlockMouse ? blocked(view, 'the mouse') : false; }
		}) : null;

		const exts = [];
		const km = keymap.of(binds);
		exts.push(Prec ? Prec.highest(km) : km);
		if (handlers) exts.push(Prec ? Prec.highest(handlers) : handlers);
		return exts;
	},

	// Feedback for a blocked key. A screen flash has to sit above the
	// letterbox masks or it simply does not appear in the one mode most
	// likely to be running alongside Hemingway.
	flashHemingway(this: WordSmith) {
		const target = this.settings.hemFlashTarget || 'screen';
		if (target === 'none') return;
		if (target === 'icon')                          this.flashHemingwayIcon();
		if (target === 'screen'   || target === 'both') this.flashHemingwayScreen();
		if (target === 'retrobar' || target === 'both') this.flashHemingwayBar();
	},

	// The quietest of the three: the Modes button reddens. If {mode} is not
	// in the bar there is nothing to flash, and nothing flashes.
	flashHemingwayIcon(this: WordSmith) {
		const el = document.querySelector('.ws-barbtn-modes');
		if (!el) return;
		el.classList.remove('ws-hem-blocked');
		void el.offsetWidth;   // reflow, so held keys restart the flash
		el.classList.add('ws-hem-blocked');
		if (this._hemIconTimer) window.clearTimeout(this._hemIconTimer);
		this._hemIconTimer = window.setTimeout(() => {
			const badge = document.querySelector('.ws-barbtn-modes.ws-hem-blocked');
			if (badge) badge.classList.remove('ws-hem-blocked');
			this._hemIconTimer = null;
		}, 500);
	},

	flashHemingwayScreen(this: WordSmith) {
		let el = this._hemScreenEl;
		if (!el || !el.isConnected) {
			el = createDiv();
			el.className = 'ws-hem-screen';
			document.body.appendChild(el);
			this._hemScreenEl = el;
		}
		el.classList.remove('is-on');
		void el.offsetWidth;   // reflow, so held keys restart the animation
		el.classList.add('is-on');
		if (this._hemScreenTimer) window.clearTimeout(this._hemScreenTimer);
		this._hemScreenTimer = window.setTimeout(() => {
			// Removed, not just hidden. A full-window fixed element left in
			// the DOM keeps swallowing -webkit-app-region hit tests, which
			// ignore both opacity and pointer-events — so one blocked key
			// would cost you window dragging for the rest of the session.
			if (this._hemScreenEl) { this._hemScreenEl.remove(); this._hemScreenEl = null; }
			this._hemScreenTimer = null;
		}, 500);
	},

	flashHemingwayBar(this: WordSmith) {
		const el = this.retroStatusBarEl;
		if (!el) return;
		el.classList.remove('ws-hem-blocked');
		void el.offsetWidth;
		el.classList.add('ws-hem-blocked');
		if (this._hemFlashTimer) window.clearTimeout(this._hemFlashTimer);
		this._hemFlashTimer = window.setTimeout(() => {
			if (this.retroStatusBarEl) this.retroStatusBarEl.classList.remove('ws-hem-blocked');
			this._hemFlashTimer = null;
		}, 500);
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Word count: file tree + outline
	// ─────────────────────────────────────────────────────────────────────────

	// ═══════════════════════════════════════════════════════════════════════════
	// VIM SUPPORT: motion mapping
	// ═══════════════════════════════════════════════════════════════════════════

	// Obsidian's vim mode is CodeMirror's own. Which object it hangs off has
	// moved between versions, so every known route is tried rather than
	// betting on one and failing silently.
	vimApi(this: WordSmith) {
		const routes = [
			// NOT ON A PHONE: Obsidian's mobile `require` shows a notice
			// ("attempted to load NodeJS package") before it throws, and this
			// runs on every leaf change. The three routes below are the ones
			// mobile ever had.
			() => (this.isMobileApp() || !window.require) ? null : window.require('@replit/codemirror-vim').Vim,
			() => window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim,
			() => window.CodeMirror && window.CodeMirror.Vim,
			() => this.app.workspace.activeEditor
				&& this.app.workspace.activeEditor.editor
				&& this.app.workspace.activeEditor.editor.cm
				&& this.app.workspace.activeEditor.editor.cm.cm
				&& this.app.workspace.activeEditor.editor.cm.cm.constructor?.Vim
		];
		for (const get of routes) {
			try {
				const Vim = wsVimOf(get());
				if (Vim) return Vim;
			} catch { /* route not available in this build */ }
		}
		return null;
	},

	// Normal and visual both: mapping only normal leaves v-j jumping over
	// wrapped lines, which is more confusing than not mapping at all.
	//
	// Mapping is re-applied every time rather than guarded on a flag. It is
	// idempotent, and Obsidian rebuilds its vim state when the editor is
	// recreated — a leaf change, a vault reload, toggling vim mode off and on
	// — each of which drops whatever we set. Applying once and remembering we
	// had was why this appeared to do nothing.
	applyVimMotionMaps(this: WordSmith) {
		const Vim = this.vimApi();
		if (!Vim) return false;
		const want = !!(this.settings.pluginEnabled && this.settings.vimSoftWrapMotion);
		const PAIRS = [['j', 'gj'], ['k', 'gk'], ['0', 'g0'], ['$', 'g$']];
		try {
			if (want) {
				for (const [from, to] of PAIRS) {
					Vim.map(from, to, 'normal');
					Vim.map(from, to, 'visual');
				}
				this._vimMapped = true;
			} else if (this._vimMapped) {
				// Only ever released if we installed it. Unmapping a key we
				// never claimed would tear out a binding the user set through
				// a vimrc plugin.
				for (const [from] of PAIRS) {
					Vim.unmap(from, 'normal');
					Vim.unmap(from, 'visual');
				}
				this._vimMapped = false;
			}
		} catch { return false; }
		return true;
	},

	// The adapter does not exist until vim mode has started, which can be well
	// after onload. Retry briefly rather than silently doing nothing.
	scheduleVimMotionMaps(this: WordSmith, tries?: number) {
		if (this.applyVimMotionMaps()) return;
		const left = (tries == null ? 20 : tries) - 1;
		if (left <= 0) return;
		window.setTimeout(() => this.scheduleVimMotionMaps(left), 250);
	},

	// ── ONE CONTROL FOR ONE QUESTION ────────────────────────────────────────
	//
	// Obsidian's file explorer has a sort button, and it has answered "what
	// order is this tree in?" since long before this plugin existed. Adding a
	// second answer in a settings tab left that button DEAD: with an order
	// stored for a folder, every row is ours and their menu changes nothing —
	// it still opens, still says "File name (A to Z)", and does nothing at
	// all. A control that has stopped working is worse than a missing one,
	// and worse again when it is somebody else's control and they will be
	// blamed for it.
	//
	// So manuscript order joins THAT menu as one of its options, and picking
	// any other option turns it off. The settings switch stays, because it is
	// where the setting lives and because a writer looking for a feature
	// looks there — but it is now the same switch, in two places, rather than
	// two switches.
	//
	// A SECOND PRIVATE PATCH, and the same discipline as the first: if the
	// method is not there, the entry is simply absent and everything else
	// goes on working. Nothing here may throw into Obsidian's menu.
	// ONE WRITER OF WHAT IS MISSING. Three
	// sites each carried a once-flag and a sentence of their own about an
	// internal the explorer did not offer — three copies of what WS_INTERNALS
	// already says under `what` and `without`, and the diagnostics dump read
	// a `caps` nobody had told. This says the table's sentence, once per id,
	// as what was observed, blaming nobody — and marks the
	// capability false so the dump and the console agree.
	capMissing(this: WordSmith, id: string) {
		const item = WS_INTERNALS.filter((i) => i.id === id)[0];
		if (!item) return false;
		if (!this.caps || typeof this.caps !== 'object') this.caps = {};
		this.caps[id] = false;
		this._capSaid = this._capSaid || {};
		if (this._capSaid[id]) return true;
		this._capSaid[id] = true;
		try {
			console.warn('Word-Smith: ' + item.where + ' did not offer ' + item.what
				+ ', so ' + item.without);
		} catch (_) { wsCatch('capMissing: console.warn(\'Word-Smith: \' + item.where + \' did not offer \' + …', _); }
		return true;
	},
};
export type EditorMethods = typeof editorMethods;
