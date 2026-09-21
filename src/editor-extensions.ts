// Word-Smith — editor-extensions.

import {
	CM,
	FILLER_PHRASES,
	FILLER_SOFT,
	FILLER_STRONG,
	findDialogue,
	findIllusions,
	findMisused,
	findPassive,
	findRepetitions,
	isVaguePronoun,
	maskMarkup,
	posBucket,
	scanNonProseLines,
	sentenceGrade,
	splitSentences,
	tagTokens,
	tokenizeLine,
	wsCatch,
} from './preamble';
import type { WsToken } from './preamble';
import type { Decoration, DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import type WordSmith from './plugin';

// what the tildes' measure phase hands its write phase: nothing, a hide, or
// where the rows are and what face they wear
type TildeMeasure = null | { hide: true } | { hide?: false; top: number; left: number; lineH: number; font: string; size: string; weight: string; count: number };

// ── THE EDITOR EXTENSIONS, AS A FACTORY ────────────────────────────────
//
// This was the body of `buildEditorExtensions()`, which opened with
// `const plugin = this` because eight CodeMirror ViewPlugin classes inside
// it read the plugin from their own methods, where `this` is the plugin
// instance CodeMirror made. The review's rule (no-this-alias) is right that
// an alias is a smell in a method; the honest shape is a factory that is
// HANDED the plugin — the same shape as the Organizer's `03-organizer-*`
// modules — and the method is its guard and one call. The body is
// unchanged but for the three `this.build…()` at its end, which read
// `plugin.` now. A helper lives below 05, outside the class.
export function wsEditorExtensions(plugin: WordSmith, cm: NonNullable<typeof CM>) {
	const { ViewPlugin, Decoration, WidgetType, RangeSetBuilder } = cm;

	class InvisibleWidget extends WidgetType {
		text: string;
		constructor(text: string) { super(); this.text = text; }
		eq(other: InvisibleWidget) { return other.text === this.text; }
		toDOM() {
			const s = createSpan();
			s.className = 'ws-invisible';
			s.textContent = this.text;
			return s;
		}
		ignoreEvent() { return true; }
	}
	const PILCROW  = Decoration.widget({ widget: new InvisibleWidget('¶'), side: 1 });
	const NEWLINE  = Decoration.widget({ widget: new InvisibleWidget('↵'), side: 1 });
	const dimDeco   = Decoration.line({ class: 'ws-dim-line' });
	const dimText   = Decoration.mark({ class: 'ws-dim-text' });
	const spaceDeco = Decoration.mark({ class: 'ws-ws-space' });
	const tabDeco   = Decoration.mark({ class: 'ws-ws-tab' });

	// ── Focus dimming ─────────────────────────────────────────────────────
	const dimPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = this.build(view); }
		update(u: ViewUpdate) {
			if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) {
				this.decorations = this.build(u.view);
			}
		}
		build(view: EditorView) {
			const s = plugin.settings;
			if (!s.pluginEnabled || !s.enableTypewriter || !s.dimUnfocusedEnabled) return Decoration.none;
			if (!plugin.isEditorInScope(view)) return Decoration.none;
			// Nothing is "unfocused" when you are not in the editor at
			// all. Alt-tabbing away used to leave the whole note dimmed
			// around a cursor nobody was at; the plugin already rebuilds
			// on focusChanged, so this clears cleanly both ways.
			if (!view.hasFocus) return Decoration.none;
			const doc  = view.state.doc;
			const head = view.state.selection.main.head;
			const cur  = doc.lineAt(head);
			// Paragraph bounds (blank-line delimited) around the cursor.
			let pStart = cur.number, pEnd = cur.number;
			while (pStart > 1 && doc.line(pStart - 1).text.trim() !== '') pStart--;
			while (pEnd < doc.lines && doc.line(pEnd + 1).text.trim() !== '') pEnd++;
			// Focus range in absolute doc positions. Paragraph mode keeps
			// the whole paragraph; sentence mode narrows it to the sentence
			// under the cursor by scanning the paragraph text for sentence
			// terminators (., !, ?, …, optionally followed by closing
			// quotes/brackets, then whitespace or paragraph end).
			let focusFrom = doc.line(pStart).from;
			let focusTo   = doc.line(pEnd).to;
			if (s.dimFocusMode === 'sentence') {
				const paraText = doc.sliceString(focusFrom, focusTo);
				const rel = Math.min(Math.max(head - focusFrom, 0), paraText.length);
				const re = /[.!?\u2026]+["'\u201d\u2019)\]]*(\s+|$)/g;
				let sFrom = 0, sTo = paraText.length, m;
				while ((m = re.exec(paraText))) {
					const termEnd  = m.index + m[0].replace(/\s+$/, '').length; // end of terminator
					const boundEnd = m.index + m[0].length;                     // after trailing whitespace
					if (boundEnd <= rel) { sFrom = boundEnd; }
					else { sTo = termEnd; break; }
				}
				focusTo   = focusFrom + sTo;   // compute before mutating focusFrom
				focusFrom = focusFrom + sFrom;
			}
			const b = new RangeSetBuilder<Decoration>();
			for (const range of view.visibleRanges) {
				let pos = range.from;
				while (pos <= range.to) {
					const line = doc.lineAt(pos);
					if (line.to < focusFrom || line.from > focusTo) {
						// Entirely outside the focus area → dim the whole line.
						b.add(line.from, line.from, dimDeco);
					} else {
						// Line overlaps the focus area (sentence mode) → dim
						// only the stretches of it outside the sentence.
						if (line.from < focusFrom) b.add(line.from, Math.min(focusFrom, line.to), dimText);
						if (focusTo < line.to)     b.add(Math.max(focusTo, line.from), line.to, dimText);
					}
					pos = line.to + 1;
				}
			}
			return b.finish();
		}
	}, { decorations: v => v.decorations });

	// ── Hidden markers ────────────────────────────────────────────────────
	const markerPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = this.build(view); }
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) {
				this.decorations = this.build(u.view);
			}
		}
		build(view: EditorView) {
			const s = plugin.settings;
			// Through textOpt, not off `s` directly: the hidden markers are
			// a Text Options setting, and reading the raw value here would
			// keep drawing them after that tab's master switch is off.
			if (!s.pluginEnabled || !plugin.markerOpt('showHiddenMarkers', false)) return Decoration.none;
			if (!plugin.isEditorInScope(view)) return Decoration.none;
			const showSp  = s.markSpaces, showTab = s.markTabs;
			const showPar = s.markParagraphs, showEol = s.markEndOfLines;
			if (!showSp && !showTab && !showPar && !showEol) return Decoration.none;
			const doc  = view.state.doc;
			const b    = new RangeSetBuilder<Decoration>();
			const wsRe = /[ \t]/g;
			for (const range of view.visibleRanges) {
				let pos = range.from;
				while (pos <= range.to) {
					const line = doc.lineAt(pos);
					if (showSp || showTab) {
						wsRe.lastIndex = 0;
						let m;
						while ((m = wsRe.exec(line.text))) {
							const isTab = m[0] === '\t';
							if (isTab ? showTab : showSp) {
								b.add(line.from + m.index, line.from + m.index + 1, isTab ? tabDeco : spaceDeco);
							}
						}
					}
					// A blank line shows ¶ (paragraph break); every other line
					// end shows ↵ — except the last line, which has no newline.
					const blank = line.text.trim() === '';
					if (blank && showPar) {
						b.add(line.to, line.to, PILCROW);
					} else if (showEol && line.number < doc.lines) {
						b.add(line.to, line.to, NEWLINE);
					}
					pos = line.to + 1;
				}
			}
			return b.finish();
		}
	}, { decorations: v => v.decorations });

	// ── Syntax highlight ──────────────────────────────────────────────────
	const checkMark = {
		filler:   Decoration.mark({ class: 'ws-ck-filler'   }),
		passive:  Decoration.mark({ class: 'ws-ck-passive'  }),
		illusion: Decoration.mark({ class: 'ws-ck-illusion' }),
		hard:     Decoration.mark({ class: 'ws-ck-hard'     }),
		veryhard: Decoration.mark({ class: 'ws-ck-veryhard' }),
		repeat:   Decoration.mark({ class: 'ws-ck-repeat'   }),
		misused:  Decoration.mark({ class: 'ws-ck-misused'  }),
		pronoun:  Decoration.mark({ class: 'ws-ck-pronoun'  }),
		dialogue: Decoration.mark({ class: 'ws-ck-dialogue' })
	};
	// THE LINE THAT CARRIES A MARK. "Mute everything else" mutes against
	// the marks: a line with none has nothing to stand out, so it is left
	// alone — a note in a language the tagger does not know (nothing tagged,
	// nothing checked) reads at full ink instead of going faint end to end.
	const markedLine = Decoration.line({ class: 'ws-marked-line' });
	const posMark = {
		noun: Decoration.mark({ class: 'ws-pos-noun' }),
		verb: Decoration.mark({ class: 'ws-pos-verb' }),
		adj:  Decoration.mark({ class: 'ws-pos-adj'  }),
		adv:  Decoration.mark({ class: 'ws-pos-adv'  }),
		conj: Decoration.mark({ class: 'ws-pos-conj' })
	};

	const syntaxPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = this.build(view); }
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
		}
		build(view: EditorView) {
			const s = plugin.settings;
			if (!s.pluginEnabled) return Decoration.none;
			// Word classes and writing checks are independent now: either
			// can run without the other.
			const posOn: Record<string, boolean> = s.posEnabled ? {
				noun: s.posNoun, verb: s.posVerb, adj: s.posAdjective,
				adv:  s.posAdverb, conj: s.posConjunction
			} : {};
			const checksOn = s.checksEnabled && (s.checkFiller || s.checkPassive ||
				s.checkIllusion || s.checkMisused || s.checkPronoun ||
				s.checkRhythm || s.checkRepetition || s.checkDialogue);
			if (!Object.keys(posOn).some(k => posOn[k]) && !checksOn) return Decoration.none;
			if (!plugin.isEditorInScope(view)) return Decoration.none;

			const doc  = view.state.doc;
			const skip = s.syntaxSkipCode ? plugin.getNonProseLines(doc) : null;
			const out  = [];
			// Repetition spans lines, so its tokens are collected across
			// the whole visible range and scanned once at the end.
			const seen: WsToken[] | null = s.checkRepetition ? [] : null;
			// the lines that got a mark, by their start — the repetition pass adds its own at the end
			const marked = new Set<number>();

			for (const range of view.visibleRanges) {
				let pos = range.from;
				while (pos <= range.to) {
					const line = doc.lineAt(pos);
					pos = line.to + 1;
					if (skip && skip.has(line.number)) continue;
					if (!line.text.trim()) continue;

					const masked = maskMarkup(line.text);
					const tokens = tagTokens(tokenizeLine(masked), masked);
					const base   = line.from;
					const before = out.length;

					for (const t of tokens) {
						const bucket = posBucket(t.tag || '');
						if (bucket && posOn[bucket]) {
							out.push(posMark[bucket].range(base + t.from, base + t.to));
						}
					}

					if (!checksOn) { if (out.length > before) marked.add(base); continue; }

					if (s.checkPassive) {
						for (const r of findPassive(tokens)) {
							out.push(checkMark.passive.range(base + r.from, base + r.to));
						}
					}
					if (s.checkIllusion) {
						for (const r of findIllusions(tokens)) {
							out.push(checkMark.illusion.range(base + r.from, base + r.to));
						}
					}
					if (s.checkMisused) {
						for (const r of findMisused(tokens)) {
							out.push(checkMark.misused.range(base + r.from, base + r.to));
						}
					}
					// Phrases first, so word hits inside a phrase can be
					// skipped rather than double-painted at double
					// opacity ("a lot of" already covers "lots").
					let phraseHits: [number, number][] | null = null;
					if (s.checkFiller) {
						phraseHits = [];
						FILLER_PHRASES.lastIndex = 0;
						let m;
						while ((m = FILLER_PHRASES.exec(masked))) {
							phraseHits.push([m.index, m.index + m[0].length]);
							out.push(checkMark.filler.range(base + m.index, base + m.index + m[0].length));
						}
					}
					for (let ti = 0; ti < tokens.length; ti++) {
						const t = tokens[ti];
						if (s.checkFiller &&
							(FILLER_STRONG.has(t.lw) || (s.checkFillerSoft && FILLER_SOFT.has(t.lw))) &&
							!(phraseHits || []).some(pr => t.from >= pr[0] && t.to <= pr[1])) {
							out.push(checkMark.filler.range(base + t.from, base + t.to));
						}
						// Only sentence-initial: a pronoun mid-sentence
						// almost always has its referent right there.
						if (s.checkPronoun && isVaguePronoun(t, ti + 1 < tokens.length ? tokens[ti + 1] : null)) {
							out.push(checkMark.pronoun.range(base + t.from, base + t.to));
						}
					}

					// DIALOGUE. Marked on the RAW line rather than the
					// masked one: masking replaces code, links and
					// maths with filler of the same length, and a
					// quote inside a link title is still a quote to
					// the eye reading the page. Offsets are into the
					// line, so `base` puts them back in the document.
					// `raw` was never a name in this scope — it is
					// `line.text` — and the ReferenceError it threw
					// took the WHOLE syntax plugin down with it:
					// CodeMirror disables a view plugin whose update
					// throws, so turning Dialogue on switched every
					// check and word-class colour off at once.
					if (s.checkDialogue) {
						for (const q of findDialogue(line.text)) {
							out.push(checkMark.dialogue.range(base + q.from, base + q.to));
						}
					}

					// Sentence rhythm. Always a background tint, whatever
					// checkStyle says: a line under thirty words is
					// noise, and the point is to see a wall of one colour.
					if (s.checkRhythm) {
						for (const sent of splitSentences(masked)) {
							const st = tokenizeLine(sent.text);
							if (st.length < 4) continue;      // fragments are not "hard"
							const grade = sentenceGrade(st);
							// != null, not ||: a threshold of 0 is a valid
							// setting and `|| 10` silently discarded it.
							const veryAt = s.checkRhythmVeryHardGrade != null ? s.checkRhythmVeryHardGrade : 14;
							const hardAt = s.checkRhythmHardGrade     != null ? s.checkRhythmHardGrade     : 10;
							const mark = grade >= veryAt ? checkMark.veryhard
								: grade >= hardAt        ? checkMark.hard
								: null;
							if (mark) out.push(mark.range(base + sent.from, base + sent.to));
						}
					}

					if (seen) {
						for (const t of tokens) {
							seen.push({ lw: t.lw, w: t.w, from: base + t.from, to: base + t.to, tag: null });
						}
					}
					if (out.length > before) marked.add(base);
				}
			}

			if (seen && seen.length) {
				const win = s.repetitionWindow    != null ? s.repetitionWindow    : 50;
				const min = s.repetitionMinLength != null ? s.repetitionMinLength : 5;
				for (const r of findRepetitions(seen, win, min)) {
					out.push(checkMark.repeat.range(r.from, r.to));
					marked.add(doc.lineAt(r.from).from);
				}
			}
			for (const at of marked) out.push(markedLine.range(at));
			return Decoration.set(out, true);
		}
	}, { decorations: v => v.decorations });

	// ── Paragraph indent ──────────────────────────────────────────────────
	// Previously a MutationObserver stamped .ws-para-first onto rendered
	// .cm-line nodes based only on blank-line adjacency, so bullets, tasks,
	// headings, quotes and table rows all got indented alongside prose.
	// As a decoration it works from the document instead of the DOM, which
	// also means it sees lines CodeMirror has scrolled out of existence.
	const paraFirstDeco = Decoration.line({ class: 'ws-para-first' });
	const paraBodyDeco  = Decoration.line({ class: 'ws-para-line'  });

	const paraPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = this.build(view); }
		update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
		build(view: EditorView) {
			const s = plugin.settings;
			if (!s.pluginEnabled || !plugin.textOpt('enableParagraphIndent', false)) return Decoration.none;
			if (!plugin.isEditorInScope(view)) return Decoration.none;

			const doc    = view.state.doc;
			const info   = plugin.getParagraphLines(doc);
			const single = s.paragraphIndentMode === 'single';
			const wanted = single ? info.body : info.first;
			const deco   = single ? paraBodyDeco : paraFirstDeco;
			const out    = [];

			for (const range of view.visibleRanges) {
				let pos = range.from;
				while (pos <= range.to) {
					const line = doc.lineAt(pos);
					pos = line.to + 1;
					if (wanted.has(line.number)) out.push(deco.range(line.from));
				}
			}
			return Decoration.set(out, true);
		}
	}, { decorations: v => v.decorations });

	// Hemingway is concatenated ahead of the typography revert keymap so
	// that when the lock is on, Backspace is blocked rather than quietly
	// reverting a substitution.
	// Watches for a CodeMirror bottom panel — the vim ":" command line is
	// one — so the bar and the bottom mask can stand down while it is up.
	// Panels open through a state effect, so an update fires with them;
	// reading the DOM rather than guessing at vim internals keeps this
	// working whatever creates the panel.
	const panelWatcher = cm.ViewPlugin.fromClass(class {
		constructor(view: EditorView) { this.sync(view); }
		update(u: ViewUpdate) { this.sync(u.view); }
		destroy() { document.body.classList.remove('ws-vim-panel-open'); }
		sync(view: EditorView) {
			let open = false, panel: Element | null = null;
			try { panel = view.dom.querySelector('.cm-panels-bottom'); open = !!panel; } catch (_) { wsCatch('buildEditorExtensions / sync: panel = view.dom.querySelector(\'.cm-panels-bottom\');', _); }
			document.body.classList.toggle('ws-vim-panel-open', open);
			// The {vim} COMMAND state is driven from this flag, and it has
			// to be updated on the way OUT as well as in. It used to sit
			// below the early return, so pressing Esc closed the panel and
			// left the flag stuck true — the bar reported COMMAND forever,
			// and with mode colours on the segment stayed that colour too.
			//
			// Set BEFORE the re-stamp below, not after: the bottom mask
			// now reads this flag to decide whether to clear the gutter
			// (see stampMaskPositions). The rAF defer means the old order
			// happened to work, but geometry that depends on which side
			// of a scheduling call an assignment falls on is a trap.
			if (open !== plugin._vimPanelOpen) {
				plugin._vimPanelOpen = open;
				// ── AND THE GAP MOVES WITH IT ──────────────────────
				//
				// The reserve is the writer’s gap, lifted to fit the
				// line while it is open — so BOTH transitions have to
				// re-stamp, not just the measuring one below. Without
				// this the bar would rise on the next refresh and come
				// back down on the one after that.
				//
				// STAMPED HERE rather than through `refresh()`: the
				// same reasoning the measure path already carries a
				// paragraph about — a refresh behind an await leaves
				// the bar moved and the mask still at the old edge.
				try {
					document.documentElement.style.setProperty(
						'--ws-vim-gutter', plugin.vimGutterHeight() + 'px');
				} catch (_) { wsCatch('buildEditorExtensions / sync: document.documentElement.style.setProperty(', _); }
				plugin.updateRetroStatusBar();
			}
			// What sits at the bottom of the window just changed, so the
			// mask geometry that stops at the bar's top edge has to be
			// recomputed either way — opening AND closing.
			plugin.scheduleMaskPosition();
			if (!open) return;
			// Measured AFTER layout — panels open through a state effect,
			// so this update can run before the fixed positioning has
			// been applied and the height read at that instant is the
			// in-flow one.
			//
			// The measurement does NOT move the bar. It is recorded as
			// the height to reserve, so the gutter is already the right
			// size the next time `:` is pressed (and on every later
			// launch) and the bar can stay exactly where it is. Only a
			// changed value costs a save.
			window.requestAnimationFrame(() => {
				try {
					if (!panel || !panel.isConnected) return;
					const h = Math.round(panel.getBoundingClientRect().height);
					if (!(h > 0) || h > 120) return;
					if (Math.abs((plugin.settings.vimPanelHeight || 0) - h) < 1) return;
					plugin.settings.vimPanelHeight = h;
					// Stamp the variable NOW rather than waiting for the
					// refresh inside saveSettings — that refresh sits
					// behind an await on a disk write, and until it lands
					// the bar has moved to the new gutter while the mask
					// still ends at the old one. That gap is the strip
					// left uncovered under the mask the first time `:`
					// was pressed. Setting it here closes the window;
					// the save then only persists what is already true.
					document.documentElement.style.setProperty(
						'--ws-vim-gutter', plugin.vimGutterHeight() + 'px');
					plugin.scheduleMaskPosition();
					void plugin.saveSettings(true);
				} catch (_) { wsCatch('buildEditorExtensions / sync: if (!panel.isConnected) return;', _); }
			});
		}
	});

	// ── EOF tildes (vim's ~) ──────────────────────────────────────────────
	// Vim draws a ~ on every VISIBLE screen row past the end of the
	// buffer. Those rows are not document positions — no decoration can
	// reach them — so this plugin owns a real element, absolutely
	// positioned over the empty space between the last line and the
	// bottom of the scroll viewport, and repainted on scroll/resize/
	// edit. It lives in view.dom (.cm-editor is position:relative in
	// CM's base theme), so like vim's the tildes hold their screen rows
	// while the text scrolls beneath them.
	const eofTildePlugin = ViewPlugin.fromClass(class {
		view: EditorView;
		el: HTMLElement;
		measure: { read: () => TildeMeasure; write: (m: TildeMeasure) => void };
		onScroll: () => void;
		constructor(view: EditorView) {
			this.view = view;
			this.el = createDiv();
			this.el.className = 'ws-eof-tildes';
			view.dom.appendChild(this.el);
			this.measure = { read: () => this.read(), write: (m) => this.write(m) };
			// CM only produces a plugin update when the viewport set
			// actually changes, which small scrolls inside the render
			// margin don't — an own scroll listener keeps the tildes
			// glued to their rows. requestMeasure is scheduler-safe.
			this.onScroll = () => view.requestMeasure(this.measure);
			view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
			view.requestMeasure(this.measure);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || u.geometryChanged) {
				u.view.requestMeasure(this.measure);
			}
		}
		destroy() {
			this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
			this.el.remove();
		}
		// All layout reads happen here, inside CM's measure phase.
		read() {
			const view = this.view;
			const s = plugin.settings;
			if (!s.pluginEnabled || !plugin.markerOpt('showHiddenMarkers', false)
				|| !s.markBlankLines) return null;
			if (!plugin.isEditorInScope(view)) return null;
			const scRect  = view.scrollDOM.getBoundingClientRect();
			const cRect   = view.contentDOM.getBoundingClientRect();
			const cStyle  = getComputedStyle(view.contentDOM);
			// The bottom of the LAST DOCUMENT LINE, from CodeMirror's own
			// line geometry. The earlier box arithmetic (content bottom
			// minus padding) drifted in zen mode — the scroller carries
			// 50vh pads there and Obsidian stacks its own slack on the
			// content — which parked the tildes on the note's trailing
			// blank lines. lineBlockAt() knows exactly where the final
			// line ends; a line holding only a return is still a line,
			// so, as in vim, it gets no tilde — only the void after it.
			let textBottom;
			try {
				textBottom = view.documentTop
					+ view.lineBlockAt(view.state.doc.length).bottom;
			} catch {
				// Older CM without those accessors: fall back to boxes.
				textBottom = cRect.bottom - (parseFloat(cStyle.paddingBottom) || 0);
			}
			const lineH   = view.defaultLineHeight || 24;
			// Scrolled far past the end, the last line can sit above the
			// viewport; then every visible row is past EOF (clamp to top).
			const startY  = Math.max(textBottom, scRect.top);
			const height  = scRect.bottom - startY;
			if (height < lineH * 0.5) return { hide: true as const };
			const domRect = view.dom.getBoundingClientRect();
			return {
				top:   startY - domRect.top,
				left:  (cRect.left - domRect.left) + (parseFloat(cStyle.paddingLeft) || 0),
				lineH,
				// The face is READ from the content element rather than
				// inherited through .cm-editor. The overlay is a sibling
				// of .cm-scroller, so the font rules that target
				// .cm-content (and the --ws-font stamp that drives them)
				// never reached it — which is why the tildes came out in
				// the interface font instead of the chosen one. Copying
				// the computed value cannot miss whatever set it.
				font:  cStyle.fontFamily,
				size:  cStyle.fontSize,
				weight: cStyle.fontWeight,
				count: Math.min(500, Math.ceil(height / lineH))
			};
		}
		write(m: TildeMeasure) {
			if (!m || m.hide === true || !(m.count > 0)) { this.el.classList.remove('is-on'); return; }
			const st = this.el.style;
			this.el.classList.add('is-on');
			st.top        = m.top + 'px';
			st.left       = m.left + 'px';
			st.lineHeight = m.lineH + 'px';
			st.fontFamily = m.font;
			st.fontSize   = m.size;
			st.fontWeight = m.weight;
			this.el.textContent = '~\n'.repeat(m.count);
		}
	});

	// ── The caret's floor ─────────────────────────────────────────────────
	// CodeMirror's own answer to "keep the cursor this far from the edge".
	// scrollMargins is consulted every time the editor scrolls something
	// into view, so the caret is never placed inside the returned margin —
	// and unlike every layout approach, this depends on no assumption
	// about how Obsidian sizes the editor. Two attempts at doing it with
	// CSS insets (pane padding, then a scroller margin) both looked
	// correct and both let the caret go on hiding under the bar.
	//
	// MEASURED, not reserved, and that is what makes it safe to run
	// alongside the CSS margin rather than instead of it. The margin
	// asked for is exactly how far the scroller's own bottom edge
	// currently reaches PAST the line the caret must stay above. If the
	// stylesheet already lifted that edge clear, the overlap is zero or
	// negative and nothing is added — so the two cannot double up. If the
	// stylesheet did nothing, this covers the whole distance on its own.
	//
	// It also gets splits right for free: the upper pane of a top/bottom
	// split has its scroller bottom above the bar already, so it asks for
	// nothing without needing to know about `.ws-bar-overlap`.
	const caretFloor = cm.EditorView.scrollMargins.of((view) => {
		try {
			if (!plugin.editorViewIsNote(view)) return null;
			const r = view.scrollDOM.getBoundingClientRect();
			const below = Math.round(r.bottom - plugin.caretFloorY());
			const above = Math.round(plugin.caretCeilingY() - r.top);
			// A pixel of slack at each edge: fractional geometry
			// otherwise asks for a 1px margin forever and every scroll
			// fights the last one.
			const margins: { top?: number; bottom?: number } = {};
			if (below > 1) margins.bottom = below;
			if (above > 1) margins.top = above;
			return (margins.top || margins.bottom) ? margins : null;
		} catch { return null; }
	});

	// ── Margin numbers ────────────────────────────────────────────────────
	// Line numbers (absolute or relative) and paragraph numbers, drawn
	// as a LINE DECORATION carrying the figure in a data attribute, with
	// CSS ::before reading it back out through attr().
	//
	// NOT a CM6 gutter, and that is the whole point of the design. A
	// gutter is a sibling of .cm-content pinned to the left edge of the
	// scroller, which means it knows nothing about anything this plugin
	// does to the text: Text Options' horizontal padding, Marginalia's
	// 8ch gutter, and above all Limit line length, which centres the
	// column with margin-inline auto. A gutter would sit far off at the
	// pane's edge while the prose floated in the middle — numbers
	// belonging to a column they are nowhere near. A decoration is ON
	// the line, so it travels with the column through every one of
	// those, and one CSS offset places it for all of them.
	const numberPlugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = this.build(view); }
		update(u: ViewUpdate) {
			// No selectionSet: paragraph numbers do not depend on where
			// the caret is. (The removed relative line numbers did, and
			// were the only reason this ever rebuilt on cursor movement.)
			if (u.docChanged || u.viewportChanged) {
				this.decorations = this.build(u.view);
			}
		}
		build(view: EditorView) {
			const b = new RangeSetBuilder<Decoration>();
			if (!plugin.settings.paragraphNumbers || !plugin.isActiveFileInScope()) {
				return b.finish();
			}
			const doc = view.state.doc;

			// PARAGRAPH NUMBERS need the whole document, not the
			// viewport: paragraph seven is only the seventh if the six
			// above it were counted, and the six above it are usually
			// scrolled off. scanNonProseLines is the same helper the
			// word count uses, so "prose" means here exactly what it
			// means there — frontmatter, fences and maths are not it.
			const paraOf = new Map();
			{
				const lines = doc.toString().split('\n');
				const skip = scanNonProseLines(lines);
				let n = 0, open = false;
				for (let i = 0; i < lines.length; i++) {
					const ln = i + 1;
					const raw = lines[i];
					const t = raw.trim();
					// A blank line, or anything the counter skips, ends
					// the paragraph that was open.
					if (!t || skip.has(ln)) { open = false; continue; }
					// STRUCTURE IS NOT A PARAGRAPH. Headings, list items
					// and tasks, quotes and callouts, tables, and the
					// rules between sections all read as lines of prose
					// to a naive check and are none of them the thing an
					// editor means by "the third paragraph".
					if (/^(#{1,6}\s|>|\||\s*([-*+]\s|\d+[.)]\s)|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(raw)) {
						open = false;
						continue;
					}
					// A paragraph is numbered at its FIRST line only —
					// the wrapped continuation of one paragraph is not a
					// second paragraph.
					if (!open) { n++; open = true; paraOf.set(ln, n); }
				}
			}

			for (const { from, to } of view.visibleRanges) {
				let pos = from;
				while (pos <= to) {
					const line = doc.lineAt(pos);
					if (paraOf.has(line.number)) {
						b.add(line.from, line.from, Decoration.line({
							attributes: { 'data-ws-pnum': String(paraOf.get(line.number)) }
						}));
					}
					if (line.to + 1 <= pos) break;
					pos = line.to + 1;
				}
			}
			return b.finish();
		}
	}, { decorations: v => v.decorations });

	return [dimPlugin, markerPlugin, syntaxPlugin, paraPlugin, panelWatcher, eofTildePlugin, caretFloor, numberPlugin]
		.concat(plugin.buildHemingwayExtensions())
		.concat(plugin.buildTypographyExtension())
		.concat(plugin.buildTypographyRevertKeymap());
}
