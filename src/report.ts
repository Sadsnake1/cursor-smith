// Word-Smith — Report: the counts and the report: the stats, the goals, the folder sums, the words.
//
// Part of the plugin class, cut out by area: the
// methods below are assigned onto WordSmith.prototype at the end of plugin.ts
// and declared on the class there, so every `this.x()` reaches them exactly
// as before, from any file. `this` is the plugin.

import { MarkdownView, TFile, Modal, Platform } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import type { Text as CmText } from '@codemirror/state';
import type { WsTextStats } from './settings';
import { CJK_CHAR, READ_WPM, REPORT_STOPWORDS, WORDISH, countSyllables, fkGrade, isParagraphLine, maskForCounting, wsGlyphWord, parseColorRGB, scanNonProseLines, splitSentences, tokenizeLine, wsCatch, wsShareText, wsIsFile, wsErrMsg } from './preamble';
import type WordSmith from './plugin';
import type { WsInkDrop, WsInkBubble, WsInkWave, WsInkOrb } from './plugin';

export const reportMethods = {

	// Strip a leading YAML frontmatter block. Frontmatter inflates word
	// counts on heavily-tagged notes and makes goals inconsistent with
	// Obsidian's own counter.
	stripFrontmatter(this: WordSmith, text: string) {
		if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
			const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
			if (m) return text.slice(m[0].length);
		}
		return text;
	},

	// The single source of truth for every word figure in the plugin — the
	// goal ring, {readtime}, the sidebar counts and the explorer totals all
	// derive from it, so an approximation here is wrong in four places at once.
	//
	// Counted: sentence text, headings, list item text, table cells, link
	// display text, and inline code (it is usually part of the sentence).
	// Not counted: frontmatter, fenced code blocks, math, HTML tags, URLs and
	// link targets, footnote markers, comments, and markup characters.
	//
	// Both figures come out of one reduction so {words} and {chars} can never
	// end up measuring different documents.
	countProse(this: WordSmith, text: string) {
		// Same shape as the full return, or callers reading charsNoSpaces get
		// undefined on an empty note.
		if (!text) return { words: 0, chars: 0, charsNoSpaces: 0, charsWithSpaces: 0 };
		const lines = text.split('\n');
		const skip  = scanNonProseLines(lines);
		const kept  = [];
		for (let i = 0; i < lines.length; i++) {
			if (!skip.has(i + 1)) kept.push(maskForCounting(lines[i]));
		}
		// Comments can span lines, so they are stripped after rejoining.
		const prose = kept.join('\n').replace(/%%[\s\S]*?%%/g, ' ');

		CJK_CHAR.lastIndex = 0;
		const cjk = (prose.match(CJK_CHAR) || []).length;
		// Remove the per-character scripts before counting runs, or each
		// stretch of Han would also count once as a single "word".
		const rest = prose.replace(CJK_CHAR, ' ');
		WORDISH.lastIndex = 0;
		const runs = (rest.match(WORDISH) || []).length;

		const collapsed = prose.replace(/\s+/g, ' ').trim();
		// WHITESPACE IS NOT A CHARACTER. `chars` counted the collapsed
		// text, so a run of four spaces, a tab, or three blank lines each
		// scored ONE — neither the literal length a word processor gives
		// nor the count of things a reader actually sees. By request, the
		// plugin's character count is now the visible characters: no
		// spaces, no tabs, no line breaks, anywhere it is shown ({chars}
		// in the bar, the report's figure, the history's totals — they
		// all come through here, which is why one edit moves all of them).
		//
		// The literal figure is kept alongside as `charsWithSpaces`, and
		// it is the TRUE one now — every space, tab and newline counted
		// once each — because the collapsed version was under-reporting
		// it. That is what the report's second character cell shows.
		const raw = String(prose || '');
		return {
			words: cjk + runs,
			chars: collapsed.replace(/\s+/g, '').length,
			// Kept under its old name too: several call sites and tests read
			// `charsNoSpaces`, and it means exactly what `chars` does.
			charsNoSpaces: collapsed.replace(/\s+/g, '').length,
			// UNTRIMMED. `raw.trim().length` threw away every space, tab
			// and newline at the two ends of the document — and the end
			// of the document is precisely where a writer testing "does
			// a space count now" puts one. The promise above is "every
			// space, tab and newline counted once each", and trim was
			// the one word in the line that broke it. The masking keeps
			// string length, so this is the literal length of the
			// counted lines, whitespace and all.
			charsWithSpaces: raw.length
		};
	},

	// ── THE MOST USED WORDS ──────────────────────────────────────────────
	//
	// The words are the runs `countProse` counts — the same non-prose lines
	// skipped, the same masking, the same WORDISH — so the percentages are
	// of the figure the Report already shows. Case is folded ("Alice" and
	// "alice" are one word); nothing is stemmed ("walk" and "walked" are two
	// rows, which is honest where a wrong stem would read as a bug); a
	// numeral is not a word. `into` lets a folder add its notes into one map.
	wordFreqInto(this: WordSmith, text: string, into: Map<string, number> | null) {
		const map = into || new Map<string, number>();
		if (!text) return map;
		const lines = String(text).split('\n');
		const skip  = scanNonProseLines(lines);
		const kept  = [];
		for (let i = 0; i < lines.length; i++) {
			if (!skip.has(i + 1)) kept.push(maskForCounting(lines[i]));
		}
		const prose = kept.join('\n').replace(/%%[\s\S]*?%%/g, ' ').replace(CJK_CHAR, ' ');
		for (const run of prose.match(WORDISH) || []) {
			const w = run.toLowerCase().replace(/\u2019/g, "'").replace(/[-'_]+$/, '');
			if (!w || /^\p{N}/u.test(w)) continue;
			map.set(w, (map.get(w) || 0) + 1);
		}
		return map;
	},

	// The top `n` of a frequency map, the common words left out unless
	// `common` says otherwise; ties go alphabetically so the list is stable.
	topWords(this: WordSmith, freq: Map<string, number>, n: number, common: boolean) {
		const rows = [];
		if (freq) for (const [w, c] of freq) {
			if (!common && REPORT_STOPWORDS.has(w)) continue;
			rows.push({ w, n: c });
		}
		rows.sort((a, b) => b.n - a.n || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
		return rows.slice(0, n);
	},

	// One map over a list of files — a note, a folder, a selection.
	async wordFreqFor(this: WordSmith, files: TFile[]) {
		const map = new Map<string, number>();
		for (const f of files || []) {
			try { this.wordFreqInto(await this.app.vault.cachedRead(f), map); } catch (_) { wsCatch('wordFreqFor: this.wordFreqInto(await this.app.vault.cachedRead(f), map);', _); }
		}
		return map;
	},

	// from countProse so the report can never disagree with the status bar.
	analyzeText(this: WordSmith, text: string): WsTextStats {
		const base = this.countProse(text);
		const lines = String(text || '').split('\n');
		const skip  = scanNonProseLines(lines);
		let sentences = 0, syllables = 0, paragraphs = 0, lineCount = 0, inPara = false;
		for (let i = 0; i < lines.length; i++) {
			const raw = lines[i];
			if (skip.has(i + 1)) { inPara = false; continue; }
			if (!raw.trim()) { inPara = false; continue; }
			lineCount++;
			if (!inPara) { paragraphs++; inPara = true; }
			const masked = maskForCounting(raw);
			for (const sent of splitSentences(masked)) {
				const toks = tokenizeLine(sent.text);
				if (!toks.length) continue;
				sentences++;
				for (const t of toks) syllables += countSyllables(t.w);
			}
		}
		return {
			words:      base.words,
			chars:      base.chars,
			charsNoSpaces: base.charsNoSpaces,
			charsWithSpaces: base.charsWithSpaces,
			syllables,
			sentences,
			paragraphs,
			lines:      lineCount,
			// The manuscript convention: 250 words to a page.
			pages:      base.words ? Math.max(1, Math.round(base.words / 250)) : 0,
			grade:      fkGrade(base.words, sentences, syllables)
		};
	},

	countWords(this: WordSmith, text: string) {
		return this.countProse(text).words;
	},

	// Doc-derived stats (total word count, char count, paragraph ranges),
	// cached on the CodeMirror doc object — reference equality means the
	// cache only invalidates after actual edits, so the selection/cursor
	// paths never re-split a 50k-word note just to redraw the bar.
	getDocStats(this: WordSmith, view: MarkdownView) {
		const editor = view.editor;
		const doc = editor && editor.cm && editor.cm.state ? editor.cm.state.doc : null;
		if (doc && this._docStatsCache && this._docStatsCache.doc === doc) {
			return this._docStatsCache;
		}
		const full      = view.getViewData();
		const prose     = this.countProse(full);
		const totalWC   = prose.words;
		// THE LITERAL FIGURE, spaces and all: {chars} is the word-processor
		// figure — every space, tab and newline in the counted lines, once each
		// — because a counter that ignores a keystroke reads as a counter that
		// is broken. It still skips what the word count skips (frontmatter,
		// fences, maths), so the two tokens keep describing the same document.
		const charCount = prose.charsWithSpaces;
		// Paragraph ranges: contiguous runs of non-blank, non-heading lines.
		const lines = full.split('\n');
		const paras = [];
		let inPara = false;
		for (let i = 0; i < lines.length; i++) {
			const raw     = lines[i];
			const blank   = raw.trim() === '';
			const heading = /^\s{0,3}#{1,6}\s/.test(raw);
			if (!blank && !heading) {
				if (!inPara) { paras.push({ start: i, end: i }); inPara = true; }
				else paras[paras.length - 1].end = i;
			} else {
				inPara = false;
			}
		}
		// AND THE TASKS: counted by the same `countTasks` the Organizer's column
		// uses, cached with the rest against the doc.
		let tasks = { done: 0, all: 0 };
		try { tasks = this.countTasks(full); } catch (_) { wsCatch('getDocStats: tasks = this.countTasks(full);', _); }
		const stats = { doc, totalWC, charCount, paras, tasks };
		if (doc) this._docStatsCache = stats; // only cache when identity is trackable
		return stats;
	},

	// Line numbers the prose analyser must not touch: YAML frontmatter, fenced
	// code (``` and ~~~), and $$ math blocks. Cached on CodeMirror doc
	// identity exactly like getDocStats, so it costs one scan per edit rather
	// than one per repaint.
	getNonProseLines(this: WordSmith, doc: CmText) {
		if (this._fenceCache && this._fenceCache.doc === doc) return this._fenceCache.set;
		// On very large notes the whole-document scan is not worth paying on
		// every keystroke. Per-line inline masking still applies, so the only
		// thing lost is multi-line fence awareness.
		const set = doc.length > 400000
			? new Set()
			: scanNonProseLines(doc.toString().split('\n'));
		this._fenceCache = { doc, set };
		return set;
	},

	// Which lines are body paragraphs, and which of those open one. Cached on
	// document identity like the fence map, and computed over the whole
	// document rather than the viewport: whether a paragraph is the *first*
	// one depends on lines that may be scrolled far out of sight.
	getParagraphLines(this: WordSmith, doc: string | string[] | CmText) {
		if (this._paraCache && this._paraCache.doc === doc) return this._paraCache.val;
		const body = new Set(), first = new Set();
		if (doc.length <= 400000) {
			const lines = doc.toString().split('\n');
			const skip  = scanNonProseLines(lines);
			let prevBlank = true, seenParagraph = false;
			for (let i = 0; i < lines.length; i++) {
				const n = i + 1, text = lines[i];
				// Code and frontmatter reset the run: prose directly after a
				// closing fence starts a new block.
				if (skip.has(n)) { prevBlank = true; continue; }
				if (!isParagraphLine(text)) { prevBlank = text.trim() === ''; continue; }
				body.add(n);
				// An opener only takes an indent once an earlier paragraph has
				// established the block it is being separated from — the first
				// paragraph of a note is never indented.
				if (prevBlank && seenParagraph) first.add(n);
				seenParagraph = true;
				prevBlank = false;
			}
		}
		const val = { body, first };
		this._paraCache = { doc, val };
		return val;
	},

	getParagraphInfo(this: WordSmith, view: MarkdownView | null, stats: { doc: CmText | null; totalWC: number; charCount: number; paras: { start: number; end: number }[]; tasks: { done: number; all: number } } | null) {
		if (!view || !view.editor) return '1/1';
		const paras = (stats || this.getDocStats(view)).paras;
		const total = paras.length;
		if (total === 0) return '1/1';
		const cursorLine = view.editor.getCursor('head').line;
		// The paragraph containing the cursor; on a blank line, the next one.
		let current = 0;
		for (let p = 0; p < total; p++) {
			if (cursorLine <= paras[p].end) { current = p + 1; break; }
		}
		if (!current) current = total;
		return current + '/' + total;
	},

	// ── Folder goals + report ────────────────────────────────────────────────

	// The folder a note lives in, '/' for the vault root.
	activeFolderPath(this: WordSmith) {
		// The same two-step read activeNoteFile does, for the same reason:
		// getActiveViewOfType returns null whenever focus is anywhere but
		// the editor — the command palette, a status-bar button — and this
		// helper had no fallback while its sibling did. So the report knew
		// WHICH note it was for and not WHERE the note lived: the Folder
		// tab said "Vault root" over a note buried four folders deep, and
		// the breadcrumb chain (which needs a real path to hang from)
		// never appeared. The folder is the file's to say, whichever way
		// the file was found.
		const file = this.activeNoteFile();
		if (!file || !file.path) return null;
		const i = file.path.lastIndexOf('/');
		return i < 0 ? '/' : file.path.slice(0, i);
	},

	// Frontmatter wins, so a note can carry its own target without touching
	// settings. The click-to-set modal writes to fileGoals.
	// Pixel fireworks over the report when a goal is crossed. Rebuilt after
	// the gauge cleanup accidentally took the original with it. Two nested
	// elements per spark — the outer flies along its own angle, the inner
	// falls and fades — and the CSS drives all of the motion; this only
	// stamps positions, angles, distances and colours.
	celebrate(this: WordSmith, host: HTMLElement | null) {
		try {
			if (!host) return;
			if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
			// Plain DOM throughout. Obsidian's createDiv throws on a cls string
			// containing a space, and one throw here kills the whole show
			// silently — createElement cannot be broken that way.
			const div = (cls: string, parent?: HTMLDivElement) => {
				const d = createDiv();
				d.className = cls;
				(parent || host).appendChild(d);
				return d;
			};
			const wrap = div('ws-fireworks');
			const colors = ['#ffd166', '#ef476f', '#06d6a0', '#4f9dde', '#e347e6', '#fbfaf9', '#e0913a'];
			const spark = (parent: HTMLDivElement, size: number, color: string, delay: string|number) => {
				const sp = div('ws-firework-spark', parent);
				sp.style.width = sp.style.height = size + 'px';
				sp.style.background = color;
				sp.style.animationDelay = delay + 'ms';
			};
			// arcStart/arcSpan aim a burst: full circle by default, a narrow
			// upward fan for fountains, inward fans for the corner jets.
			const burst = (x: string|number, y: string|number, count: number, dist: number, kind: string, delay: number, arcStart?: number, arcSpan?: number) => {
				const a0   = arcStart == null ? 0   : arcStart;
				const span = arcSpan  == null ? 360 : arcSpan;
				const fw = div('ws-firework', wrap);
				fw.style.left = x + '%'; fw.style.top = y + '%';
				for (let i = 0; i < count; i++) {
					const vec = div('ws-firework-vec ' + kind, fw);
					vec.style.setProperty('--a', Math.round(a0 + (span / count) * i + Math.random() * (span / count) * 0.6) + 'deg');
					vec.style.setProperty('--d', String(-Math.round(dist * (0.6 + Math.random() * 0.7))) + 'px');
					vec.style.animationDelay = delay + 'ms';
					spark(vec, 2 + Math.floor(Math.random() * 3), colors[(i + delay) % colors.length], delay);
				}
				return fw;
			};
			// A crackle bursts, then pops a handful of micro-bursts around
			// its own rim a beat later.
			const crackle = (x: number, y: number) => {
				burst(x, y, 10, 40, 'is-fly', 0);
				for (let i = 0; i < 5; i++) {
					window.setTimeout(() => { try {
						burst(x + (Math.random() * 16 - 8), y + (Math.random() * 12 - 6),
							6, 16, 'is-crackle', 0);
					} catch (_) { wsCatch('celebrate / crackle: burst(x + (Math.random() * 16 - 8), y + (Math.random() * 12 - 6),', _); } }, 420 + i * 110);
				}
			};
			// Glitter: lone pixels twinkling anywhere on the layer.
			const glitter = (n: number, over: number) => {
				for (let i = 0; i < n; i++) {
					const tw = div('ws-firework-twinkle', wrap);
					tw.style.left = (4 + Math.random() * 92) + '%';
					tw.style.top  = (4 + Math.random() * 88) + '%';
					tw.style.width = tw.style.height = (1 + Math.round(Math.random())) + 'px';
					tw.style.background = colors[i % colors.length];
					tw.style.animationDelay = Math.round(Math.random() * over) + 'ms';
				}
			};
			const ring = (x: number, y: number, count: number, dist: number, delay: number) => {
				const fw = div('ws-firework', wrap);
				fw.style.left = x + '%'; fw.style.top = y + '%';
				const c = colors[Math.floor(Math.random() * colors.length)];
				for (let i = 0; i < count; i++) {
					const vec = div('ws-firework-vec is-ring', fw);
					// No jitter: uniform angles and one distance make a circle.
					vec.style.setProperty('--a', Math.round((360 / count) * i) + 'deg');
					vec.style.setProperty('--d', String(-dist) + 'px');
					vec.style.animationDelay = delay + 'ms';
					spark(vec, 3, c, delay);
				}
			};
			const rocket = (x: number, breakY: number, at: number, kind: string, count: number, dist: number) => {
				window.setTimeout(() => { try {
					const rk = div('ws-firework is-launch', wrap);
					rk.style.left = x + '%';
					const head = div('ws-firework-head is-launch', rk);
					spark(head, 3, '#fbfaf9', 0);
					window.setTimeout(() => { try {
						burst(x, breakY, count || 14, dist || 56, kind || 'is-rocket', 0);
						rk.remove();
					} catch (_) { wsCatch('celebrate / rocket: burst(x, breakY, count || 14, dist || 56, kind || \'is-rocket\', 0);', _); } }, 950);
				} catch (_) { wsCatch('celebrate / rocket: const rk = div(\'ws-firework\', wrap);', _); } }, at);
			};
			// A shell that breaks, then breaks AGAIN a beat later from the
			// same point in a second colour — the classic double-break.
			const shell = (x: number, y: number, delay: number) => {
				at(delay,       () => burst(x, y, 16, 58, 'is-chrys', 0));
				at(delay + 480, () => burst(x, y, 12, 34, 'is-strobe', 0));
			};
			// A barrage: n shells walked across the report on a stagger.
			const barrage = (n: number, y: number, delay: number, spacing: number) => {
				for (let i = 0; i < n; i++) {
					const x = 12 + (76 / (n - 1)) * i;
					at(delay + i * (spacing || 140),
						() => burst(x, y + (i % 2 ? 6 : 0), 11, 46,
							i % 2 ? 'is-fly' : 'is-strobe', 0));
				}
			};
			const at = (ms: number, fn: (() => HTMLDivElement) | (() => void)) => window.setTimeout(() => { try { fn(); } catch (_) { wsCatch('celebrate: fn();', _); } }, ms);

			// Thirteen seconds, choreographed in five movements. Glitter
			// underlies the whole show; over it, each movement is louder
			// than the one before and the finale is a wall.
			glitter(46, 7000);

			// I — openers
			burst(24, 26, 14, 50, 'is-fly', 0);
			at(200,  () => burst(76, 22, 14, 50, 'is-fly', 0));
			at(430,  () => burst(50, 34, 12, 44, 'is-strobe', 0));
			at(650,  () => ring(50, 28, 18, 46, 0));
			at(900,  () => burst(12, 40, 10, 40, 'is-comet', 0));
			at(1020, () => burst(88, 38, 10, 40, 'is-comet', 0));

			// II — jets from the floor, a rocket, a fountain
			at(1250, () => burst(8,  96, 10, 72, 'is-jet', 0, 5, 70));
			at(1400, () => burst(92, 96, 10, 72, 'is-jet', 0, -75, 70));
			rocket(50, 32, 1550, 'is-chrys', 18, 62);
			at(2500, () => burst(50, 97, 11, 64, 'is-jet', 0, -32, 64));
			at(2800, () => burst(50, 97, 11, 72, 'is-jet', 0, -26, 52));
			at(3050, () => burst(50, 97, 11, 80, 'is-jet', 0, -20, 40));

			// III — willows and comets over the top
			at(3300, () => burst(30, 28, 16, 54, 'is-willow', 0));
			at(3550, () => burst(70, 24, 16, 54, 'is-willow', 0));
			at(3850, () => burst(50, 20, 12, 66, 'is-comet', 0));
			at(4100, () => crackle(26, 44));
			at(4300, () => crackle(74, 40));
			at(4550, () => ring(20, 36, 14, 38, 0));
			at(4700, () => ring(80, 36, 14, 38, 0));

			// IV — double-break shells, walked across
			shell(34, 30, 4900);
			shell(66, 26, 5250);
			rocket(28, 30, 5400, 'is-chrys', 16, 58);
			rocket(72, 26, 5700, 'is-chrys', 16, 58);
			at(6200, () => glitter(22, 900));
			barrage(6, 34, 6400, 150);
			at(7400, () => burst(50, 30, 20, 60, 'is-chrys', 0));

			// V — the finale: everything at once, then a wide ring over it
			at(8200, () => { crackle(20, 38); crackle(50, 30); crackle(80, 38); });
			at(8500, () => burst(50, 97, 14, 90, 'is-jet', 0, -22, 44));
			barrage(8, 28, 8700, 110);
			shell(50, 26, 9600);
			at(9800,  () => burst(16, 34, 14, 52, 'is-willow', 0));
			at(9950,  () => burst(84, 34, 14, 52, 'is-willow', 0));
			at(10200, () => glitter(30, 700));
			at(10400, () => { burst(30, 32, 16, 56, 'is-strobe', 0);
			                  burst(70, 32, 16, 56, 'is-strobe', 0); });
			at(10800, () => ring(50, 30, 26, 62, 0));
			at(11000, () => ring(50, 30, 20, 40, 0));
			at(11300, () => burst(50, 30, 24, 74, 'is-chrys', 0));
			at(11600, () => glitter(24, 600));
			window.setTimeout(() => { try { wrap.remove(); } catch (_) { wsCatch('celebrate: wrap.remove();', _); } }, 15000);
		} catch (_) { wsCatch('celebrate: if (!host) return;', _); }
	},

	fileGoalFor(this: WordSmith, path: string) {
		const goals = this.settings.fileGoals || {};
		return Number(goals[path]) || 0;
	},

	// ── WHAT A FOLDER IS WORTH: THE SUM OF ITS NOTES ────────────────────
	//
	// A folder's target is the sum of the targets under it; nothing is
	// typed on a folder. `derived` is always true for a non-zero total —
	// the SHAPE is kept so a caller that asks whether a number was typed
	// gets an honest no rather than a missing property.
	//
	// AND IT ANSWERS FOR THE WHOLE SUBTREE, not for the rows on screen. The
	// table's folder total is `ORG_AGG` summing OVER THE ROWS AS SHOWN,
	// deliberately, so a lens that hides half the scenes cannot leave a
	// header claiming their words; the report is not lens-scoped. Two
	// questions that agree when nothing is hidden; tying one to the other
	// would tie a report to a view.
	//
	// ── EVERY FOLDER'S SUM, IN ONE WALK ──────────────────────────────────
	//
	// `folderTargetRollup` answers for ONE folder by walking the whole
	// goals map, which is right for one question and wrong in a loop:
	// called per folder row, the cost is folders × targets, and with a
	// target on every scene of a 3,000-note vault that is 157ms a pass. One
	// walk: each goal adds itself to every folder above it — the same
	// arithmetic as `folderTargetRollup`, a strict prefix, and the root
	// takes everything — and nothing to invalidate, because a caller builds
	// it inside the pass that uses it and drops it after.
	folderTargetSums(this: WordSmith) {
		const files = this.settings.fileGoals || {};
		const sums = new Map();
		let root = 0;
		for (const p of Object.keys(files)) {
			const n = Number(files[p]) || 0;
			if (!n) continue;
			root += n;
			// EVERY ANCESTOR, which is what a prefix test means walked the
			// other way. `Book/Part 1/Ch 2/Scene.md` counts toward
			// `Book/Part 1/Ch 2`, `Book/Part 1` and `Book`, and a note at the
			// vault root counts toward the root alone.
			let cut = String(p).lastIndexOf('/');
			while (cut > -1) {
				const dir = p.slice(0, cut);
				sums.set(dir, (sums.get(dir) || 0) + n);
				cut = dir.lastIndexOf('/');
			}
		}
		// THE THREE SPELLINGS OF THE ROOT that `folderTargetRollup` accepts,
		// so a caller can hand this map the same path it handed that.
		sums.set('', root);
		sums.set('/', root);
		return sums;
	},

	folderTargetRollup(this: WordSmith, path: string) {
		const root = (path === '/' || path === '' || path == null);
		const pre = root ? '' : path + '/';
		const inside = (p: string) => root || String(p).indexOf(pre) === 0;
		const files = this.settings.fileGoals || {};
		let sum = 0;
		for (const p of Object.keys(files)) {
			if (!inside(p)) continue;
			sum += Number(files[p]) || 0;
		}
		return { value: sum, derived: sum > 0 };
	},

	filesInFolder(this: WordSmith, path: string, recursive: boolean) {
		const all = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles() : [];
		if (path === '/') return recursive ? all : all.filter(f => f.path.indexOf('/') < 0);
		const prefix = path + '/';
		return all.filter(f => {
			if (!f.path.startsWith(prefix)) return false;
			return recursive || f.path.slice(prefix.length).indexOf('/') < 0;
		});
	},

	// Reads every note in the folder and below it. Cached on mtime in the same
	// map the explorer counts use, so an unchanged folder is free to re-open.
	async analyzeFolder(this: WordSmith, path: string) {
		// Lazily, because this is reachable from a bar token that can paint
		// before onload has finished initialising fields on a slow vault.
		if (!this.wordCountCache) this.wordCountCache = new Map();
		// Only the notes Word-Smith applies to.
		//
		// This counted every markdown file under the folder, which put the
		// goals at odds with everything else in the plugin: a research note
		// inside a book folder carrying `wordsmith: off` was excluded from the
		// writing history and from the word count in the bar, and then counted
		// in full towards the folder's target. "Ignore this note entirely" has
		// to mean that everywhere, or it does not mean anything.
		//
		// Anyone using a scope list will see folder totals fall the first time
		// they open the report after updating. The smaller number is the one
		// they asked for.
		const files = this.filesInFolder(path, true).filter(f => this.isFileCounted(f));
		// ── AND THE TASKS, IN THE SAME PASS ─────────────────────────────────
		//
		// Asked for from a vault: "folders should have the totals display …
		// total tasks [xx/xx]". They had none — every folder row drew an empty
		// Tasks cell while its Words cell was right — and the reason is worth
		// recording because it is a general shape.
		//
		// The window's fill was summing a folder's tasks out of the CACHE its
		// own file rows populate. That cache is filled from the rows currently
		// DRAWN, in the order they are drawn, so a folder processed before its
		// children summed nothing, and a folder whose children are inside a
		// SHUT folder summed nothing for ever. Words were right the whole time
		// because they never came from that cache: they come from here, and
		// this walks the vault.
		//
		// So the tasks come from here too. It costs nothing — this loop
		// already reads every descendant's text and caches it by mtime — and
		// it is the same answer whether the folder is open, shut or off screen.
		const total: WsTextStats & { tasksDone: number; tasksAll: number } = { words: 0, chars: 0, charsNoSpaces: 0, charsWithSpaces: 0,
			syllables: 0, sentences: 0, tasksDone: 0, tasksAll: 0,
			paragraphs: 0, lines: 0, pages: 0, grade: 0, files: files.length };
		for (const file of files) {
			let stats = null, tasks = null;
			const hit = this.wordCountCache.get('stats:' + file.path);
			// `tasks` IS PART OF THE HIT, so an entry cached before this existed
			// is re-read rather than reused without them. A cache whose shape
			// has changed is a cache miss, not a partial answer.
			if (hit && hit.mtime === file.stat.mtime && hit.tasks) {
				stats = hit.stats; tasks = hit.tasks;
			}
			if (!stats) {
				try {
					const text = await this.app.vault.cachedRead(file);
					stats = this.analyzeText(text);
					try { tasks = this.countTasks(text); } catch { tasks = { done: 0, all: 0 }; }
					this.wordCountCache.set('stats:' + file.path,
						{ mtime: file.stat.mtime, stats, tasks });
				} catch { continue; }
			}
			if (tasks) { total.tasksDone += tasks.done || 0; total.tasksAll += tasks.all || 0; }
			total.words      += stats.words;
			total.chars      += stats.chars;
			total.charsNoSpaces += stats.charsNoSpaces || 0;
			total.charsWithSpaces += stats.charsWithSpaces || 0;
			total.syllables  += stats.syllables;
			total.sentences  += stats.sentences;
			total.paragraphs += stats.paragraphs;
			total.lines      += stats.lines || 0;
		}
		total.pages = total.words ? Math.max(1, Math.round(total.words / 250)) : 0;
		total.grade = fkGrade(total.words, total.sentences, total.syllables);
		// NULL WHEN THERE ARE NONE, not `0/0`. A folder with no boxes in it has
		// no answer to "how many are left", and the cell shows nothing — the
		// same rule every other reading in the band follows.
		total.tasks = total.tasksAll ? { done: total.tasksDone, all: total.tasksAll } : null;
		return total;
	},

	// The report's ink tank, drawn on a CANVAS rather than as SVG shapes.
	//
	// Why the change: the look wanted here — water on a coarse pixel
	// lattice, a hue that drifts, and an aurora field at 100% — is
	// per-cell colour over a 2D grid. SVG can fake the first with a
	// <pattern> and cannot do the third at all: a linearGradient varies
	// colour along ONE axis, so every band stays a straight line however
	// hard its sample position is warped. A field that ripples sideways
	// needs colour to be a function of x AND y, which means writing
	// pixels. (Same reasoning, and the same warp, as Cursor-Smith's
	// auroraPattern.)
	//
	// The lattice is the point, not an artefact: cell size is fixed in
	// CSS pixels and every cell takes ONE quantised colour, so the water
	// reads as chunky and deliberate rather than as a soft gradient that
	// happens to be low-resolution.
	//
	// The percentage is a DOM element on top, not SVG text: it inherits
	// the chosen editor font by CSS, sits dead centre, and does not move.
	buildGoalLiquid(this: WordSmith, ratio: number) {
		const r = Math.min(Math.max(ratio || 0, 0), 1);
		const full = r >= 1;

		const wrap = createDiv();
		wrap.className = 'ws-goal-liquid' + (full ? ' is-full' : '');

		const canvas = createEl('canvas');
		canvas.className = 'ws-liquid-canvas';
		wrap.appendChild(canvas);

		// THE NUMBER IS A SPAN INSIDE A LAYER THAT IGNORES THE POINTER.
		//
		// `.ws-jar-pct` is `inset: 0` — it covers the whole gauge so the
		// number can be centred in it — which meant every press anywhere on
		// the jar landed on the number and poured. The water could not be
		// touched at all, and pressing near the edge did something entirely
		// different from what it looked like it would. The LAYER now lets
		// the pointer through and the number itself catches it.
		const pct = createDiv();
		pct.className = 'ws-jar-pct';
		const pctText = createSpan();
		pctText.className = 'ws-jar-pct-text';
		pctText.textContent = Math.round(r * 100) + '%';
		pct.appendChild(pctText);
		wrap.appendChild(pct);

		const ctx = canvas.getContext ? canvas.getContext('2d') : null;
		if (!ctx) return wrap;

		// Cell size in CSS px. 5 is coarse enough to read as pixel art at
		// the tank's ~76px height without turning the surface into steps.
		const CELL   = 5;
		// Discrete shade steps. Quantising is what keeps the edges crunchy;
		// without it the depth ramp is just a smooth gradient again.
		const LEVELS = 14;
		const quant  = (v: number) => Math.round(v * LEVELS) / LEVELS;
		// Opacity gets its own, much coarser ladder. Alpha varying on the
		// same fine steps as colour just reads as noise; on eight steps it
		// reads as distinct layers of water at different densities.
		const quantA = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 8) / 8;
		// Lightness is banded to whole steps as well, so the depth ramp
		// shows as a stack of visible strata rather than a smooth fade —
		// the banding IS the look here, not an artefact to be dithered out.
		const band   = (v: number) => Math.round(v / 3) * 3;

		const reduce = !!(window.matchMedia
			&& window.matchMedia('(prefers-reduced-motion: reduce)').matches);

		// The heat ramp lives on the holder as a colour; reading it back
		// keeps ONE source of truth for the ember→amber→green climb
		// (and picks up a custom goal colour for free). Parsed to a hue.
		let baseSat = 62, baseLig = 44;
		try {
			const m = getComputedStyle(canvas).color.match(/[\d.]+/g);
			if (m && m.length >= 3) {
				const hsl = this._rgbToHsl(+m[0], +m[1], +m[2]);
				baseSat = hsl[1]; baseLig = hsl[2];
			}
		} catch (_) { wsCatch('buildGoalLiquid: const m = getComputedStyle(canvas).color.match(/[\\d.]+/g);', _); }

		// THE PAPER THE JAR SITS ON. Everything this gauge draws was
		// tuned against a DARK popup and read badly on a light one:
		// half-transparent water over white goes pale and chalky (the
		// vault's "washed out"), and a sediment that darkens by a fixed
		// amount marches toward black, which on white paper is a bruise
		// in the bottom of the glass. Both need to know what is behind
		// the canvas, so it is read once, here, from the modal surface
		// the report actually uses — falling back to the page, then to a
		// dark assumption, because a wrong guess should be the old one.
		let paperLig = 12;
		try {
			const cs2 = getComputedStyle(document.body);
			const raw = (cs2.getPropertyValue('--modal-background') || '').trim()
				|| (cs2.getPropertyValue('--background-primary') || '').trim();
			const pc = parseColorRGB(raw);
			if (pc) paperLig = this._rgbToHsl(pc[0], pc[1], pc[2])[2];
		} catch (_) { wsCatch('buildGoalLiquid: const cs2 = getComputedStyle(document.body);', _); }
		// One threshold, one name: everything that must behave
		// differently on white reads THIS rather than testing again.
		const lightPaper = paperLig > 55;

		// THE LEVEL IS THE COLOUR. One hue for the whole liquid, walked along
		// a ramp by how full the jar is — so a glance answers "how far am I?"
		// before any number is read. Only the HUE travels; saturation and
		// lightness are the scheme's and have nothing to say about progress.
		// The holder's colour is the ramp's answer for the FINAL ratio, and the
		// drawn hue walks from ember to it as the level rises, so a gauge warms
		// as it fills and arrives at the colour it means.
		//
		// STOPS, in order, rather than a single sweep: red at nothing, through
		// orange and yellow, then blue, indigo and violet, and GREEN at the
		// goal. Green last because it is the only one that means "done" to
		// everyone; the middle of the ramp is deliberately cool so the warm end
		// reads as "early" rather than as "wrong". Interpolated through the
		// list in the order written, NOT by the shortest arc between two hues:
		// hues are angles, so a plain lerp from yellow (50°) to blue (215°)
		// takes the short way — straight through GREEN at the halfway mark.
		// Written UNWRAPPED, continuing NEGATIVE, the ramp goes round the other
		// side, through magenta and violet, and green is reached only at the
		// end where it belongs; the renderer takes the modulus. The sweep never
		// turns back on itself: a bar that walks backwards reads as indecision
		// rather than as progress.
		const HUE_STOPS = [
			[0.00,    2],   // red
			[0.14,   28],   // orange
			[0.26,   50],   // yellow
			[0.38,  -40],   // magenta   (320°)
			[0.50,  -72],   // violet    (288°)
			[0.62, -102],   // indigo    (258°)
			[0.74, -145],   // blue      (215°)
			[0.87, -180],   // cyan      (180°)
			[1.00, -220]    // green     (140°) — the goal
		];
		const hueNow = () => {
			// THE LEVEL, AS IT RISES. `rNow` climbs to `r` and ENDS there, so a
			// 40% jar sweeps ember→amber and rests at 40%'s colour, while only a
			// jar that reached the goal reaches green. (Not `rNow / r`, the pour's
			// progress, which would end EVERY jar on the last stop — green at 20%
			// exactly as at 100%.)
			const f = Math.max(0, Math.min(1, rNow));
			for (let i = 1; i < HUE_STOPS.length; i++) {
				const [p1, h1] = HUE_STOPS[i - 1];
				const [p2, h2] = HUE_STOPS[i];
				if (f > p2) continue;
				const k = p2 === p1 ? 0 : (f - p1) / (p2 - p1);
				return h1 + (h2 - h1) * k;
			}
			return HUE_STOPS[HUE_STOPS.length - 1][1];
		};

		let raf: number | null = null, last = 0, w = 0, h = 0, cols = 0, rows = 0, kick = () => {};
		const t0 = performance.now();

		// THE FILL POURS IN, from nothing to the number. A gauge that is
		// simply drawn at 62% states a fact; one that climbs to 62% shows the
		// writer their own week arriving, which is what a report is for. The
		// hue climbs WITH it — the ramp is a function of the level, so pouring
		// the level pours the colour, and a good week warms as it fills rather
		// than arriving green. `rNow` is what everything below reads instead of
		// `r`. It starts at zero and eases to `r`; once there it stays, so the
		// resting gauge is exactly what it always was. 1900ms: the pour is the
		// one moment the report has, and a spring filling a tank should take
		// its time.
		const POUR_MS = 1900;
		let pourFrom = 0, pourStart = t0;
		// (No drop pool: a stream from above read as debris falling into a 76px tank.)
		// Last frame's crest per column, to measure how fast the water is
		// climbing at the walls. Without it a splash could only be guessed
		// from the wave function, which is the same thing said twice and
		// drifts out of step the moment either is touched.
		let prevT = 0;
		// The last surface the loop drew, so a press can throw spray from
		// the water's actual height rather than from a guess. Read only —
		// the loop owns it.
		let surfaceNow: number[] | null = null;
		// SLOSH. A jar that has just been filled is not calm: the water
		// arrives with somewhere to go and takes a few seconds to stop.
		// One extra swell, wider and slower than the three standing ones,
		// whose amplitude decays from the moment the pour ends — so the
		// surface settles rather than simply being still.
		let sloshPhase = 0;

		// ── THE FOUR STAGES ──────────────────────────────────────────────
		//
		// A jar that simply rose and then rippled for ever said one thing:
		// "here is a number". These say what filling something is actually
		// like — it arrives, it hits, it sloshes, it settles.
		//
		//   RISE    the water climbs, overshooting its own level
		//   SPLASH  it hits that surface, throws spray, drops back
		//   LIVELY  the waves this gauge has always had
		//   CALM    they fade
		//   STILL   nothing moves again until the writer pours
		//
		// The overshoot is of the LEVEL THE JAR IS ACTUALLY AT, never of the
		// top of the tank: a gauge at 40% that slams into the lid has told the
		// writer 100% for half a second, and a number that is wrong briefly is
		// still wrong. FAST AND HARD: water that arrives slowly has nothing to
		// give the surface afterwards, and the waves after it are the
		// difference.
		const S_RISE   = 480;    // ms, climbing
		const S_SPLASH = 1150;   // hits and throws
		const S_LIVELY = 3400;   // the waves as they were
		const S_CALM   = 6400;   // fading to nothing
		let stageStart = performance.now();
		let splashed   = false;
		// A bounded pool for the splash. Cleared on every pour, so a jar
		// poured twice does not carry the first splash into the second.
		// The lumps a splash tears into, as cell offsets from the piece's
		// own cell. Four silhouettes rather than one, so a burst is not a
		// row of identical stamps: a plus, an L, a stubby bar and a clump.
		const BLOB_SHAPES = [
			[[1, 0], [0, 1], [-1, 0], [0, -1]],
			[[1, 0], [1, 1], [0, 1], [2, 1]],
			[[1, 0], [2, 0], [0, 1], [1, 1]],
			[[1, 0], [0, 1], [1, 1], [2, 0]]
		];
		const DROPS_MAX = 28;
		const drops: WsInkDrop[] = [];
		// HOW FAR THE AURORA HAS SOAKED, per column, kept BETWEEN frames.
		// The front is measured from the column's own crest, and the crest
		// is a wave — so at 100%, where the surface sweeps twenty-odd
		// pixels, the front rode up and down with it and cells flipped
		// between aurora and water every single frame. That is the
		// "flickers a lot with white" the vault reported, and it broke the
		// rule this dissolve was written to keep: a cell that has turned
		// stays turned. Remembering the deepest the front has reached is
		// what makes that true rather than merely intended. Cleared on
		// every pour, with everything else the stages own.
		let auroraFront: number[] | null = null;
		// What keeps the settled jar alive: the caustic net, the drifting light
		// shafts and the slow hue breath all move every frame, so the loop still
		// runs (see `busy`) and the liquid shimmers without anything detaching.

		// POKES. A press anywhere on the water pushes it there — a ripple
		// spreading out from the finger, dying away over about a second.
		// Bounded and cheap: four sources is more than anyone can press in
		// the time one lasts, and each is three numbers.
		const POKES_MAX = 4;
		const pokes: { x: number; y: number | null; t: number; still: boolean; hue: number }[] = [];
		// How much of the surface's liveliness is owed to pokes rather than
		// to the stage. A jar that has gone still must still answer a
		// press, so the two are taken as a MAXIMUM rather than added: a
		// poke wakes the water without pretending the pour is happening
		// again.
		const pokeEnergy = (now: number) => {
			let e = 0;
			// A STILL POKE IS THE AURORA'S, NOT THE WATER'S. Presses on a
			// lit full jar are flagged `still` (see the click handler):
			// their colour and vortex live in the aurora pass, and the
			// surface must not read them as energy — a filled tank has
			// nowhere for a wave to go.
			for (const p2 of pokes) {
				if (p2.still) continue;
				e = Math.max(e, Math.exp(-(now - p2.t) / 620));
			}
			return e;
		};
		// INERTIA. A single press wakes the water; presses IN A ROW must
		// build — the vault asked for exactly this — and a maximum cannot
		// build: under pokeEnergy alone, five rapid clicks were exactly
		// one click. Agitation is a separate store that each press ADDS
		// to, capped so a held-down finger cannot out-violence the pour,
		// and decaying on its own clock so a pause hands the jar back.
		// It rides ON TOP of the max below (see `stir`), which keeps the
		// original promise intact: one press still does not pretend the
		// pour is happening again — but a flurry of them earns its storm,
		// and the spray thrown per press grows with it too.
		let agitAt = 0, agitLevel = 0;
		// How lively the water actually IS, as against how lively the
		// disturbances say it should be. See the filter at `stirWant`.
		let stirNow = 0;
		const agitNow = (now: number) => agitLevel * Math.exp(-(now - agitAt) / 1100);

		// ── THE ORB ──────────────────────────────────────────────────────
		// Click, and a little of the tank leaves it and joins a spinning ball
		// under the pointer. Click again and it takes more. Keep clicking and
		// the jar empties into a swirling orb that throws blobs off its rim as
		// it turns. Stop, and the whole thing falls back at once. The water has
		// to LEAVE: a gather that does not drain the tank is a wave with extra
		// steps; a gather that does is an object, and an object can spin, shed
		// and fall.
		//
		// VOLUME IS CONSERVED, VISIBLY. `orb.amount` is the fraction of the
		// tank the ball is holding, and the water line drops by exactly that
		// much, so nothing is created and nothing is destroyed — what left the
		// jar is the thing turning above it. The PERCENTAGE never moves: the
		// figure is what you have written, and no amount of playing with the
		// water may edit it.
		//
		// ── WHICH TOY THE JAR IS ────────────────────────────────────────────
		// One toy per band of fill (the table below). 'slosh' — a tilt
		// oscillator, level-conserving — is kept whole as the orb's understudy,
		// one word away; each toy's machinery is guarded on its own state
		// (`orb.amount` stays at zero while the orb is not the toy), so an idle
		// toy costs the draw loop a handful of comparisons a frame.
		const DEEP_TOY = 'orb';    // 34–66%: 'orb' | 'slosh'
		const INK_TOY  = 'ink';    // 67–99%: 'ink' | 'orb' | 'slosh'
		// FOUR BANDS, EACH SUITED TO WHAT THE JAR ACTUALLY IS AT THAT FILL:
		//
		//    1–33%   WAVE    Plenty of headroom, little body. The surface is
		//                    the interesting thing: a wave stands up, runs
		//                    the tank, and breaks on the far wall.
		//   34–66%   ORB     Enough body to lift a ball out of, and enough
		//                    room above for the ball to hang in.
		//   67–99%   INK     Full of water and out of sky. Nothing left to
		//                    do with the surface, so the gesture works IN
		//                    the water: colour that spreads, and bubbles.
		//
		//     100%   AURORA  No water to move at all; the light is the
		//                    picture, and a press stirs colour into it.
		//
		// Read from `r`, the TARGET level, not from `rNow`: the level climbs
		// through the pour, and a jar that changed gesture halfway up its own
		// fill would be a jar you cannot learn. TYPED AS A STRING, not the union
		// of the four words: the checker otherwise proves `toy === 'slosh'` can
		// never be true, and the understudy must stay one word away.
		const toyHere = (): string => (r >= 1 ? 'aurora'
			: r >= 0.67 ? INK_TOY
			: r >= 0.34 ? DEEP_TOY
			: 'wave');

		// ── SLOSHING ────────────────────────────────────────────────────────
		// What a nearly-full container actually does. Tip a full glass and
		// the water piles at one end, comes back, overshoots, and settles —
		// and that is the one behaviour a half-empty jar cannot do
		// convincingly, because it needs a body of water to have.
		//
		// It is a TILT, not an object: one number, oscillating and damping,
		// added across the width as a slope. That makes it the same species
		// as the travelling waves below — a continuous field, nothing rigid,
		// no collisions — so the two halves of the jar read as one
		// instrument played at different fills rather than as two unrelated
		// toys with a seam at fifty percent. It is also why it cannot
		// produce the class of bug the orb kept producing: there is no body
		// to be drawn over the water, held under it, or fail to displace it.
		//
		// RESONANCE IS THE POINT. A tank has a natural period, and this one
		// is driven rather than set: a press adds to the tilt's VELOCITY.
		// Push in time with the swing and it builds; push against it and you
		// cancel your own water. Clicking in rhythm walks the jar toward
		// slopping over the rim; clicking carelessly flattens it. Nothing
		// announces that — it is simply true, and noticing it is the reward.
		// ── INK, AND BUBBLES ────────────────────────────────────────────────
		// A press drops colour into a deep jar. It spreads from where it
		// landed, tints the water it reaches, and fades — and the water
		// bursts outward from the point, because something has arrived in
		// it. Nothing is lifted, nothing is rigid: the ink is a field
		// sampled per cell and the burst reuses the wave machinery, so this
		// band cannot produce the class of trouble a body did.
		//
		// It suits a nearly-full jar for the reason the others do not:
		// there is a lot of water to colour and almost no surface left to
		// play with, so the interesting thing is what is IN the water
		// rather than what its top is doing.
		const inks: { x: number; y: number; t: number; hue: number; push: number; spin: number }[] = [];
		const INKS_MAX = 10;
		const INK_LIFE = 3.4;      // seconds to fade out entirely

		// BUBBLES, and a warning attached: a picture that moves forever is a
		// picture that asks to be watched (ambient motes went for that). So
		// these are NOT ambient: they belong to the
		// ink band only, they are few, and a jar nobody is pressing makes
		// almost none. They exist to say the water has depth and something
		// is happening in it, not to keep the tank busy.
		const bubbles: WsInkBubble[] = [];
		const BUBBLES_MAX = 9;
		let bubbleAt = 0;
		let inkRun = 0, inkAt = 0;
		// THE MOUND IS THE COUNT OF PRESSES. The ink band's surface answer
		// used to be per click — a pair of tiny travelling waves and a
		// transient hump for every drop — and even at a tenth of the wave
		// band's amplitude a single click read as turbulence, because a
		// nearly-full jar has no sky and EVERY answer it gave was
		// immediate. The surface answers the RUN now, not the click: each
		// press adds a share to one gathering mound, the mound is the
		// only thing the clicks raise, and only a FULL mound leaves — as
		// one wave at the opposite wall, which is the release the
		// gathering was for. One click is a swell that subsides; the wave
		// is earned.
		let inkCharge = 0;    // 0..1, built a click at a time
		let inkChargeX = 0;   // where the mound stands
		let inkChargeAt = 0;  // last press, for the idle drain
		let inkHump = 0;      // what is DRAWN, chasing inkCharge with mass
		let inkVent = 0;      // when a full mound last left as the wave

		let tilt = 0;      // radians-ish: the surface's slope, -1..1
		let tiltV = 0;     // how fast it is changing
		// The natural period comes from the water's DEPTH the way a real
		// tank's does — a fuller jar swings slower — so the rhythm to find
		// is the jar's own rather than a constant.
		const sloshW = () => 3.9 - Math.min(1, rNow) * 1.15;   // rad/s
		const SLOSH_DAMP = 0.72;   // per second; a jar settles in a few swings

		const orb: WsInkOrb = {
			amount: 0,     // 0..1 of the tank, currently in the ball
			want: 0,       // what the clicks have asked for; amount chases it
			x: 0, y: 0,    // where it hangs
			spin: 0,       // radians, accumulated
			vel: 0,        // radians per second, decays
			last: 0,       // when it was last fed
			vy: 0,         // its own fall speed, once let go
			dropping: false, // let go, on its way down, still whole
			falling: false // burst, giving its water back
		};
		// PAST THIS IT CANNOT HOLD TOGETHER — and it has to be genuinely out
		// of reach of ordinary use: reachable only by hammering a ball that is
		// ALREADY heavy, which is the only time coming apart is a story rather
		// than an interruption.
		// ── TRAVELLING WAVES ────────────────────────────────────────────────
		// A click sends a wave at the wall OPPOSITE the pointer: press near
		// the left and it runs right, press near the right and it runs
		// left, press the middle and it splits and runs both ways. It
		// crosses the tank, breaks against the wall it reaches, and throws
		// spray up it.
		//
		// The whole thing lives in the surface sum — a moving bump added to
		// the same per-column height every other feature writes into — so
		// it needs no drawing code of its own and cannot end up painted
		// over the water the way the orb had to be. That is most of why it
		// is a better fit for this renderer than a rigid body ever was.
		const waves: WsInkWave[] = [];
		let hold: { t: number; x: number; y: number } | null = null;   // a press being held, gathering
		// THE WAVE'S OWN YARDSTICK, and it has to live OUT HERE. The surface
		// sum has an `amp` — the wave amplitude for the frame — but it is a
		// per-frame local declared inside draw(), so reading it from a click
		// handler is a ReferenceError. This is the same expression without the
		// frame's `stir`, which is the part that belongs to how lively the
		// water already is: a wave should be sized by the JAR, not by how
		// agitated it happens to be at the instant of the click — otherwise a
		// second press during a storm throws further than the first, which is
		// backwards.
		//
		// THE REST LINE, AS THE LAST FRAME LEFT IT. `restNow` is a FRAME-LOCAL,
		// and the ambient amplitude is computed BEFORE the frame assigns it, so
		// a cap written against `restNow` there reads zero every frame. This is
		// the previous frame's value, outer-scope, written in one place; a
		// one-frame lag on a line that moves by fractions of a pixel per frame.
		let restSeen = 0;
		// The spring's strength this frame, published the same way and for the
		// same reason: it is computed inside the surface pass and read later by
		// the shedding, which is a different block.
		let springNow = 0;
		const waveAmp = () => Math.min(8, h * 0.06 * (1 + rNow * 0.8));
		const WAVES_MAX  = 14;     // more than a hand can produce in a second
		const WAVE_SPEED = 305;    // px/s, tuned so a press feels answered
		const WAVE_LIFE  = 2.6;    // seconds before it has spent itself
		const ORB_SPIN_CAP = 22;
		const ORB_SPIN_MAX = 19;
		// A CLICK SETS A TARGET the ball eases toward over a few frames rather
		// than the size itself, so the water has somewhere to travel from and
		// the ball arrives rather than appears. A tenth of the tank a click: on
		// a full jar, a tenth of a tall tank is the difference between a bead
		// and a ball.
		const ORB_BITE   = 0.045;  // what one click asks for
		// WHAT IT LOSES WHILE IT TURNS. A spinning ball of water does not
		// hold together: it throws its own substance off the rim, and the
		// faster it turns the more it throws. Without this the jar could be
		// emptied and then left indefinitely — the ball a container, not a
		// body of water — and the gather would feel free. Holding a big ball
		// costs clicks to maintain, which is what makes emptying the jar an
		// act rather than a countdown. Small (0.03): a leak is what happens
		// when you STOP, not a ceiling you cannot climb past — steady clicking
		// gains all the way to full and letting go still drains it.
		const ORB_LEAK   = 0.03;   // fraction of the tank lost per second at rest
		const ORB_RATE   = 2.4;    // how fast the ball reaches what was asked
		const ORB_IDLE   = 650;    // ms of no clicks before it lets go — 900
		// read as the ball LINGERING once the hand had plainly finished;
		// 650 still clears any deliberate click cadence with room to spare
		const ORB_SHED   = 0.09;   // seconds between blobs thrown off the rim
		let orbShedAt = 0, lastRingAt = 0, lastSpillAt = 0;
		// The bounce the jar makes when it gets its water back: a damped
		// oscillation added to the level, so the surface overshoots and
		// settles instead of sliding up like a progress bar.
		let splashAt = 0, splashAmp = 0;
		// WATER IN THE AIR IS NOT WATER IN THE JAR. There were two places
		// for it — in the ball, in the tank — and the level was simply
		// whatever the ball did not hold. So the instant the ball stopped
		// existing the jar had everything back, and the level snapped up in
		// the tenth of a second the burst takes: the "plop".
		//
		// Bursting and arriving are two events, not one. The ball comes
		// apart at once and its water is handed to `airborne`, which drains
		// home over the better part of a second — quickly at first, easing
		// as it settles. The tank fills in behind the spray you can see,
		// which is both smoother and more honest: water visibly in the air
		// should not already be counted in the reading.
		let airborne = 0;
		// Radius from AMOUNT BY AREA, not linearly: a ball holding twice
		// the water is √2 wider, not twice, or the first click makes an orb
		// nearly as big as the last one does.
		// 0.5 of the short side at full: the ball has to look like it could
		// hold the tank, or emptying the jar into it reads as water lost
		// rather than water moved.
		// 0.42 of the short side at full, down from 0.5. At half the tank's
		// height the ball crowded the jar it came out of — a container and
		// its contents want to read as different sizes, or the picture
		// stops having a container in it.
		// 0.34 of the short side at full. It has come down twice — 0.5, then
		// 0.42 — and the reason is the same each time: the ball is water
		// TAKEN FROM the jar, and a ball that fills the jar it came out of
		// leaves no jar in the picture to have taken it from.
		const orbR = () => Math.sqrt(orb.amount) * Math.min(w, h) * 0.34;
		// A SPINNING BODY IS NOT A CIRCLE. Liquid held together by its own
		// cohesion and pulled outward by its rotation flattens along the
		// axis it turns about — and the faster it turns the flatter it
		// gets, until it cannot hold at all. The bulge is what makes the
		// thing read as liquid rather than as a drawn disc: a circle that
		// spins looks like a texture rotating inside a stencil, because
		// only the pattern moves. `orbEcc` is 0 at rest and about 0.34 at
		// the spin limit; the radius is then modulated by the angle
		// relative to the spin, so the equator swells and the poles pull
		// in, conserving roughly the area the amount paid for.
		// 0.16, not 0.34. At a third the equator was 1.30 of the radius and
		// the poles 0.64 — a two-to-one ellipse, which is not a spinning
		// drop but a rugby ball. A liquid held by its own cohesion bulges;
		// it does not stretch. Sixteen hundredths is visible at speed and
		// invisible at rest, which is the whole job.
		const orbEcc = () => Math.min(0.16, (Math.abs(orb.vel) / ORB_SPIN_MAX) * 0.16);
		const orbRAt = (ang: number) => {
			const e = orbEcc();
			if (e < 0.01) return orbR();
			// cos(2θ) about the spin's own frame: +1 along the equator,
			// −1 at the poles. Divided by (1 + e·…) at the poles so the
			// area stays near enough constant and the ball does not appear
			// to gain water by spinning.
			const k = Math.cos(2 * (ang - orb.spin));
			return orbR() * (1 + e * k) / Math.sqrt(1 + e * e * 0.5);
		};

		// How lively the surface is, 0..1, and how far the level is pushed
		// past its own mark. One function so the stages cannot disagree
		// with each other about which one the jar is in.
		const stageAt = (ms: number) => {
			// The RISE is a column arriving in the middle, not a level
			// lifting evenly: `jet` is how much of the surface is still
			// piled up at the centre, and it collapses outward over the
			// stage so the water reaches the walls last.
			if (ms < S_RISE) {
				const u = ms / S_RISE;
				// NEAR-CALM WHILE THE COLUMN STANDS, CHURNING AS IT
				// COLLAPSES. This held 0.25 for the whole rise and the
				// splash stage opened at 3.4 — a thirteenfold amplitude
				// step in one frame, which on screen was "the animation
				// is cut suddenly and becomes wavy." The cubic keeps the
				// surface quiet while the jet is still a column (the
				// water it will disturb has not arrived yet) and hands
				// over EXACTLY the splash stage's opening energy at
				// u = 1: 0.25 + 3.15 = 3.4. A hand-over, not a cut —
				// and the collapse itself is what stirs the surface,
				// which is the right physics as well as the smooth one.
				return { wave: 0.25 + 3.15 * u * u * u, over: ease(u) * 0.10, jet: 1 - u };
			}
			if (ms < S_SPLASH) {
				const u = (ms - S_RISE) / (S_SPLASH - S_RISE);
				void u;
				// The overshoot collapses as the splash happens: the water
				// is falling back through its own level, which is what
				// throws the spray.
				// The surface is at its most violent as the column falls
				// back through it, and stays lively well into the next
				// stage rather than dropping to a polite ripple: this is
				// where the waves the writer watches come from.
				return { wave: 3.4 - u * 1.6, over: 0.10 * (1 - u) };
			}
			if (ms < S_LIVELY) {
				// Coming off the splash rather than starting flat: the
				// water is still carrying what the column gave it, and
				// spends this stage giving it back.
				const u = (ms - S_SPLASH) / (S_LIVELY - S_SPLASH);
				return { wave: 1.8 - u * 0.8, over: 0 };
			}
			if (ms < S_CALM) {
				const u = (ms - S_LIVELY) / (S_CALM - S_LIVELY);
				// Eased, not linear. A straight line to nothing reads as
				// the animation being switched off; this reads as water
				// running out of energy.
				return { wave: (1 - u) * (1 - u), over: 0 };
			}
			return { wave: 0, over: 0 };
		};
		// The swirl's own phase, re-rolled on every pour so a second
		// opening of the report does not resume the first one's current
		// mid-turn.
		let swirlPhase = Math.random() * Math.PI * 2;
		// The current's own phase, re-rolled per pour like the slosh and
		// the swirl, so two openings do not surge in step.
		let flowPhase  = Math.random() * Math.PI * 2;
		// (No hueSpin/hueDir. The spectrum-through-depth they randomised is
		// gone; the hue is the LEVEL's to say, and a level that meant
		// something different on each opening would say nothing.)
		let rNow = reduce ? r : 0;
		// A writer who asked the system for less motion gets the answer,
		// not the performance.
		const pour = () => {
			if (reduce) { rNow = r; return; }
			// FROM EMPTY, EVERY TIME. This read `pourFrom = rNow` — the
			// level the jar happens to be at — which is right for a pour
			// that interrupts another one and wrong for the only way a
			// pour is actually asked for: reopening the report. By then
			// `rNow` has reached `r`, so `pourFrom` was the target, the
			// draw loop's `rNow !== r` guard was false on the very first
			// frame, and the animation never ran at all. The jar simply
			// appeared full — at every level, not only at 100%.
			//
			// The tank empties and fills again. That is what the gesture
			// means: a writer clicking back to the report is asking to
			// watch their week arrive, and a jar that is already full has
			// nothing to show them.
			pourFrom  = 0;
			rNow      = 0;
			pourStart = performance.now();
			sloshPhase = Math.random() * Math.PI * 2;
			swirlPhase = Math.random() * Math.PI * 2;
			flowPhase  = Math.random() * Math.PI * 2;
			// THE STAGES START OVER. Everything the jar does after a pour
			// is a function of how long ago it was poured, so this one
			// timestamp is the whole reset — including the aurora, which
			// used to be read from the LEVEL and so showed nothing when a
			// full jar was poured again.
			stageStart = performance.now();
			splashed   = false;
			drops.length = 0;
			auroraFront = null;

			kick();
		};
		// SMOOTHSTEP, not easeOutCubic. The cubic leaves at full speed and
		// crawls home — at 100%, where the level crosses the whole tank,
		// that reads as a lurch followed by a long dawdle, and the lurch
		// is where most of the chop comes from. This one starts from
		// nothing, takes its speed in the middle, and arrives having
		// already slowed: the same distance in less time, and no frame in
		// it is much faster than its neighbour. Controlled rather than
		// urgent, which is what a jar filling to a finished goal should
		// look like.
		const ease = (u: number) => u * u * (3 - 2 * u);

		const resize = () => {
			const rect = wrap.getBoundingClientRect();
			const cw = Math.max(40, Math.round(rect.width  || 300));
			const ch = Math.max(24, Math.round(rect.height || 76));
			if (cw === w && ch === h) return;
			w = cw; h = ch;
			cols = Math.ceil(w / CELL);
			rows = Math.ceil(h / CELL);
			// Backing store is one device pixel per CSS pixel — the cells
			// are already the resolution, so a dpr-scaled buffer would cost
			// 4x the fill for a lattice that cannot show the difference.
			canvas.width = w; canvas.height = h;
		};

		// Aurora: colour as a warped 2D field. Four incommensurate
		// frequencies, each mixing u and v — a term in v alone is what
		// produces flat horizontal banding, and the cross terms are what
		// let a curtain bend as it crosses the tank.
		//
		// The palette is DEALT, once per opening of the report (see the
		// seed in openReportModal). One seed feeds several derived values,
		// taken as the fractional parts of multiples of it so they are
		// independent of one another rather than all sliding together:
		//   rot    — where on the wheel the palette starts, so one report
		//            opens cold blue-violet and the next opens gold-green
		//   p1..p3 — phase offsets INTO the warp terms, so the curtains
		//            hang in different places too. Rotating hue alone gives
		//            the same aurora repainted; moving the phases makes it
		//            a different sky.
		//   spread — how far the harmonics swing, i.e. whether this one is
		//            a tight two-colour shimmer or the whole wheel at once
		const S      = (typeof this._auroraSeed === 'number') ? this._auroraSeed : Math.random();
		const frac   = (n: number) => { const v = S * n; return v - Math.floor(v); };
		const rot    = frac(1) * 360;
		const p1     = frac(2.7) * 6.283;
		const p2     = frac(5.1) * 6.283;
		const p3     = frac(8.9) * 6.283;
		const spread = 0.72 + frac(3.3) * 0.62;
		// Which way the whole palette rotates as it runs — half the reports
		// drift warm-to-cold and half the other way.
		const dir    = frac(6.4) < 0.5 ? -1 : 1;
		// HOW ACTIVE THIS SKY IS. The seed used to re-roll which COLOURS a
		// report's aurora had, which is the one thing that should not vary:
		// the colours of an aurora are the gases in the air. It rolls the
		// activity instead — a quiet arc or a display in full cry — which
		// decides how much red crowns the top and how hard the pink hem
		// burns along the bottom. The true variable, and the better one.

		// TWO EXTRA ARGUMENTS, AND THEY ARE THE WHOLE OF WHAT A PRESS DOES
		// NOW. `ph` shifts the field's own PHASE at this cell and `fire`
		// brightens it; neither moves where the field is sampled.
		//
		const auroraCell = (u: number, v: number, t: number, ph?: number, fire?: number) => {
			// Its own slower clock. The aurora is the resting state of a
			// finished goal; at the water's tempo it read as agitated.
			// Its own slower clock — and a breakup hurries it. Everything in
			// the field is phased on T, so one multiplier makes the whole
			// sky race without any term having to know about the event.
			const T = t * 0.42;
			// The nudge rides IN the warp, so every term downstream — the colour
			// coordinate `s` and both ray systems — is carried by it together;
			// adding it to any one of them separately would slide the colours off
			// the curtains. THE NUDGE DOES NOT TOUCH THE COLOUR: `warp` feeds `s`,
			// and `s` runs through three hue harmonics at ±70, ±50 and ±28
			// degrees, so a press riding there would REPAINT the curtains rather
			// than ripple them, and presses in several spots would sum into a
			// swing of the whole palette. The phase goes to the RAY SYSTEMS only
			// (below): colour is decided by `s`, structure by the rays, and a
			// press answers in the second alone. Colour has its own answer to a
			// press: the hue bloom in `rot`, one tint at a time.
			const ph2 = ph || 0;
			const warp =
				Math.sin(v * 4.1 + T * 0.55 + u * 2.3 + p1) * 0.22 +
				Math.sin(v * 7.3 - T * 0.38 + u * 3.7 + p2) * 0.12 +
				Math.sin(u * 5.2 + T * 0.62 - v * 1.9 + p3) * 0.16 +
				Math.sin((u + v) * 3.3 - T * 0.27 + p1) * 0.09;
			let s = v * 0.6 - T * 0.14 + warp;
			s = s - Math.floor(s);
			// THE RAYS, HOISTED — the hue needs them now, because the pink
			// fringe rides the curtain's own brightness rather than being
			// painted along a line. Two systems at different scales: broad
			// curtains with a finer structure inside them, which is what
			// keeps the field from reading as a single soft cloud.
			//
			// FOLDED, TOO. Both varied with `u` alone, so the curtains hung
			// as straight vertical bands; real ones drape. Shearing the
			// horizontal coordinate by a slow function of height gives the
			// S-fold that makes a curtain look like cloth.
			const ray1 = 0.5 + 0.5 * Math.sin(u * 3.0 + warp * 6 + T * 0.30 + p2 + ph2);
			const ray2 = 0.5 + 0.5 * Math.sin(u * 7.5 - warp * 4 - T * 0.22 + v * 2.0 + p3
				+ ph2 * 1.6);
			// AND THE WHOLE WHEEL, WANDERING. `T * 9 * dir` walked the
			// palette one way for ever at a fixed rate, so a report left
			// open cycled predictably and two reports differed only in
			// where they started. Three slow sines at incommensurable
			// rates wander instead: the palette drifts through every hue
			// there is, never repeating, and never in a direction you
			// can anticipate. `dir` still decides which way it leans on
			// the whole, so half of them drift warm-to-cold.
			const wander = Math.sin(T * 0.081 + p1) * 96
				+ Math.sin(T * 0.047 + p2) * 71
				+ Math.sin(T * 0.029 + p3) * 54;
			const hue = rot
				+ Math.sin(s * Math.PI * 2) * 70 * spread
				+ Math.sin((s + 0.33) * Math.PI * 4) * 50 * spread
				+ Math.sin((s + 0.66) * Math.PI * 6) * 28 * spread
				+ wander * dir
				+ T * 9 * dir;
			const curtain = quant(ray1 * 0.65 + ray2 * 0.35);
			// THE ORIGINAL LIGHT, to the number. Every constant here is the
			// one this field shipped with; the temper is added ON TOP and
			// is zero at rest, so an unprovoked sky is the old sky exactly
			// and a worked one is brighter than it ever was.
			// IGNITION. More particles arriving means a brighter glow and a
			// crisper striation, so the press raises the light AND leans
			// on the curtain's own contrast — a flare in the cloth rather
			// than a lamp shone at it. It cannot shear: it is a
			// multiplier on values this cell already had.
			const f2  = fire || 0;
			const cur2 = f2 > 0 ? Math.min(1, curtain * (1 + f2 * 0.55)) : curtain;
			const lig = 30 + cur2 * 34 + (1 - v) * 10 + f2 * 16;
			const sat = 58 + cur2 * 30 + f2 * 8;
			// Banded transparency: the gaps between curtains let the tank behind
			// show through, so the aurora hangs IN the glass rather than filling
			// it like paint — at a floor high enough (0.62) that a FULL jar never
			// reads as unfilled at its dark edges.
			const alpha = quantA(0.62 + cur2 * 0.38 + f2 * 0.10);
			return 'hsla(' + Math.round(((hue % 360) + 360) % 360) + ','
				+ Math.round(Math.max(0, Math.min(100, sat))) + '%,'
				+ Math.round(Math.max(0, Math.min(100, lig))) + '%,'
				+ alpha.toFixed(2) + ')';
		};

		// ── ONE FRAME, IN PHASES ─────────────────────────────────────────
		//
		// `draw` computes the frame and hands it to each phase in turn: the
		// surface (which leaves the water's height on the frame), the splash,
		// the glow, the slosh, the waves, the orb, the drops, the aurora. The
		// phases share the jar's state through the closure; the frame carries
		// only what one tick decides.
		interface WsJarFrame {
			now: number; t: number; dt: number; stage: ReturnType<typeof stageAt>; stageMs: number;
			auroraMix: number; auroraJitter: number;
			surfaceY: number[] | null; restNow: number;
		}
		const drawSurface = (f: WsJarFrame) => {
			// Surface height per COLUMN, so the wave is sampled on the lattice
			// too — the crest steps rather than curving, which is what makes it
			// read as pixel water instead of as a smooth path that happens to be
			// drawn in blocks.
			//
			// Three components, deliberately incommensurate: a primary swell, a
			// slower counter-swell drifting the other way, and a small fast chop
			// on top. Two waves beat against each other on a visible cycle; three
			// do not, so the surface never looks like it is repeating.
			//
			// FULL MEANS FULL. The rest line reaches ABOVE the brim by the swell's
			// own amplitude, so the crest rides against the top and the troughs
			// still show water rather than air — a jar at 100% must not sit with
			// a visible gap above the water. A FULL TANK SWELLS MORE: the
			// amplitude grows with the level and is allowed a little more room at
			// the brim, which is where the writer is looking. The stage owns how
			// lively the surface is: at STILL it is zero and the water is flat,
			// which is the point of the last stage.
			const pokeE = pokeEnergy(f.now);
			// The stir: the stage or a press, whichever is louder — the max keeps
			// a settled jar's press from replaying the pour — PLUS the built-up
			// agitation, which is the part a max could never carry. Capped just
			// above the splash's own opening energy, so a storm of clicks reads as
			// a storm and not as a glitch.
			//
			// THE WATER HAS MASS, AND THIS IS WHERE IT GETS IT. `stir` scales the
			// whole surface's amplitude, and every disturbance in the tank reaches
			// the water through it — a click in the ink band, a press in the orb
			// band and a wave below half all pass through this one number. Read
			// straight from the poke store it would jump from glass to full chop in
			// ONE FRAME (pokeEnergy is a MAXIMUM of exp(-age/620), which is 1.0 on
			// the frame a poke lands), and water cannot change speed instantly,
			// because it weighs something. So the target is filtered rather than
			// used. It RISES over about a fifth of a second — quick enough that a
			// press feels answered, slow enough that the first frame is a swell
			// rather than a step — and FALLS more slowly still, because water
			// settles by losing energy and losing energy takes longer than gaining
			// it. Attack and release differ on purpose; a symmetric filter reads
			// as a fade, not as momentum.
			//
			// THE POUR'S OWN CHOP ANSWERS TO THE HEADROOM TOO. `stage` is a clock,
			// not a physical quantity: it hands out the same energy whether the
			// water has half a tank of sky to throw itself into or two cells, so
			// it is quieted at the brim like every other source (the ambient
			// swell, the gather, the poke rings, the break). At 100% the stage
			// keeps a fifth of its voice — enough that the surface lives, far too
			// little to break. Computed here rather than read from `brimEase`
			// below: the stir is worked out EARLIER in the frame than the level
			// is; `rNow` is an outer-scope value and safe at either point.
			const brimCalm = 1 - 0.80 * Math.max(0, Math.min(1, (r - 0.72) / 0.20));
			const stirWant = Math.min(3.6,
				Math.max(f.stage.wave * brimCalm, pokeE) + agitNow(f.now));
			const stirRate = stirWant > stirNow ? 7.5 : 2.6;
			stirNow += (stirWant - stirNow) * Math.min(1, stirRate * f.dt);
			const stir  = stirNow;
			// THE INK'S MOUND HAS MASS, the same lesson as `stir` directly above:
			// the handler moves the TARGET (`inkCharge`, a step per click) and the
			// drawn height chases it here, so five quick clicks are a mound
			// swelling in five surges rather than five steps. The fall has two
			// speeds on purpose — a SPENT mound (just vented into its wave) drains
			// fast, because its water visibly went somewhere; an ABANDONED one
			// subsides slowly, because nothing took the water and it just settles
			// back.
			//
			// GRACE AND DRAIN SET TWO THINGS AT ONCE: how fast an abandoned mound
			// falls, and how slowly a person may click and still build one. At
			// 400ms and 1.2/s a lone swell is gone in under a second and a cadence
			// up to about 400ms still reaches the release; a CLICKED mound is
			// untouched, because the grace resets on every press. An accelerating
			// drain cannot have both: to empty a mound quickly it has to take more
			// per second than a slow hand puts in.
			if (inkCharge > 0 && f.now - inkChargeAt > 400) {
				inkCharge = Math.max(0, inkCharge - f.dt * 1.2);
			}
			{
				const humpRate = inkCharge > inkHump ? 6.0
					: ((f.now - inkVent) < 700 ? 7.0 : 4.6);
				inkHump += (inkCharge - inkHump) * Math.min(1, humpRate * f.dt);
				if (inkHump < 0.001 && inkCharge <= 0) inkHump = 0;
			}
			// HOW STILL THIS FRAME IS, 0 (churning) to 1 (glass). One
			// derivation beside `stir` itself, because two places now
			// read it — the meniscus thins with it and the caustics
			// climb faster — and a second copy is a second thing to
			// forget when either is tuned.
			const calm  = 1 - Math.min(1, stir);
			// THE CLIMB, shared by every field that drifts. Hoisted here because
			// the light shaft is computed per COLUMN and the caustics per CELL,
			// and the two must rise together or the tank has two currents. AND IT
			// WANDERS: a single rate is a metronome, and bands marching up at a
			// fixed speed read as a machine part. Two slow sines — incommensurate,
			// so they never line up — make the current surge and ease the way
			// water does, at a drift of ~5px/s rather than a conveyor belt's 16.
			// Still a function of t alone, so the motion stays purely vertical.
			const climb = f.t * 0.34 * (1 + 0.55 * calm)
				+ Math.sin(f.t * 0.19 + flowPhase) * 0.9
				+ Math.sin(f.t * 0.07 + flowPhase * 1.7) * 1.6;
			const ampWant = Math.min(8, h * 0.06 * (1 + rNow * 0.8));
			// NO SKY, NO SWELL. The base amplitude grows with the LEVEL
			// — a full tank has the most water to move — and nothing
			// ever asked whether it had the sky to move it INTO. In a
			// nearly-full jar the stirred sines wanted ±17px of global
			// motion over ~10px of headroom, so any event that raised
			// `stir` (a wave breaking on a wall, most of all) turned
			// the whole surface into one clamped crawling band — the
			// "big snake". The cap is on the STIRRED product, not the
			// base, because the snake is the output: however loud the
			// stir, the ambient swell may not exceed a share of the
			// headroom that actually exists. Low and mid fills are
			// untouched (the cap sits above what they ever ask for);
			// only the band that has no sky is quieted, which is what
			// "full of water and out of sky" was always meant to mean.
			// …AND ONLY WHERE THE SKY IS ACTUALLY GONE. A flat share
			// of headroom also bit at mid fill, where the pour's storm
			// and a flurry's earned chop legitimately dwarf the
			// headroom and always did (guard 4 is what holds them).
			// The share fades in with the level: 0.30 across the ink
			// band — the band the snake lives in — and effectively
			// unbounded below it, continuously, so no fill has a seam.
			const skyShare = 0.30 + 8 * Math.max(0, (0.67 - rNow) / 0.67);
			// AND BY THE WATER'S OWN DEPTH, which is the half that was
			// missing. The sky cap was faded out below half fill on the
			// argument that a shallow jar has headroom to spare — true,
			// and it left the ambient chop of a PUDDLE bounded by
			// nothing at all. A tank holding 22px of water was swinging
			// its surface ±16px, and that is the low-fill flash: not one
			// runaway term but every term sized for a jar that isn't
			// there. Water cannot slosh much deeper than it is.
			const depthSeen = Math.max(1, h - restSeen);
			const amp   = Math.min(ampWant * stir,
				restSeen > 0 ? restSeen * skyShare : ampWant * stir,
				depthSeen * 0.35);
			// …and how far past its own level the water is riding. SHOWN, not
			// rNow: the water rides PAST its own level during the rise and falls
			// back through it, which is what throws the splash. The orb takes its
			// share on the NEXT line rather than inside this one, so the overshoot
			// stays an overshoot of the jar's own level and not of some quantity
			// the ball has already reduced.
			//
			// ONE FACTOR FOR THE WHOLE ARRIVAL, computed once here and used by
			// everything that makes the pour dramatic: the overshoot below, the
			// bounce after it, the jet, and the stage's chop. A jar with room
			// should keep all four — water poured into space overshoots, rocks,
			// lands in the middle and chops. A jar filling to its brim has room
			// for none of them, and they are added AFTER the level, so no easing
			// of the level could hide them. FROM THE TARGET, NOT FROM THE CLIMB:
			// `rNow` is the ANIMATING level, below 0.72 for most of a pour to
			// 100%, so a factor keyed to it would leave the jet, the overshoot and
			// the chop at full strength for the whole rise and quiet them only
			// underneath the splash. A jar's ARRIVAL is decided by where it is
			// going, and it is known before the first frame.
			const brimEase = Math.max(0, Math.min(1, (r - 0.72) / 0.20));
			const calmRise = 1 - brimEase;
			const shown = Math.min(1, rNow + f.stage.over * rNow * calmRise);
			// WHAT THE ORB HOLDS IS NOT IN THE JAR. The line drops by
			// the fraction the ball has taken, which is what makes the
			// gather read as water LEAVING rather than as a bump on the
			// surface. `rNow` — the figure the percentage is drawn from
			// — is untouched: only what is shown moves.
			// THE BOUNCE. Water coming back does not arrive politely: the
			// level overshoots and rocks before it settles, which is
			// what the eye reads as a splash rather than as a bar
			// filling. Damped sine, half a second, and it can never
			// take the level outside the jar.
			const sinceSplash = splashAt ? (f.now - splashAt) : 1e9;
			const bounce = sinceSplash < 900
				? Math.exp(-sinceSplash / 320) * Math.sin(sinceSplash / 62)
					* splashAmp * calmRise
				: 0;
			// Spent: disarmed, so the next burst arms a fresh one rather
			// than inheriting an amplitude that has already been used.
			if (splashAt && sinceSplash >= 900) { splashAt = 0; splashAmp = 0; }
			// THREE PLACES NOW: the ball, the air, and the jar. Both are
			// taken off the level, so nothing is counted twice and
			// nothing arrives before it has landed.
			const held = Math.min(1, orb.amount + airborne);
			const inJar = Math.max(0, Math.min(1, shown * (1 - held) + bounce));
			// FROM THE FLOOR TO THE BRIM: both ends of the rest line are the
			// tank's own, so an empty jar has no strip of nothing along the bottom
			// and a full one no gap above the water.
			//
			// A SKY THAT CANNOT BE SPENT. The mapping deliberately OVERSHOOTS —
			// `h + amp`, so a brim-full jar's swell still reaches the ceiling —
			// and the cost would be arriving there early: at 95% the water at the
			// top of the glass with nowhere for anything to happen. Every bound in
			// this file is written in terms of the headroom; when the headroom is
			// gone they are all bounding zero. So the last of the fill is
			// COMPRESSED rather than clipped: below three quarters the mapping is
			// plain, and above it the remaining rise approaches a ceiling of
			// `h - SKY` without ever touching it. 99% is visibly fuller than 85%
			// and both still have a strip of air. A clamp would flatten them into
			// the same picture; an asymptote keeps the progress and still promises
			// the sky.
			//
			// THE RESERVE IS A PROPERTY OF THE TARGET, NOT OF THE FRAME. Computed
			// from the ANIMATING level, the pour would travel through the steep
			// part of the curve and the last stretch of an even rise would close
			// several pixels in a frame — a curve the animation moves ALONG is
			// always traversed at whatever speed the animation is going. So the
			// shape is worked out once for where the jar is GOING, and the pour is
			// a plain proportion of it: the mapping is identical at rest, and the
			// climb to it is as smooth as the easing itself, because it is the
			// easing itself.
			const SKY   = 8;
			const maxH  = h - SKY;
			const knee  = maxH * 0.75;
			const aimAt = Math.max(0.0001, Math.min(1, r));
			const aimRaw = aimAt * (h + amp);
			const aimSoft = aimRaw <= knee ? aimRaw
				: knee + (maxH - knee) * (1 - Math.exp(-(aimRaw - knee) / (maxH - knee)));
			// A cell of glass left at 99%, closed completely at 100% —
			// decided by the goal, once, rather than sampled mid-climb.
			const brim  = Math.max(0, Math.min(1, (aimAt - 0.85) / 0.15));
			const aimH  = aimSoft + (aimRaw - aimSoft) * Math.pow(brim, 16);
			const bodyH = aimH * (inJar / aimAt);
			const restY = h - bodyH;
			f.restNow = restY;
			restSeen = restY;
			const tank  = Math.max(1, h - restY);
			// The crest line, kept per column: the aurora starts AT THE
			// SURFACE and works downward, so it needs to know where the
			// water's top actually is in each column rather than
			// assuming a flat line the waves have long since left.
			f.surfaceY = new Array<number>(cols);
			// THE GEYSER'S SHAPE, hoisted: the shading pass needs to know how much
			// of a column is jet, so the profile is computed once per column
			// instead of living inside the surface sum.
			//
			// `stage.jet` is the stage's CLOCK (1 at the first frame, 0 when the
			// water meets the walls); the column's height and reach are shaped
			// here, separately, because tying both to the clock linearly makes a
			// shrinking hump — at half-time half the height and half the width,
			// which the eye reads as "the middle bulges", not "a column lands and
			// collapses outward".
			//
			//   HEIGHT holds early, plunges late (1 - gone²): a column is still a
			//   column at half-time.
			//   REACH starts at two cells and ACCELERATES to the walls (gone^1.7):
			//   slow to let go, quick to arrive, which is what a collapse outward
			//   looks like.
			//   CENTRED ON THE LATTICE: distance runs from the CELL'S CENTRE to the
			//   canvas's centre, or the peak sits one cell right of centre — a
			//   quarter of the whole column at birth.
			//
			// THE STAGE ONLY CARRIES `jet` DURING THE RISE — every later stage
			// omits the key, and `1 - undefined` is NaN, which `0 · NaN` does NOT
			// rescue: every column's surface would come out NaN, the `y + CELL <=
			// surf` skip would never fire, and the whole jar would paint in the
			// last valid colour the context held (`hsla(NaN,…)` is an assignment
			// canvas silently ignores) — instantly full, and green for ever. Read
			// once, defaulted once, used everywhere below; nothing else touches
			// `stage.jet` raw.
			//
			// …AND A BRIM-FULL JAR HAS NO JET AT ALL. A column arriving in the
			// middle and collapsing outward is right for a jar with room; at the
			// top of the range there is no air for a column to stand in, and its
			// collapse is where the pour's turbulence comes from. What is left when
			// the jet is taken away is water seeping up from below and filling the
			// tank calmly, the way a spring fills a pool — the level simply rises,
			// evenly across the width, with the bubbles carrying it. The jet fades
			// out across the same band the sky reserve closes over, so no fill
			// gains or loses it suddenly.
			const jetNow = (f.stage.jet || 0) * calmRise;
			// THE SPRING'S OWN MOUND. With the jet gone a brim-full
			// pour had nothing at the middle at all — the level simply
			// rose, which is calm but says nothing about WHERE the
			// water is coming from. A spring has a low swell over its
			// mouth, and that swell is what the blobs roll off. It is
			// a fifth the height the jet's column was and it does not
			// collapse: it stands while the water rises and eases away
			// as the jar fills, so the surface is never disturbed by
			// its going. Exactly the inverse of `calmRise` — it exists
			// only where the jet does not.
			const pourU  = Math.max(0, Math.min(1,
				(f.now - pourStart) / POUR_MS));
			const spring = brimEase * Math.sin(Math.PI * Math.min(1, pourU * 1.06))
				* (rNow > 0.02 ? 1 : 0);
			springNow = spring;
			const jetProfile = (x: number) => {
				if (!jetNow) return 0;
				const d    = Math.abs(x + CELL / 2 - w / 2);
				const gone = 1 - jetNow;               // 0..1 outward
				const half = CELL * 2 + Math.pow(gone, 1.7) * (w / 2);
				if (d > half) return 0;
				// A DOME IS A HUMP. The raw cosine carries its flanks
				// nearly to the rim, so at any width past a few cells
				// the eye reads "bulge" — which is what the vault
				// reported. Raised to a power, the flanks fall away
				// and the peak keeps its height: a jet with skirts,
				// slimmer than its own reach all the way to the walls,
				// at birth and mid-collapse alike.
				return Math.pow(
					Math.cos((d / Math.max(1, half)) * Math.PI / 2), 2.6);
			};
			for (let gx = 0; gx < cols; gx++) {
				const x = gx * CELL;
				// How much of this column is jet (0..1), and its lift.
				// Height in TANK units, not in wave units.
				const jetK  = jetProfile(x);
				const rise  = (h - 12) * 0.85
					* (1 - Math.pow(1 - jetNow, 2));
				const jetLift = jetK * rise;
				// TRAVELLING WAVES, not standing ones. A standing pattern
				// (`cos(nπx/w) · cos(ωt)`) is what water in a container really does,
				// and it reads as the whole surface pumping up and down in place —
				// correct and lifeless. Three drifting sines, deliberately
				// incommensurate so the surface never repeats, are what this gauge
				// looks right with. Physics lost to the eye, which is the right way
				// round for an ornament. `let`, because the clamp below writes it: the
				// sum of several separately-bounded terms still needs one bound of its
				// own.
				let surf = restY
					+ Math.sin(x * 0.055 + f.t * 1.15) * amp
					+ Math.sin(x * 0.021 - f.t * 0.70) * amp * 0.7
					+ Math.sin(x * 0.130 + f.t * 1.90) * amp * 0.22
					// The slosh: one long wave across the whole tank,
					// slower than the three and dying away, so a jar
					// just filled rocks before it settles.
					// The slosh rides on the stage too, loudest through
					// the splash and gone by the time the water stills.
					+ Math.sin((x / Math.max(1, w)) * Math.PI
						+ f.t * 2.6 + sloshPhase) * amp * 1.4
						* Math.max(0, f.stage.wave - 0.6)
					// EACH POKE, as a ring spreading from where it was pressed: a wave
					// whose phase is the DISTANCE from that point, so the crest travels
					// outward both ways rather than the whole surface moving at once. It
					// fades with distance and with age, and the two together are what
					// make it read as a disturbance rather than as a new mode.
					//
					// THE GEYSER. While the water is arriving it is heaped in the MIDDLE
					// and running outward — a column landing hard rather than a level
					// rising evenly. Measured against the TANK, not the wave amplitude (a
					// bulge on the waves comes to two pixels and the water simply looks
					// like it rose): a narrow column standing most of the jar's height at
					// the moment it starts, collapsing and spreading until it reaches the
					// walls, which is where the splash comes from. Narrow first and wide
					// later: a jet is a column when it arrives and a swell by the time it
					// gets to the sides.
					- jetLift
					// BOUNDED AS A SET, the recurring lesson. Each ring
					// is amp * 2.4 and there can be four of them at once;
					// clicking fast puts four fresh pokes within a few
					// cells of each other and they simply ADDED, so the
					// rings alone could raise the surface by ten times
					// the ambient swell. The stack is held to a little
					// over one ring, which is what overlapping ripples
					// really do.
					+ (() => {
						let ring = 0;
						for (const pk of pokes) {
							const d   = Math.abs(x - pk.x);
							const age = (f.now - pk.t) / 1000;
							if (age > 1.6) continue;
							ring += Math.sin(d * 0.09 - age * 9.5)
								* Math.exp(-d / 42)
								* Math.exp(-age * 2.6);
						}
						return Math.max(-1.3, Math.min(1.3, ring)) * amp * 2.4;
					})()
					// A DRAW TOWARD THE ORB, not a heap: the surface is pulled UP under
					// the ball and dented either side of it, so the water looks like it is
					// being drawn off rather than piled on. Small: the real gathering is
					// the level falling (see `shown`), and this is only the tell that the
					// jar is losing it from THERE.
					//
					// THE SLOSH, as a slope across the tank. Measured from the middle, so
					// the water pivots about its centre rather than about one wall — a
					// tank tipped at one end lifts there and drops at the other, and the
					// level in between is unchanged. Which is also what keeps the READING
					// honest: a slope about the centre moves no water on average, so the
					// percentage the jar reports cannot be tilted. The profile is not a
					// straight line: real slosh piles up steeply at the ends and stays
					// flatter through the middle, so the slope is bent by a gentle cube —
					// enough that the ends dominate.
					- (tilt !== 0 ? (() => {
						const u = (x - w / 2) / (w / 2);        // -1..1
						const bent = 0.55 * u + 0.45 * u * u * u;
						return bent * tilt * Math.min(h * 0.34, tank * 0.5);
					})() : 0)
					// THE SPRING'S SWELL, over the mouth of the fill. A
					// low dome at the middle while a brim-full jar is
					// rising: bounded against the headroom like every
					// other term, and gone by the time the pour ends.
					- (spring > 0.01 ? (() => {
						const dS = Math.abs(x - w / 2);
						return Math.exp(-(dS * dS) / 2600) * spring
							* Math.min(waveAmp() * 1.6, f.restNow * 0.42);
					})() : 0)
					// THE INK'S GATHERED MOUND belongs to the RUN of presses:
					// each click adds a share (see `inkPress`), the drawn height
					// chases the count with mass (the filter by `stir`), and a
					// full mound is spent as a wave at the opposite wall. A lone
					// click is a swell that subsides; a run is a mound growing
					// under the clicking.
					- (inkHump > 0.01 ? (() => {
						const d = Math.abs(x - inkChargeX);
						// The mound's water comes from somewhere: A RING, NOT A CENTRED DIP.
						// A moat on the same centre as the heap but wider is very nearly a
						// CONSTANT across the heap, which flattens a dome into a plateau. The
						// trough belongs BESIDE the mound, where the water it is made of
						// actually comes from — zero at the centre, deepest about forty pixels
						// out — so the peak keeps its full height, the surface visibly dips
						// either side, and the eye reads water being DRAWN IN from the
						// vicinity rather than a slab being lifted.
						const heap = Math.exp(-(d * d) / 1300);
						// The ring sits close in and falls away quickly: a trough still deep
						// half a tank away is just a lower water level, not water drawn toward
						// a mound.
						const ring = d - 42;
						const moat = Math.exp(-(ring * ring) / 1100) * 0.34;
						// TWO SCALES, AND THIS IS THE POINT. The mound is bounded by the SKY
						// (restNow, like the gather and the waves) — and in this band the sky
						// is nearly gone: at 85% the headroom is about eight pixels, so the
						// whole hump comes to ONE CELL on a five-pixel lattice. The trough is
						// bounded by the WATER instead, and there is plenty of that: a jar
						// with no sky still has depth. So the relief is bought downward — one
						// cell up at the peak, two or three down either side — and the mound
						// reads as a dome with water drawn in around it rather than as a tile
						// lifted off the surface. Which is also the more honest picture: this
						// IS water being gathered from the vicinity, and the vicinity is where
						// it visibly leaves.
						const reach = Math.min(waveAmp() * 5.5, f.restNow * 0.62);
						// DEEP ENOUGH TO CROSS A CELL: it is drawn on the same coarse grid as
						// everything else, so any relief that matters has to be worth a whole
						// cell or more.
						const sink  = Math.min(waveAmp() * 4.6,
							(h - f.restNow) * 0.34);
						return heap * inkHump * reach
							- moat * inkHump * sink;
					})() : 0)
					// THE TRAVELLING WAVE. A crest at the wave's own position, a shallow
					// trough behind it, and both fading as it goes: water thrown forward
					// leaves a hollow where it came from, and a bump with no hollow reads
					// as a bulge sliding along rather than as a wave moving through.
					//
					// CAPPED AS A WHOLE, not one wave at a time: with each wave held to
					// the headroom and their SUM held to nothing, a press in the middle
					// (which makes two) repeated quickly stacks crest on crest at the same
					// column until the surface leaves the canvas. Water does not add like
					// that — two crests meeting make one bigger crest, not one twice as
					// tall — so the total is squashed through a soft knee: below the
					// ceiling it is untouched, above it, it compresses instead of
					// clipping. Clipping would flatten the tops into a hard plateau, which
					// is its own kind of wrong.
					- (() => {
						const ceil = waveAmp() * 3.4;
						const raw = waves.reduce((sum, wv) => {
						const d = x - wv.x;
						const ad = Math.abs(d);
						if (ad > 150) return sum;
						const age = wv.born ? (f.now - wv.born) / 1000 : 0;
						if (age > WAVE_LIFE) return sum;
						// Spends itself over its life AND over the
						// distance it has run, so a wave crossing a wide
						// jar arrives quieter than one crossing a narrow
						// one — which is what a wave does.
						const spend = Math.exp(-age / (WAVE_LIFE * 0.55));
						const crest = Math.exp(-(ad * ad) / (wv.wid || 900));
						// The hollow sits BEHIND it: behind is the side
						// it came from, which is the opposite of its
						// direction of travel.
						const back  = d * wv.dir;
						const hollow = back < 0
							? Math.exp(-(back * back) / ((wv.wid || 900) * 5.8))
								* (wv.hollow || 0.42) : 0;
						return sum + (crest - hollow) * wv.amp * spend;
						}, 0);
						if (raw <= ceil && raw >= -ceil) return raw;
						const over = Math.abs(raw) - ceil;
						const sign = raw < 0 ? -1 : 1;
						// tanh-ish knee: the first pixels over the
						// ceiling still count for something, the
						// hundredth for almost nothing.
						return sign * (ceil + ceil * 0.45 * (1 - Math.exp(-over / (ceil * 0.9))));
					})()
					// THE HELD PRESS. A mound rises under the finger while
					// the button is down and leaves with the wave when
					// it lets go — so a click is a wave and a HOLD is a
					// bigger one, with the water visibly gathering for
					// it rather than the size arriving out of nowhere.
					// It eases in, so there is no step at the moment of
					// pressing.
					- (hold ? (() => {
						// THE HUMP HAS TO BE SEEN TO GROW. It was a
						// gentle 2.6× bump easing in over a second, which
						// on a shallow jar is a couple of pixels — the
						// gather was happening and could not be watched.
						// It is taller, wider, and it MOVES EARLY: the
						// curve is a square root rather than a cubic, so
						// a third of the mound is up within the first
						// fifth of a second and the rest arrives while
						// you are already watching it. A gather you
						// notice only in hindsight is not a gather.
						const held = Math.min(1, (f.now - hold.t) / 1000);
						const eased = Math.pow(held, 0.55);
						const d = Math.abs(x - hold.x);
						// …and the water it is made of comes from
						// somewhere: a shallow moat around the mound,
						// wider and far weaker, so the surface reads as
						// being DRAWN IN rather than pushed up.
						const heap  = Math.exp(-(d * d) / 2600);
						const moat  = Math.exp(-(d * d) / 26000) * 0.30;
						// waveAmp(), NOT `amp`: `amp` carries the frame's `stir`, which is
						// near zero on still water, so a mound sized by it would be multiplied
						// away by the very stillness it was meant to break. The gather is the
						// writer's, not the weather's: it is sized by the JAR and looks the
						// same on a glassy tank as on a churning one. AGAINST THE HEADROOM,
						// like the waves — a share of the room that is actually there, so a
						// shallow jar gathers a small mound and a deep one a big one, and
						// neither goes over — AND BY THE WATER, not only the sky: a gather
						// must not stand taller than the thing it is gathered from.
						const reach = Math.min(waveAmp() * 7.5, f.restNow * 0.62,
							(h - f.restNow) * 0.8);
						return (heap - moat) * eased * reach;
					})() : 0)
					- (orb.amount > 0.01 ? (() => {
						const d = Math.abs(x - orb.x);
						const lift = Math.exp(-(d * d) / 3000) - Math.exp(-(d * d) / 30000) * 0.32;
						const draw = lift * orb.amount * amp * 3;
						// DISPLACEMENT. Whatever of the ball is BELOW the
						// line has to push water aside — that is what
						// makes a body in a liquid a body rather than a
						// picture laid over one. The chord of the sphere
						// at this column is how much of it is in the way
						// here, and how far under it sits is how much of
						// that chord counts, so the bulge is tallest
						// under the middle and dies at the edges by
						// itself. Held gentle: the jar has to keep
						// reading as a gauge while somebody plays with
						// it, and a wall of water where the reading
						// should be is not a gauge.
						const R = orbR() * (1 + orbEcc());
						if (d >= R) return draw;
						const chord = 2 * Math.sqrt(R * R - d * d);
						// Measured against the REST LINE, not against the
						// surface being computed: the sum is still being
						// built at this point, so the wave's own height
						// here is not yet a number. `restNow` is the flat
						// level the water oscillates about, which is the
						// right datum anyway — a body does not displace
						// more because a wave happened to pass under it.
						const under = Math.max(0, Math.min(1,
							((orb.y + R) - f.restNow) / (2 * R)));
						return draw - chord * under * 0.22;
					})() : 0);
				// THE SURFACE MAY NOT LEAVE THE CANVAS. Every term above
				// is bounded on its own — the waves as a stack, the
				// gather against the headroom, the geyser by its stage —
				// and none of that adds up to a guarantee, because they
				// are bounded SEPARATELY and drawn TOGETHER. A mound and
				// a stack of crests at the same column could still put
				// the water over the ceiling, and a surface above the
				// ceiling means every cell in the column is water: the
				// tank filling with one colour, which is the flash.
				//
				// This is the guarantee, in one line, at the one place
				// every term has already been summed. Above it the water
				// flattens against the top rather than vanishing over
				// it — a brimming tank, which is at least what it would
				// really do.
				// THE JAR ALWAYS KEEPS SOME SKY. Clamping to the canvas
				// stopped the surface leaving the picture but not the
				// tank FILLING it — a column clamped at the top is a
				// column that is water all the way up, which is the
				// flash itself. It bounds the drawing, not the filling.
				//
				// Moving the pointer while clicking is what reached it:
				// the mound follows the cursor, so instead of piling on
				// one spot it lays a fresh full-height mound wherever
				// the cursor now is, on top of whatever waves happen to
				// be passing there.
				//
				// So the water may never climb more than three quarters
				// of the way from its rest line to the ceiling, whatever
				// the terms above want. A quarter of the headroom is
				// always left, which means the tank can always be told
				// from its own contents — and the cap is on the FINISHED
				// height, so it holds however many effects are added
				// later and however they interact.
				// THE CONTACT LINE. Water meets glass at the two walls,
				// and until now only the SHADING knew it (the meniscus
				// cling) — the height field treated the wall columns
				// like any other, so a wave arrived at the side and
				// simply stopped, with no climb where it hit. Real
				// water reflects at a wall, and reflection doubles the
				// displacement there; drawn water gets a share of
				// that: the outer two columns amplify how far they sit
				// from the REST line, crests more than troughs,
				// because water climbing glass clings and water
				// leaving it lets go. A pure function of this frame's
				// own sum — no state, no clock of its own — so it
				// cannot flicker, and a settled jar (dev = 0) is
				// untouched to the pixel. It sits ABOVE guard 4 on
				// purpose: the climb is one more term that is bounded
				// on its own and not when summed, and the quarter-sky
				// clamp below is the only place that promise is kept.
				{
					const wallD = Math.min(gx, cols - 1 - gx);
					if (wallD < 2 && f.restNow > 0) {
						const kW  = wallD === 0 ? 1 : 0.45;
						const dev = f.restNow - surf;   // >0: above rest
						surf -= dev * (dev > 0 ? 0.60 : 0.25) * kW;
					}
				}
				// …AND NOT TALLER THAN ITSELF, BY MUCH. The quarter-sky floor alone
				// is a LOW-FILL trap: at 20% the headroom is ~56px, so "keep a
				// quarter" still allows a climb of twice the water's depth, and
				// aggressive clicking from many points stacks waves, pokes and stirred
				// sines until a fifth of a jar momentarily wears a full jar's
				// silhouette. So the finished height also answers to the water's own
				// BODY: three quarters of its own depth above the rest line — a splash
				// can reasonably stand most of the depth it came from; it cannot stand
				// twice it. Same lesson, same address: bounded after the sum, or not
				// at all.
				//
				// AND ONE WHOLE CELL OF AIR, ALWAYS. Both bounds above are SHARES, and
				// a share of a small number is a small number: with the rest line at
				// 13px a quarter of the headroom is 3px, which on a five-pixel lattice
				// is not a row of anything. The last bound is therefore absolute — the
				// crest may not enter the top row, so there is a strip of glass above
				// the water at every fill the water exists at, and the jar always
				// reads as a container with something in it rather than a solid block
				// of colour. …AND THE ABSOLUTE FLOOR NEVER PUSHES WATER DOWN: it exists
				// to stop a CREST climbing into the top row, so it is bounded by the
				// rest line itself — it can only ever hold a wave back, never lower
				// the water.
				const floorY = Math.max(f.restNow * 0.25,
					f.restNow - (h - f.restNow) * 0.75, Math.min(6, f.restNow));
				if (f.restNow > 0) surf = Math.max(floorY, surf);
				surf = Math.max(1, Math.min(h, surf));
				f.surfaceY[gx] = surf;
				// LANES: a phase that varies across the tank but not
				// with time. Perfectly horizontal bands rising in
				// lockstep are the other half of "robotic"; giving each
				// column its own offset bends them into something that
				// flows. This is NOT the coupling the invariant forbids
				// — these are computed from x ALONE, so every column
				// still moves purely vertically and at the same speed;
				// only the phase differs. What is banned is x
				// multiplied into the clock, which is what gives a
				// pattern a sideways answer.
				//
				// Per COLUMN, not per cell: they do not vary with y, and
				// the shaft (computed first in the cell loop) needs them
				// too — defining them beside the caustics put one of
				// them below its own first use.
				const lane  = Math.sin(x * 0.031) * 2.1
					+ Math.sin(x * 0.013 + 1.7) * 1.3;
				const lane2 = Math.sin(x * 0.021 + 0.6) * 1.8;
				for (let gy = 0; gy < rows; gy++) {
					const y = gy * CELL;
					if (y + CELL <= surf) continue;
					// Slow, wide columns of light — the same trick as a
					// light shaft through water, and what stops the fill
					// from being uniform side to side. It used to sweep
					// SIDEWAYS at 13px/s, which made it (with the hue
					// drift) the fastest thing in the tank and the reason
					// a still jar read as flowing right-to-left. It keeps
					// its x term, so the shafts still differ column to
					// column, but the phase climbs. Computed per CELL
					// rather than per column now, because a phase that
					// depends on y cannot be lifted out of the y loop.
					// The shaft: a slow swell of light climbing the
					// tank, with a STATIC side-to-side term so the
					// columns still differ from one another. Same rule
					// as the caustics — x never shares a sine with the
					// clock, or the shaft slides sideways at 50px/s and
					// takes the whole picture with it.
					const shaft = 0.5
						+ 0.35 * Math.sin(y * 0.070 + lane2 * 0.7 + climb * 0.55)
						+ 0.15 * Math.sin(x * 0.017);
					const below = y - surf;
					// Depth below the surface, normalised on THIS COLUMN'S
					// water rather than on the rest level alone. During
					// the geyser the column stands most of the jar above a
					// rest line still near the floor, so `below / tank`
					// saturated within about one cell of the cap —
					// everything under the crest wore full-depth shading
					// AND the sediment block, and the eruption drew as a
					// black pillar. Normalised on the water actually
					// standing in the column, the ramp spreads down its
					// height instead. Settled frames are untouched: there
					// `h - surf` only exceeds the tank under a crest, and
					// by at most the wave amplitude.
					//
					// AND THE JET IS AERATED. Rising water is full of air
					// and light — it is the brightest thing in a real
					// fountain, not the darkest — so the shading depth is
					// scaled down by how much of this column is jet,
					// fading back to honest depth as the stage hands over
					// to the waves. Sediment follows for free: grains do
					// not settle in an upward jet, and a shallowed depth
					// never crosses the sediment line while the column is
					// actually erupting.
					//
					// The cell the surface passes through is only partly
					// wet, so `below` goes negative there — clamped,
					// because a negative depth would brighten the ramp
					// backwards.
					// …and never deeper than the glass. A full jar's
					// `tank` is h PLUS the swell, so the deepest cell
					// reached only ~0.73 of the ramp: the whole tank
					// sat mid-light with nothing dark to push against,
					// which is the "washed out at 100%" the vault
					// reported. Clamped to the canvas, a full jar uses
					// the whole ramp. The geyser is unaffected — its
					// column is aerated below, which is what keeps a
					// deep reading from becoming a black pillar.
					const tankCol = Math.min(h, Math.max(tank, h - surf));
					const depth = quant(Math.max(0, Math.min(1, below / tankCol))
						* (1 - 0.65 * jetK * jetNow));
					// Caustics: two diagonal ripple fields crossing, which is what throws
					// the wobbling net of light through real water. Quantised coarsely so
					// it lands as blocks of brightness rather than a smooth sheen, and
					// faded with depth because the light does not reach the bottom. DEPTH
					// PARALLAX: the second field is slowed (the two rates keep their
					// ratio, 0.41) and given a little more scale, so it sits BEHIND the
					// first — the cheapest depth there is, and the reason real water looks
					// deep.
					//
					// THE FLOW RISES. Water at rest convects upward — warmth and light
					// climb — and the climb SPEEDS UP as the surface stills, so the body
					// of the water takes over the motion the waves are giving up. AND IT
					// RISES ONLY: a sine `sin(kx·x + ky·y + wt)` is a STRIPE pattern, and
					// stripes match themselves under any shift ALONG the stripe, so "which
					// way is it moving" has a whole family of answers and the eye takes
					// the cheap one — sideways, at w/kx, which grows as the pattern
					// steepens. There is no tuning out of it: x is gone from every MOVING
					// term, the drifting fields are functions of y and t alone, and the
					// picture is invariant under horizontal shift. The side-to-side
					// variation that keeps the tank from looking uniform is a STATIC term
					// in x, which textures without travelling.
					const caus = quantA(0.5
						+ 0.26 * Math.sin(y * 0.150 + lane + climb * 1.60)
						+ 0.15 * Math.sin(y * 0.062 + lane2 + climb * 0.72)
						+ 0.11 * Math.sin(y * 0.230 + lane * 1.6 + climb * 2.30)
						+ 0.10 * Math.sin(x * 0.045));
					// CALM WATER FOCUSES. Real caustics are crispest on a
					// glassy surface and wash out when it churns, and
					// the settled jar is exactly where this gauge had
					// least to look at. The net's contrast is stretched
					// about its own midpoint as `calm` rises — quantised
					// again afterwards, so it stays a lattice of steps
					// rather than becoming a gradient.
					const causS = quantA(0.5 + (caus - 0.5) * (1 + 1.15 * calm));
					const causDepth = causS * (1 - depth * 0.65);
					// Hue drift: a few degrees, moving with time, depth and the caustic
					// field. Big enough to notice on a slow look, small enough that it
					// never reads as a cycle.
					//
					// THE INK, sampled where this cell is. Each drop opens out from where
					// it landed and fades over a few seconds, and a cell inside one is
					// pulled toward that drop's colour rather than tinted a flat amount —
					// so the middle of a fresh drop is strongly its own colour and its
					// edges barely differ from the water. `reach` grows with age, which is
					// the spreading.
					let inkH = 0, inkW = 0;
					for (let ii = 0; ii < inks.length; ii++) {
						const ik = inks[ii];
						const iAge = (f.now - ik.t) / 1000;
						if (iAge > INK_LIFE) continue;
						let dx3 = x - ik.x, dy3 = y - ik.y;
						const dist = Math.sqrt(dx3 * dx3 + dy3 * dy3);
						// A SLOW CURL WHERE THE INK WENT IN. Ink dropped
						// into water does not open as a perfect ring —
						// it turns, because the water it displaced is
						// still moving around it. The sample point is
						// rotated about the drop by an angle that FALLS
						// OFF with distance and fades with age, so the
						// front near the centre lags and drags into a
						// comma while its outer reaches stay round.
						//
						// It is the COLOUR field that turns, not the
						// surface. This is the same shear that made the
						// aurora's press read as a knot, and it is
						// welcome here for the opposite reason: ink IS
						// a substance being stirred, where the aurora's
						// curtains are not, and the height field is
						// left alone so a full jar gains no turbulence
						// from it. Tiny by construction — about a fifth
						// of a radian at the middle of a fresh drop —
						// because past that the ring stops reading as a
						// ring at all.
						if (dist > 0.5 && dist < 90) {
							const curl = (ik.spin || 1) * 0.22
								* Math.exp(-dist / 34)
								* Math.exp(-iAge / 1.6);
							if (curl > 0.004) {
								const ca3 = Math.cos(curl), sa3 = Math.sin(curl);
								const rx = dx3 * ca3 - dy3 * sa3;
								dy3 = dx3 * sa3 + dy3 * ca3;
								dx3 = rx;
							}
						}
						// A FRONT, NOT A BLOB — and this is the burst
						// itself, moved into the medium it belongs in.
						//
						// The press used to express "something entered
						// the water" as two travelling WAVES: a burst
						// written into the surface. In a jar this full
						// there is no headroom, so any surface motion
						// there is turbulence — which is why 1.5×, then
						// 0.62×, then 0.28× all felt wrong. The
						// amplitude was never the problem; the surface
						// was the wrong instrument for this band.
						//
						// So the burst is a ring of COLOUR racing
						// outward instead. `edge` is where the front has
						// got to, growing quickly and easing as it
						// slows; a cell is coloured by how near it is to
						// that radius rather than to the centre. The
						// result travels, and the water never moves.
						const grow = 1 - Math.pow(1 - Math.min(1, iAge / INK_LIFE), 2.2);
						const edge = grow * (56 + 74 * (ik.push || 1));
						// The shell thickens as it opens, so a young
						// front is a sharp ring and an old one is a
						// broad, soft cloud that has lost its edge.
						const band2 = 90 + 340 * grow;
						const ring = Math.exp(-((dist - edge) * (dist - edge)) / band2);
						// INSIDE STAYS TINTED, faintly. A front with
						// nothing behind it is a smoke ring; ink leaves
						// a wake, so the interior keeps a third of the
						// colour and the edge carries the rest.
						const inside = dist < edge ? 0.34 : 0;
						const near = Math.min(1, ring + inside);
						if (near < 0.02) continue;
						// Fades in over its first fifth of a second, so
						// a drop arrives rather than appearing.
						const life = Math.min(1, iAge / 0.2)
							* Math.max(0, 1 - iAge / INK_LIFE);
						const wgt = near * life;
						inkH += ik.hue * wgt;
						inkW += wgt;
					}
					const hue = (inkW > 0.001
						? hueNow() + (inkH / inkW - hueNow()) * Math.min(0.85, inkW)
						: hueNow())
						+ Math.sin(f.t * 0.28 + depth * 2.4) * 7
						// THIS ONE WAS THE FASTEST SIDEWAYS THING IN
						// THE TANK — 16px/s, purely horizontal — and
						// a colour drift moving crosswise pulls the
						// whole picture with it however the light
						// behaves. It climbs with everything else now.
						+ Math.sin(y * 0.045 + climb * 0.30) * 4
						+ causDepth * 4;
					// Four bands down the column, each with its own treatment rather than
					// one continuous ramp: the crest cap, the foam under it, open water,
					// and the sediment at the floor. THE MENISCUS: real water clings to
					// what holds it, so the top row is lighter and more opaque than the
					// water under it, and thickens toward the two walls where the clinging
					// actually happens. It is the cheapest thing in this gauge that reads
					// as LIQUID rather than as fill.
					const wall = Math.min(gx, cols - 1 - gx);
					// THE MENISCUS THINS AS THE WATER SETTLES. Real
					// clinging does not, but the drawn one has to: at
					// full thickness the white band is right on a
					// churning surface — where it IS the foam of a
					// wave — and far too heavy on a still one, where
					// the vault read it as a thick white lid rather
					// than as the water's edge. Both the base skin
					// and the extra the walls get shrink toward calm,
					// so a settled jar keeps a hairline and a moving
					// one keeps its foam.
					const cling = 1 + (wall < 2
						? (2 - wall) * 0.9 * (1 - 0.72 * calm) : 0);
					// ONE CELL AT REST, and the arithmetic is deliberate.
					// A still surface is FLAT, so every column agrees
					// on where it falls between two cells — the crest
					// band is therefore all-or-nothing across the
					// whole tank, and at the old thickness it landed
					// TWO rows of near-white on every column: the
					// thick white lid the vault reported. The rest
					// threshold is pushed inside the cell the surface
					// passes through (whose `below` is negative), so
					// calm water wears a one-cell hairline and the
					// wall cling cannot push it to two either.
					const skin  = 1 - 0.82 * calm;
					// The crest's own edge is DITHERED, and more so the
					// livelier the water: a calm surface keeps a clean
					// line, and a churning one breaks up into the foam
					// under it rather than staying a drawn curve. The
					// stage decides how much, so this is the same
					// energy the waves and the spray are answering to.
					// CAPPED. This scattered the crest boundary by
					// ±0.6 cells per unit of stir, and stir runs to
					// 3.6 — so at full pour the bright band's edge
					// jumped two cells in and out on a per-cell
					// pattern, which is speckle rather than foam, and
					// it is most of what "flickers a lot with white"
					// was. The dither still breaks the line up; it can
					// no longer strobe across it.
					const chop = (((gx * 5 + gy * 11) % 8) / 8 - 0.5)
						* CELL * 1.2 * Math.min(1.35, stir);
					const crest = below < CELL * cling * skin + chop;
					// The foam under the crest thins with it, or the
					// band merely moves from one white to a slightly
					// less white one and the lid is still a lid.
					const foam  = below < CELL * (2.5 - 1.15 * calm);
					let lig, sat, alpha;
					if (crest) {
						// The lit edge of the wave: BRIGHT WATER, NOT WHITE. A crest cell that
						// is very nearly white makes a full jar, whose surface sweeps most of
						// the tank, throw white across the picture every frame; a lit crest is
						// bright enough to be the top of a wave and still carries the jar's
						// own colour. THE CREST READS AGAINST THE PAPER IT IS ON: on a light
						// theme a flat lift lands DARKER than white paper, and the meniscus
						// reads as a grey line drawn along the top of the water instead of
						// light on its edge — so it is pushed well past the paper on light
						// schemes and left where it is on dark ones.
						lig   = baseLig + (lightPaper ? 34 : 22) + causDepth * 6;
						sat   = baseSat - (lightPaper ? 6 : 12);
						alpha = 0.96;
					} else if (foam) {
						lig   = baseLig + 14 + causDepth * 8;
						sat   = baseSat - 6;
						alpha = quantA(0.80 + caus * 0.12);
					} else {
						// DEEP WATER IS DEEP, NOT BLACK — and not chalk. What differs between
						// a dark popup and a white one is not the fill (`baseLig` is the
						// SCHEME'S ACCENT, about 44 on either paper), it is the PAPER behind
						// it, and the floor is nearly opaque. So the floor is set as a step
						// away from the paper rather than as a value of its own: darker than
						// the paper on white, lighter than it on black, by an amount that
						// reads as depth without running to either end. A DEEPER STEP ON
						// WHITE: water on white paper has to go a long way down before it
						// reads as depth; on dark paper it has much less room.
						const deepLig = lightPaper
							? Math.max(22, paperLig - 60)
							: Math.min(62, paperLig + 30);
						lig   = (baseLig + 12) + (deepLig - (baseLig + 12)) * depth
							+ causDepth * (9 + 6 * calm) + shaft * 5;
						sat   = baseSat + depth * 16 - causDepth * 6;
						// Deep water is denser: the background reads
						// clearly through the shallows and not at all
						// through the floor. The range is wide on
						// purpose — a narrow one lands on two steps of
						// the ladder and the layering disappears.
						//
						// ON WHITE PAPER IT STARTS DENSER. At 0.48 the
						// shallows were half white, which on a dark
						// popup is depth and on a light one is chalk —
						// the vault's "washed out". The floor rises
						// and the range shortens to keep the same
						// ceiling, so the layering survives; the
						// colour is simply allowed to be a colour.
						alpha = quantA((lightPaper ? 0.70 : 0.48)
							+ depth * (lightPaper ? 0.28 : 0.50)
							+ caus * 0.06);
						// …and carries more chroma, because a light
						// backdrop bleaches what a dark one deepens.
						if (lightPaper) sat += 12;
					}
					// Sediment: the last band of the tank darkens and saturates further,
					// so the fill has a floor instead of fading out at the bottom edge. IT
					// SETTLES TOWARD THE PAPER, not toward black: a LERP, so the deepest
					// water walks most of the way to the surface the report is drawn on
					// and the tank fades into its own background at the bottom on either
					// kind of theme — a fixed subtraction on top of a ramp that already
					// darkens is a floor on a dark popup and a bruise in the bottom of the
					// glass on a white one. It still reads as a floor (the water above it
					// is denser and more saturated), and it carries its own DITHER, so it
					// is settled grains rather than a band.
					if (depth > 0.62) {
						const s2 = (depth - 0.62) / 0.38;
						lig += (paperLig - lig) * s2 * 0.72;
						// Toward the paper means toward the paper's
						// greyness too: a deep cell that keeps full
						// chroma while walking to a pale surface goes
						// muddy rather than quiet.
						sat -= s2 * (lightPaper ? 22 : -14);
						const grit = ((gx * 3 + gy * 7) % 9) / 9;
						if (grit < s2 * 0.55) {
							lig += (paperLig > lig ? 1 : -1) * (4 + s2 * 5);
						}
					}
					ctx.fillStyle = 'hsla(' + Math.round(hue) + ','
						+ Math.round(Math.max(0, Math.min(100, sat))) + '%,'
						+ band(Math.max(0, Math.min(100, lig))) + '%,'
						+ alpha.toFixed(2) + ')';
					ctx.fillRect(x, y, CELL, CELL);
				}
			}
		};

		const drawSplash = (f: WsJarFrame, splashRoom: number) => {
			if (!splashed && f.stageMs >= S_RISE && f.surfaceY && !reduce
				&& splashRoom > 0.05) {
				splashed = true;
				// HARD ENOUGH TO SEE. The old velocities peaked around
				// 130 up in the middle — an apex of nine pixels over a
				// surface that is itself churning nineteen, so the spray
				// existed and vanished into the waves, and the vault
				// reported "there is no splash." Thrown from a collapse
				// the height of the jar, the beads have to CLEAR the
				// storm they came from.
				// BLOBS, NOT ONLY BEADS. Every thrown piece was a single
				// cell, so a collapse the height of the jar threw what
				// looked like dust. Water does not come apart into a fine
				// even spray: it tears into LUMPS, a few big ones with
				// beads around them, and the big ones are what read as
				// water leaving the surface.
				//
				// Each piece gets a size in cells (1–3) and a shape drawn
				// from a tiny table of cell offsets, so a blob is a
				// deliberate little cluster on the lattice rather than a
				// scaled square — scaling is how pixel art stops looking
				// like pixel art. Heavier lumps are thrown slightly
				// slower, which is both true and what keeps them from
				// outrunning the beads and reading as a single sheet.
				const many = Math.min(DROPS_MAX,
					Math.max(1, Math.round(Math.max(10, cols / 2.5) * splashRoom)));
				for (let k = 0; k < many; k++) {
					const gx  = Math.floor((k + 0.5) * cols / many);
					const off = Math.abs(gx / Math.max(1, cols - 1) - 0.5) * 2;
					// A few fat ones, more middling, mostly beads.
					const roll = Math.random();
					const size = roll > 0.86 ? 3 : (roll > 0.58 ? 2 : 1);
					const heavy = 1 - (size - 1) * 0.16;
					drops.push({
						x: gx * CELL,
						y: (f.surfaceY[gx] || h) - CELL,
						vx: (gx < cols / 2 ? 1 : -1) * off * (22 + Math.random() * 26),
						vy: -(170 + off * 120 + Math.random() * 120) * heavy,
						size,
						shape: Math.floor(Math.random() * 4),
						// EACH BEAD ITS OWN SHADE. Water thrown off a coloured surface carries
						// the colour it came from and no two beads carry quite the same, so
						// each takes a hue near the ramp's own — dozens of cells in flight in
						// one near-white read as a stencil. Narrower than the orb's blobs (±34
						// against ±90): the pour is one body of water breaking up, not colour
						// being stirred in.
						hue: hueNow() + (Math.random() - 0.5) * 68,
						life: 0
					});
				}
			}
		};

		const drawGlow = (f: WsJarFrame) => {
			// EVERY LEVEL, not just the ink band. A jar has water in it at
			// 5% as much as at 95%, and water lets air go — tying bubbles
			// to one band said they were an ink effect, which they are not.
			//
			// The motes' lesson still governs the RATE: a picture that moves forever asks
			// to be watched. So they stay few, they stay slow, and a jar
			// nobody touches makes them rarely. What changed is only which
			// jars get them.
			//
			// Scaled by the water there is: a nearly-empty tank is a
			// puddle, and a puddle does not bubble like a full one.
			if (surfaceNow && rNow > 0.04) {
				const busy = inks.length > 0 ? 1 : 0.18;
				const body = 0.35 + Math.min(1, rNow) * 0.65;
				if (f.now - bubbleAt > (620 / ((0.4 + busy) * body)) && bubbles.length < BUBBLES_MAX) {
					bubbleAt = f.now;
					const bx = Math.random() * w;
					const gxb = Math.max(0, Math.min(cols - 1, Math.round(bx / CELL)));
					const from = surfaceNow[gxb] || h;
					// Born in the BODY of the water, not at its floor: a
					// bubble that always starts on the base reads as a row
					// of vents rather than as water.
					const depthStart = from + (h - from) * (0.25 + Math.random() * 0.7);
					bubbles.push({
						x: bx,
						y: Math.min(h - CELL, depthStart),
						// Small ones dawdle, big ones climb — which is what
						// bubbles do, and it stops them moving as a set.
						size: Math.random() < 0.3 ? 2 : 1,
						rise: 16 + Math.random() * 26,
						phase: Math.random() * 6.283,
						wob: 0.6 + Math.random() * 1.4,
						hue: hueNow() + (Math.random() - 0.5) * 40
					});
				}
				for (let bi = bubbles.length - 1; bi >= 0; bi--) {
					const bb = bubbles[bi];
					bb.y -= bb.rise * (bb.size === 2 ? 1.5 : 1) * f.dt;
					// A wobble as it goes, because a bubble does not rise
					// in a straight line through moving water.
					bb.phase += f.dt * 2.2;
					const bx2 = bb.x + Math.sin(bb.phase) * bb.wob * 2.4;
					const gxb = Math.max(0, Math.min(cols - 1, Math.round(bx2 / CELL)));
					const line = surfaceNow[gxb] || h;
					if (bb.y <= line + CELL * 0.5) {
						// IT POPS, SLIGHTLY. A ring on the surface where it
						// broke and, for a big one, a bead or two thrown —
						// small enough that a jar full of bubbles is still
						// a jar rather than a rolling boil.
						if (pokes.length < POKES_MAX) {
							pokes.push({ x: bx2, y: null, t: f.now, still: true, hue: bb.hue });
						}
						if (bb.size === 2 && drops.length < DROPS_MAX && Math.random() < 0.6) {
							drops.push({
								x: bx2, y: line - CELL,
								vx: (Math.random() - 0.5) * 26,
								vy: -(26 + Math.random() * 34),
								life: 0, shed: true, pull: true,
								hue: bb.hue, size: 1,
								shape: Math.floor(Math.random() * 4)
							});
						}
						bubbles.splice(bi, 1);
						continue;
					}
					// Drawn as its own cells, on the lattice, lighter than
					// the water it is in — a hole in the liquid, not a dot
					// laid on top of it.
					const px3 = Math.round(bx2 / CELL) * CELL;
					const py3 = Math.round(bb.y / CELL) * CELL;
					ctx.fillStyle = 'hsla(' + Math.round(bb.hue) + ','
						+ Math.round(Math.max(0, baseSat - 18)) + '%,'
						// 0.66: a cell you can half see through is chalk on a light theme
						// whatever it is meant to be. A bubble reads as a hole in the liquid
						// by being LIGHTER than the water, not by being thinner than it.
						+ band(Math.min(96, baseLig + 30)) + '%,0.66)';
					ctx.fillRect(px3, py3, CELL, CELL);
					if (bb.size === 2) {
						ctx.fillRect(px3 + CELL, py3, CELL, CELL);
						ctx.fillRect(px3, py3 + CELL, CELL, CELL);
						ctx.fillRect(px3 + CELL, py3 + CELL, CELL, CELL);
					}
				}
			} else if (bubbles.length) {
				// An empty jar has nothing to release.
				bubbles.length = 0;
			}
		};

		const drawTilt = (f: WsJarFrame) => {
			// ── THE SLOSH: swing, damp, spill ─────────────────────────────
			// A damped harmonic, integrated semi-implicitly (velocity first,
			// then position) because the plain explicit form gains energy at
			// large steps — and a frame that arrives late must not make the
			// water livelier than it was.
			if (Math.abs(tilt) > 0.0005 || Math.abs(tiltV) > 0.0005) {
				const wsq = sloshW() * sloshW();
				tiltV += -wsq * tilt * f.dt - SLOSH_DAMP * tiltV * f.dt;
				tilt  += tiltV * f.dt;
				// Bounded: a tilt past this is water standing on a wall, and
				// what a real one does at that point is leave the container.
				const cap = 1.0;
				if (Math.abs(tilt) > cap) {
					tilt = tilt < 0 ? -cap : cap;
					// SLOPPING OVER THE RIM. The energy it cannot hold as a
					// slope goes over the side — thrown up the wall it is
					// piled against, and taken OUT of the swing, so a jar
					// driven too hard spends itself instead of ringing
					// forever. This is what "no headroom" is for.
					if (Math.abs(tiltV) > 0.35 && surfaceNow
						&& drops.length < DROPS_MAX && f.now - lastSpillAt > 90) {
						lastSpillAt = f.now;
						const side = tilt > 0 ? cols - 1 : 0;
						const sx = side * CELL;
						const many = Math.min(DROPS_MAX - drops.length,
							2 + Math.round(Math.abs(tiltV) * 4));
						for (let k = 0; k < many; k++) {
							drops.push({
								x: sx + (Math.random() - 0.5) * CELL * 3,
								y: (surfaceNow[side] || h) - CELL,
								vx: (tilt > 0 ? 1 : -1) * (10 + Math.random() * 40),
								vy: -(50 + Math.random() * 110),
								life: 0,
								shed: true,
								hue: hueNow() + (Math.random() - 0.5) * 60,
								size: Math.random() < 0.3 ? 2 : 1,
								shape: Math.floor(Math.random() * 4)
							});
						}
						tiltV *= 0.72;
					}
				}
			} else if (tilt !== 0 || tiltV !== 0) {
				tilt = 0; tiltV = 0;
			}
		};

		const drawWaves = (f: WsJarFrame) => {
			// ── THE WAVES: run, clash, break ──────────────────────────────
			if (waves.length) {
				const spray = (px2: number, many: number, upward: number, hue: number) => {
					const gxs = Math.max(0, Math.min(cols - 1, Math.round(px2 / CELL)));
					const from = (surfaceNow ? (surfaceNow[gxs] || h) : h) - CELL;
					const room = Math.max(0, Math.min(DROPS_MAX - drops.length, many));
					for (let k = 0; k < room; k++) {
						drops.push({
							x: px2 + (Math.random() - 0.5) * CELL * 3,
							y: from,
							vx: (Math.random() - 0.5) * 90 + upward * 0,
							vy: -(70 + Math.random() * 130),
							life: 0,
							shed: true,
							hue: hue + (Math.random() - 0.5) * 60,
							size: Math.random() < 0.34 ? 2 : 1,
							shape: Math.floor(Math.random() * 4)
						});
					}
				};

				for (let i = waves.length - 1; i >= 0; i--) {
					const wv = waves[i];
					// FIRST-FRAME ANCHOR, not the moment of the click. The
					// handler runs on performance.now() and the draw loop on
					// the frame's own timestamp; in the running app those are
					// the same clock a millisecond apart, so a wave born at
					// one and aged against the other looked fine. It is still
					// two clocks, and the codebase has been bitten by exactly
					// that before (see the agitation note). A wave stamped
					// here can never be older than the frame that first saw
					// it, whatever the two clocks think of each other.
					if (!wv.born) wv.born = f.now;
					const age = (f.now - wv.born) / 1000;
					wv.x += wv.dir * (wv.spd || WAVE_SPEED) * f.dt;

					// BREAKING ON THE WALL. A wave that simply left the tank
					// would be a bump that stopped existing; water arriving
					// at a wall goes UP it. The spray is thrown from the
					// wall itself and leans back into the jar, and how much
					// of it there is follows what the wave still had.
					if (!wv.broke && (wv.x <= 1 || wv.x >= w - 1)) {
						wv.broke = true;
						wv.x = wv.x <= 1 ? 0 : w;
						const left = Math.exp(-age / (WAVE_LIFE * 0.55));
						// Scaled by the wave's OWN spray appetite: an ink
						// swell arriving at a wall should lap it, not burst
						// on it, and it carries spray: 0 for exactly that.
						const sp = wv.spray == null ? 1 : wv.spray;
						spray(wv.x, Math.round((1 + left * 4) * sp), 0, wv.hue);
						if (pokes.length >= POKES_MAX) pokes.shift();
						// A break IS energy — unlike a landing bead, which
						// only rings. This is the wave arriving, and the
						// tank is entitled to feel it.
						//
						// BUT ONLY AS MUCH AS THE WAVE HAD. A non-still poke
						// takes `pokeEnergy` to 1.0 on the frame it lands —
						// it is a MAXIMUM, so one break pins the whole
						// surface's amplitude at full for the next half
						// second, and every column in the tank trembles
						// because a wave touched one wall. On a jar with
						// headroom that reads as the wall answering; in the
						// ink band it read as the whole water shivering
						// after the swell arrived, which is not what
						// hitting a wall looks like.
						//
						// So the claim is scaled by the wave's OWN appetite,
						// the same number that already decides its spray —
						// a click wave (3–5) breaks exactly as it always
						// did, and an ink swell (1.2) laps the wall: it
						// rings where it struck, throws its handful, and
						// leaves the rest of the tank alone. Below a
						// threshold the poke goes `still` outright, which is
						// the flag that means "draw the ripple, claim no
						// energy".
						// …AND ONLY WHERE THERE IS SKY TO PUT IT. Scaling by
						// the wave's appetite fixed the tank trembling in
						// general; at the very top of the range it still
						// read as turbulence, because a jar with two cells
						// of air has nowhere to put even a small claim and
						// every bit of it comes back as chop across the
						// whole surface. A wave arriving at a brim-full jar
						// LAPS the wall: it rings where it struck, and the
						// tank does not answer.
						const room2 = Math.min(1, restSeen / (h * 0.22));
						const bite2 = Math.min(1, sp / 3) * room2;
						pokes.push({ x: wv.x, y: null, t: f.now,
							still: bite2 < 0.5, hue: wv.hue });
						agitLevel = Math.min(0.75,
							agitNow(f.now) + (0.04 + left * 0.10) * bite2);
						agitAt = f.now;
					}
					if (age > WAVE_LIFE || (wv.broke && age > WAVE_LIFE * 0.4)) {
						waves.splice(i, 1);
					}
				}

				// CLASHING. Two waves running at each other meet somewhere
				// between the hands that made them, and water meeting water
				// head-on goes straight up — which is the one place in this
				// tank a column of spray is physically owed rather than
				// decorative. Both waves spend themselves in it, so a clash
				// is an ending rather than a pass-through: click left, click
				// right, and the answer arrives in the middle.
				for (let i = waves.length - 1; i >= 0; i--) {
					for (let j = i - 1; j >= 0; j--) {
						const a = waves[i], b = waves[j];
						if (!a || !b || a.broke || b.broke) continue;
						if (a.dir === b.dir) continue;
						if (Math.abs(a.x - b.x) > CELL * 2.2) continue;
						// Only if they are CLOSING: two waves that have
						// already passed through each other are moving
						// apart and must not clash a second time.
						if ((b.x - a.x) * a.dir < 0) continue;
						const mid = (a.x + b.x) / 2;
						const ageA = a.born ? (f.now - a.born) / 1000 : 0;
						const ageB = b.born ? (f.now - b.born) / 1000 : 0;
						const force = Math.exp(-ageA / (WAVE_LIFE * 0.55))
							+ Math.exp(-ageB / (WAVE_LIFE * 0.55));
						spray(mid, 6 + Math.round(force * 11), 0, (a.hue + b.hue) / 2);
						if (pokes.length >= POKES_MAX) pokes.shift();
						pokes.push({ x: mid, y: null, t: f.now, still: false,
							hue: (a.hue + b.hue) / 2 });
						agitLevel = Math.min(0.95, agitNow(f.now) + 0.08 + force * 0.16);
						agitAt = f.now;
						waves.splice(i, 1);
						waves.splice(j, 1);
						i = Math.min(i, waves.length);
						break;
					}
				}
			}
		};

		const drawOrb = (f: WsJarFrame) => {
			// ── THE ORB: spin, shed, collapse ─────────────────────────────
			// `want` TOO, and this is what stopped the ball forming at all.
			// The easing that carries `amount` toward `want` lives inside
			// this block — so on the first click, with amount still 0, the
			// block was skipped, amount never moved off 0, and the gate
			// stayed shut forever. A click asked for water and nothing
			// listened. The gate has to open on the ASK, not on the arrival.
			if (orb.amount > 0.001 || orb.want > 0.001) {
				// INERTIA. The ball keeps turning after the last click and
				// slows on its own clock — clicking faster winds it up,
				// stopping lets it run down. Same shape as the agitation
				// store above, and for the same reason: a maximum cannot
				// build, and building is the whole feel of this.
				orb.vel *= Math.pow(0.36, f.dt);
				orb.spin += orb.vel * f.dt;
				// The ball EASES toward what the clicks asked for, so water
				// takes a moment to arrive and the size never snaps.
				if (!orb.falling) {
					// LOSS COMES FROM THE SPIN, AND ONLY FROM THE SPIN. A spinning body
					// throws water off its rim, which is the whole reason there is a leak;
					// a still one is just water being held, and water being held does not
					// evaporate — so a ball that has stopped turning can be KEPT. Squared,
					// so a lazy turn barely loses anything and only a fast one really
					// bleeds; and proportional to its own size, so a big ball loses more in
					// absolute terms than a bead and the two do not decay at the same rate.
					const spinN = Math.min(1, Math.abs(orb.vel) / ORB_SPIN_CAP);
					const spinLoss = spinN * spinN * 1.6;
					orb.want = Math.max(0, orb.want
						- ORB_LEAK * spinLoss * f.dt * (0.35 + orb.want * 0.65));
					orb.amount += (orb.want - orb.amount) * Math.min(1, ORB_RATE * f.dt);
					// The water it loses is not deleted: it goes back where
					// it came from, as spray the surface will catch.
					if (orb.want > 0.02 && orb.vel > 0.8
						&& drops.length < DROPS_MAX && Math.random() < 0.5) {
						const a = Math.random() * Math.PI * 2;
						const R2 = orbR();
						drops.push({
							x: orb.x + Math.cos(a) * R2,
							y: orb.y + Math.sin(a) * R2,
							vx: Math.cos(a) * 26 + (Math.random() - 0.5) * 30,
							vy: Math.sin(a) * 20 + 25,
							life: 0,
							shed: true,
							hue: hueNow() + (Math.random() - 0.5) * 70,
							size: 1,
							shape: Math.floor(Math.random() * 4)
						});
					}
				}

				// LETTING GO. No click for a moment and the ball gives the water back
				// — `falling` drains `amount` fast, and every frame of that drain is
				// water rejoining the tank, because the line is drawn from
				// (1 - amount). The splash is thrown once, at the moment it lets go,
				// not per frame. LET GO MEANS LET FALL: water does not dissolve where
				// it hangs, it drops, gathers speed, and bursts WHERE IT LANDS. So the
				// strike points, the spray and the bounce all start from the impact
				// rather than from wherever the pointer had been — and releasing it
				// high above the line is worth something, because it has further to
				// fall.
				if (!orb.falling && !orb.dropping && f.now - orb.last > ORB_IDLE) {
					orb.dropping = true;
					orb.vy = 0;
				}
				// IT MAY GO IN, AND THE WATER ANSWERS. A previous build
				// forbade it — the ball was clamped to sit on the line —
				// because a sphere drawn over the liquid, displacing
				// nothing, is the one arrangement that cannot be read as
				// physical. Forbidding it fixed the wrong half: the fault
				// was never that the ball went in, it was that the water
				// did not notice. It notices now (see the displacement term
				// in the surface sum), so the ball is free again and only
				// the ceiling is kept — a ball is not held above the jar.
				if (!orb.dropping && !orb.falling) {
					const rr2 = orbR() * (1 + orbEcc());
					if (orb.y - rr2 < 0) orb.y = rr2;
				}
				if (orb.dropping) {
					// One rate: the ball no longer tears, so there is no `torn` branch.
					orb.vy += 780 * f.dt;
					orb.y += orb.vy * f.dt;
					// The water it is falling toward, under its own middle.
					const col = Math.max(0, Math.min(cols - 1, Math.round(orb.x / CELL)));
					const surf = surfaceNow ? (surfaceNow[col] || h) : h;
					// A torn ball never lands whole — it is already gone.
					if (orb.y + orbR() >= surf || orb.y >= h) {
						orb.dropping = false;
						orb.last = 0;
					}
				}
				if (!orb.falling && !orb.dropping && f.now - orb.last > ORB_IDLE) {
					// IT BURSTS, THEN THE JAR FILLS. The old collapse simply
					// ran `amount` down, so the level slid back up while
					// nothing else happened — the vault's "the growing
					// animation just starts instead of water splashing".
					// The ball comes apart FIRST: every bit of it is thrown
					// as a blob, the surface is struck in several places at
					// once, and the level is left to arrive behind the spray
					// with a bounce on the end of it.
					orb.falling = true;
					orb.dropping = false;
					orb.vy = 0;
					orb.want = 0;
					// A ball that TORE throws harder than one that was set
					// down: it came apart under its own spin, and that
					// energy has to go somewhere.

					// EVERYTHING SCALES WITH WHAT WAS HELD, harder than linearly: a small
					// ball makes a small splash and only a full one makes the storm, and
					// raised to 1.6 a tenth of a jar throws about 3% of a full one's spray
					// rather than 10%, so the small ones nearly vanish and the big ones
					// commit. SIZE TELLS, AND SO DOES THE JAR: `orb.amount` is a share of
					// the TANK, so the same share out of a nearly full jar is far more
					// water than out of a half one. The level is folded in, so a big ball
					// dropped into a deep jar is the loudest thing the gauge does and the
					// same gesture at 50% is markedly quieter.
					const held = Math.pow(orb.amount, 1.6) * (0.55 + rNow * 0.9);
					agitLevel = Math.min(2.4, agitNow(f.now) + 0.03 + held * 2.6);
					agitAt = f.now;
					// The bounce used to start HERE, at the impact — so it was
					// oscillating while the water was still in the air. It
					// is armed instead for the moment the air is nearly
					// home, which is when the jar actually gets its mass
					// back and the only moment a settle means anything.
					splashAmp = held * 0.17;
					splashAt = 0;   // armed by the air landing, above
					// EVERYTHING IT HELD GOES UP, NOT STRAIGHT INTO THE JAR.
					airborne = Math.min(1, airborne + orb.amount);
					const heavy = Math.min(DROPS_MAX - drops.length,
						1 + Math.round(held * 44));
					for (let k = 0; k < heavy; k++) {
						const a = Math.random() * Math.PI * 2;
						const r = orbR() * (0.25 + Math.random() * 0.75);
						drops.push({
							x: orb.x + Math.cos(a) * r,
							y: orb.y + Math.sin(a) * r,
							// OUTWARD IN EVERY DIRECTION, and hard. It threw at
							// 40–160 with a slight upward lean, which
							// gravity flattened almost at once — so a burst
							// read as the ball FALLING rather than as it
							// coming apart. Doubled outward, and the
							// vertical component is biased up rather than
							// centred, so the crown opens before it drops.
							vx: Math.cos(a) * (90 + Math.random() * 210) + orb.vel * 12,
							vy: Math.sin(a) * 130 - 120 - Math.random() * 90,
							life: 0,
							shed: true,
							hue: hueNow() + (Math.random() - 0.5) * 90,
							size: 1 + (Math.random() < 0.6 ? 1 : 0),
							shape: Math.floor(Math.random() * 4)
						});
					}
					// STRUCK IN AS MANY PLACES AS IT IS BIG. A body of water landing
					// disturbs the surface around it, and how far around is how much of it
					// there was — one ripple for a bead, the whole width for a tankful.
					// The strikes are spread about the point the ball fell from rather
					// than evenly across the jar, because that is where it landed; the
					// reach grows with the amount. AND IT BURSTS ALONG THE SURFACE: a body
					// of water landing does not only throw upward, it shoves the water
					// sideways. Two travelling waves out of the landing point, one each
					// way, so the burst races to both walls and breaks there — the same
					// code a click uses, which is why this costs nothing and cannot look
					// like a different feature. Their height rides the SAME capped stack
					// the click waves do, so a big drop cannot put the surface over the
					// ceiling.
					for (const dir of [-1, 1]) {
						if (waves.length >= WAVES_MAX) waves.shift();
						waves.push({
							x: orb.x,
							dir,
							born: 0,
							amp: waveAmp() * (0.9 + held * 1.7),
							wid: 1500,
							spd: 250 + held * 90,
							hollow: 0.5,
							spray: 2,
							hue: hueNow() + (Math.random() - 0.5) * 60,
							broke: false
						});
					}
					const hits = 1 + Math.round(held * 4);
					const reach = w * (0.08 + held * 0.42);
					for (let k = 0; k < hits; k++) {
						if (pokes.length >= POKES_MAX) pokes.shift();
						const off = hits === 1 ? 0
							: ((k / (hits - 1)) - 0.5) * 2 * reach;
						pokes.push({
							x: Math.max(0, Math.min(w, orb.x + off)),
							y: null,
							// Spread in TIME as well as space: the middle
							// lands first and the edges follow, which is
							// what a mass hitting water does and what a
							// simultaneous row of ripples never looks like.
							t: f.now + Math.abs(off) / (w * 0.9) * 260,
							still: false,
							hue: hueNow() + (Math.random() - 0.5) * 120
						});
					}
				}
				if (orb.falling) {
					// Faster than it gathered, and it should be: this is
					// falling, not being lifted.
					// A small ball is gone in a blink; a full one takes the
					// moment its size deserves.
					orb.amount = Math.max(0, orb.amount - f.dt * (3.0 + 2.5 * (1 - orb.amount)));
					orb.vel *= Math.pow(0.05, f.dt);
					if (orb.amount <= 0.001) { orb.amount = 0; orb.vel = 0; orb.falling = false; }
				}

				// SHEDDING. A spinning ball of water does not hold itself
				// together at the rim: blobs fly off tangentially while it
				// turns, and the faster it turns the more it throws. This
				// is where "swirly ball that splashes blobs and pixels"
				// lives — the drops pool already knows how to draw a lump
				// that comes apart in flight, so the orb only has to hand
				// it the right velocity.
				if (!orb.falling && orb.vel > 1.2 && f.now - orbShedAt > ORB_SHED * 1000
					&& drops.length < DROPS_MAX) {
					orbShedAt = f.now;
					const R = orbR();
					const a = orb.spin + Math.random() * 0.9;
					drops.push({
						x: orb.x + Math.cos(a) * R,
						y: orb.y + Math.sin(a) * R,
						// TANGENTIAL, not radial: thrown along the turn, the
						// way anything leaving a spinning body goes.
						vx: -Math.sin(a) * orb.vel * R * 0.55,
						vy: Math.cos(a) * orb.vel * R * 0.55 - 20,
						life: 0,
						shed: true,
						hue: hueNow() + (Math.random() - 0.5) * 80,
						size: Math.random() < 0.4 ? 2 : 1,
						shape: Math.floor(Math.random() * 4)
					});
				}

				// THE BALL ITSELF, in the tank's own cells. Spiral bands
				// rather than a disc: the angle is offset by the radius, so
				// the pattern winds outward and the whole thing reads as
				// turning instead of merely being round. Every cell is
				// snapped to the lattice and dithered at the edge, so it is
				// made of the same stuff as the water below it.
				const R = orbR() * (1 + orbEcc());
				if (R > CELL) {
					const cx = orb.x, cy = orb.y;
					const g0 = Math.max(0, Math.floor((cx - R) / CELL));
					const g1 = Math.min(cols - 1, Math.ceil((cx + R) / CELL));
					const r0 = Math.max(0, Math.floor((cy - R) / CELL));
					const r1 = Math.min(rows - 1, Math.ceil((cy + R) / CELL));
					for (let gy = r0; gy <= r1; gy++) {
						for (let gx = g0; gx <= g1; gx++) {
							const px2 = gx * CELL + CELL / 2;
							const py2 = gy * CELL + CELL / 2;
							const dx2 = px2 - cx, dy2 = py2 - cy;
							const rr = Math.hypot(dx2, dy2);
							// Against the DEFORMED edge at this angle, not a
							// circle: the equator swells and the poles pull
							// in, so the outline turns with the spiral
							// instead of the spiral turning inside a stencil.
							const angC = Math.atan2(dy2, dx2);
							const Rh = orbRAt(angC);
							if (rr > Rh) continue;
							const u = rr / Rh;
							// The rim frays: an ordered threshold rising with
							// u breaks the circle's edge into cells instead
							// of drawing a hard curve, the way the water's
							// own edge is broken.
							const thr = (((gx * 7 + gy * 13) % 16) / 16);
							if (u > 0.72 && (u - 0.72) / 0.28 > 1 - thr) continue;
							const ang = angC;
							// The spiral: angle carried by the spin, wound by
							// the radius. Two arms, so the turn is legible
							// at a glance rather than hypnotic.
							// `arm`, NOT `band`: `band()` is the tank's own
							// lightness quantiser, live in this scope, and
							// shadowing it here would have silently replaced
							// a function with a number for the rest of the
							// block. Caught before it shipped; named apart so
							// it cannot come back.
							const arm = Math.sin(ang * 2 + orb.spin * 2.2 - u * 5.5);
							// TWO TONES WAS THE WHOLE PALETTE. `arm > 0.15`
							// threw a continuous spiral away and kept one
							// bit of it, so a ball made of a few hundred
							// cells was painted in exactly two colours —
							// which is why it read as a striped disc rather
							// than as a body of water turning.
							//
							// The arm is kept as the NUMBER it is now, and
							// three things are drawn from it. The hue walks
							// a span of the ramp, so the spiral is a
							// gradient of the water's own colour rather than
							// a pair of stripes. Depth adds to it — the
							// centre of a sphere of water is not the colour
							// of its edge — and a small ordered dither per
							// cell breaks the bands into the lattice
							// everything else in this tank is made of.
							const dith = (((gx * 7 + gy * 13) % 8) / 8 - 0.5);
							const litness = (arm + 1) * 0.5;
							// THE BALL IS MADE OF THE WATER'S OWN COLOURS. The water itself is
							// ONE hue, hueNow(), with about fifteen degrees of drift for depth,
							// time and caustics (see the cell shading above). The ball is made of
							// that water, so it takes the same hue and the same size of drift —
							// the spiral and the depth move it a few degrees, not across the
							// spectrum. (Walking the ramp across the ball would paint every colour
							// the jar had on its way up, none of which the liquid is currently
							// wearing: purple in a cyan jar.)
							const oh0 = hueNow() + arm * 9 + (0.5 - u) * 10 + dith * 4;
							// THE AURORA TWIRLS INSIDE IT. When the light is
							// up, the ball is not a differently-coloured
							// object floating in front of it — it is the
							// same field, sampled in the ball's OWN turning
							// frame. The sample point is rotated by the spin
							// about the orb's centre, so the curtains wind
							// round inside the sphere and travel with it;
							// mixed by auroraMix, so a jar that has not lit
							// yet gets the plain water ball it had before.
							let oh = oh0;
							if (f.auroraMix > 0.01) {
								const ca = Math.cos(orb.spin), sa = Math.sin(orb.spin);
								const ru = (dx2 * ca - dy2 * sa) / w;
								const rv = (dx2 * sa + dy2 * ca) / h;
								// THE HUE, OUT OF THE COLOUR. `auroraCell` answers an `hsla(...)`
								// string, and `isFinite` of a string that starts with a letter is
								// false — the hue has to be taken out of it before the orb can lean
								// toward the aurora's.
								const cellCol = auroraCell(0.5 + ru, 0.5 + rv, f.t);
								const cellM = /^hsla?\((-?[\d.]+)/.exec(String(cellCol || ''));
								const cellHue = cellM ? parseFloat(cellM[1]) : NaN;
								if (isFinite(cellHue)) {
									oh = oh0 + (cellHue - oh0) * f.auroraMix;
								}
							}
							ctx.fillStyle = 'hsla(' + Math.round(oh) + ','
								// Saturation follows the spiral too: the
								// bright side of a turning body is the
								// washed-out one, the shadowed side holds
								// its colour.
								+ Math.round(Math.max(0, baseSat - 4 - litness * 16)) + '%,'
								// Quantised through band(), like every other
								// lightness in the jar, so the gradient
								// arrives in the tank's own steps instead of
								// as a smooth wash that would be the one
								// un-pixelated thing on screen.
								+ band(Math.min(96, baseLig + 6 + litness * 30 + (0.5 - u) * 10)) + '%,'
								// NEARLY SOLID. It ran 0.50 at the rim to 0.92 at the
							// centre, which on a dark theme let the tank show
							// through the whole ball and left it looking like a
							// stain rather than like water lifted out. A body of
							// water is not translucent to its own tank. 0.86 at
							// the rim, 0.99 at the centre — the little that is
							// left is what keeps the rim from reading as a hard
							// cut. Still short of 0.95 flat: that exact alpha is
							// spray's signature here, and an orb cell wearing it
							// would be indistinguishable from a bead.
							+ (0.86 + (1 - u) * 0.13).toFixed(2) + ')';
							ctx.fillRect(gx * CELL, gy * CELL, CELL, CELL);
						}
					}
				}
			}
		};

		const drawDrops = (f: WsJarFrame) => {
			if (drops.length) {
				// NEAR-WHITE, deliberately past the crest. The old fill sat
				// at +30 lightness against crests at +34 — spray drawn in
				// the surface's own colour is spray that cannot be seen
				// over it. A bead in flight is a point of light.
				const sprayFill = 'hsla(' + Math.round(hueNow()) + ','
					+ Math.round(Math.max(0, baseSat - 24)) + '%,'
					+ band(Math.min(100, baseLig + 44)) + '%,0.95)';
				ctx.fillStyle = sprayFill;
				for (let i = drops.length - 1; i >= 0; i--) {
					const d = drops[i];
					// A BLOB MAY CARRY ITS OWN COLOUR. Spray from the pour
					// is the meniscus's near-white and stays that way, but
					// water pulled into the ball or thrown out of it takes a
					// hue off the ramp — the vault's "the blobs only have
					// that meniscus colour". Set per drop, so one flight can
					// hold a dozen shades at once.
					if (d.hue != null) {
						// Lightness and saturation jitter with the hue, or a
						// row of differently-hued beads at one lightness
						// reads as a palette swatch rather than as spray.
						// Seeded off the drop's own shape so a bead does not
						// shimmer as it flies.
						const j = ((d.shape || 0) * 7 % 5) / 5 - 0.4;
						ctx.fillStyle = 'hsla(' + Math.round(d.hue) + ','
							+ Math.round(Math.max(0, baseSat - 6 + j * 18)) + '%,'
							+ band(Math.min(100, baseLig + 30 + j * 14)) + '%,0.95)';
					} else {
						ctx.fillStyle = sprayFill;
					}
					d.vy += 900 * f.dt;
					d.x  += d.vx * f.dt;
					d.y  += d.vy * f.dt;
					d.life += f.dt;
					const col = Math.max(0, Math.min(cols - 1, Math.round(d.x / CELL)));
					const floorY = f.surfaceY ? f.surfaceY[col] : h;
					// A BLOB LEAVING THE BALL GETS A MOMENT. The floor rule
					// culls anything falling that has reached the water, and
					// an orb hanging BELOW the waterline — which is most
					// places you might click — spawns every blob already
					// under it, so they died on the frame they were born and
					// the ball threw nothing at all. A shed blob is water
					// leaving a body of water; it is entitled to the instant
					// it takes to get out. 0.15s, and only for blobs the orb
					// threw: spray from the pour and the splash keeps the
					// old rule exactly.
					const graced = d.shed && d.life < 0.15;
					const landed = !graced && d.vy > 0 && d.y >= floorY;
					if (d.life > 1.4 || d.x < -CELL || d.x > w || landed) {
						// A BLOB THAT LANDS MAKES A RING. Every returning blob strikes the
						// surface it fell into, so the second half of a splash is dozens of
						// small rings arriving out of time with each other; spray that simply
						// ceased at the waterline would read as an effect rather than as an
						// event. That is most of what makes real water look like water, and it
						// costs one poke. Fast blobs only, and only while there is room in the
						// ring pool: a bead dribbling over the edge of the crest has not struck
						// anything. ORB-THROWN BLOBS ONLY (`d.shed`): the pour is a tuned
						// sequence that ends still, and a jar that rings its own spray never
						// finishes settling; this belongs to the thing the writer is doing, not
						// to the thing the jar does on its own. THROTTLED, and not by the
						// pool's size: the pool evicting its oldest is not a brake — it keeps
						// the surface permanently full of new ripples instead of letting it
						// settle between them. One ring every 70ms is enough for a splash to
						// read as many arrivals and few enough that the water can breathe.
						if (landed && d.shed && !d.pull && d.vy > 90
							&& f.now - lastRingAt > 55 && pokes.length < POKES_MAX) {
							lastRingAt = f.now;
							pokes.push({
								x: d.x,
								y: null,
								t: f.now,
								// A RING IS LOCAL, NOT ENERGY. This is the
								// tremor, and throttling could never have
								// fixed it: pokeEnergy is a MAXIMUM over the
								// pokes decaying on a 620ms clock, so a ring
								// arriving every 70ms held it at 0.89 and one
								// every 300ms still held it at 0.62 — the
								// whole surface pinned at full agitation for
								// as long as any spray was falling. Worst at
								// a high level, where the water above the
								// rest line is shallow and a maxed amplitude
								// has nowhere to go but sideways, fast.
								//
								// `still` is what a poke uses to say "the
								// aurora's, not the water's" — pokeEnergy
								// skips it while the ripple sum still draws
								// it. A landing ring wants exactly that
								// bargain: a visible ring where it fell, and
								// no claim on how lively the whole tank is.
								still: true,
								// The ring carries the blob's own colour, so
								// a coloured splash lands coloured.
								hue: d.hue != null ? d.hue : hueNow()
							});
						}
						drops.splice(i, 1);
						continue;
					}
					// DITHERED, like everything else in the tank. A drop drawn
					// solid is a hard little square travelling over a
					// surface built entirely from ordered patterns — it
					// reads as a sprite laid on the water rather than as
					// part of it. Its own cell decides its strength, and
					// the older it is the more of the pattern shows
					// through, so spray thins out as it flies instead of
					// vanishing at a fixed age.
					const dx = Math.round(d.x / CELL) * CELL;
					const dy = Math.round(d.y / CELL) * CELL;
					const dthr = (((dx / CELL | 0) * 7 + (dy / CELL | 0) * 13) % 16) / 16;
					if (1 - d.life / 1.4 <= dthr) continue;
					// THE BLOB'S OWN CELLS. Offsets rather than a scaled
					// rect: a 3-cell lump is a plus, an L, a stubby bar or
					// a clump, and which one it is was rolled when it was
					// thrown so it does not change in flight. A lump also
					// SHEDS as it flies — the outer cells drop off with
					// age — so spray comes apart on the way up instead of
					// vanishing whole.
					const sz = d.size || 1;
					ctx.fillRect(dx, dy, CELL, CELL);
					if (sz > 1) {
						const keep = 1 - d.life / 1.4;
						const arms = BLOB_SHAPES[(d.shape || 0) % BLOB_SHAPES.length];
						const take = sz === 3 ? arms.length : Math.min(2, arms.length);
						for (let a = 0; a < take; a++) {
							// Each arm has its own threshold, so a lump
							// loses cells one at a time rather than all at
							// once — and always the same ones, since the
							// order is fixed.
							if (keep < (a + 1) / (take + 1) * 0.85) continue;
							ctx.fillRect(dx + arms[a][0] * CELL,
								dy + arms[a][1] * CELL, CELL, CELL);
						}
					}
				}
			}
		};

		const drawAurora = (f: WsJarFrame) => {
			// IT STARTS AT THE SURFACE AND SINKS. Turning the whole tank at
			// once, evenly scattered, read as static settling over the
			// water rather than as light entering it. The lights now
			// appear along the CREST — which is where they would — and the
			// front travels down as the last of the pour goes in, so the
			// jar keeps filling while the aurora takes it.
			//
			// Each cell is still water OR aurora, never a blend of both:
			// the ordered dither is what softens the front's edge, and it
			// is the only thing pixel art can use in place of a fade.
			if (f.auroraMix > 0 && f.surfaceY) {
				for (let gx = 0; gx < cols; gx++) {
					const top   = f.surfaceY[gx] != null ? f.surfaceY[gx] : 0;
					// How far the light has reached below this column's crest. Eased so
					// it moves quickly through the bright water near the top and slows in
					// the depths. WELL PAST THE FLOOR: the dither's soft edge is six cells
					// deep, so a front that stops AT the base leaves the last six rows
					// below their threshold for ever — a band of plain water at the bottom
					// of a finished jar. FROM THE REST LINE, NOT THE CREST: measured from
					// this column's wavy top the front's progress is a function of the
					// wave, lurching deeper whenever a crest peaks, and with the reach
					// held monotonic those lurches never come back — the curtain descends
					// in steps and swallows parts of the wave in single frames. `restNow`
					// is the flat level the water is oscillating ABOUT, so the front
					// travels smoothly whatever the surface is doing. The monotonic hold
					// stays: it guarantees the dissolve's own rule, that a cell which has
					// turned stays turned.
					if (!auroraFront || auroraFront.length !== cols) {
						auroraFront = new Array<number>(cols).fill(-Infinity);
					}
					const from  = Math.min(top, f.restNow);
					const reach = from + (h + CELL * 12 - from) * (f.auroraMix * f.auroraMix);
					if (reach > auroraFront[gx]) auroraFront[gx] = reach;
					const front = auroraFront[gx];
					for (let gy = 0; gy < rows; gy++) {
						const y = gy * CELL;
						if (y + CELL <= top) continue;   // above the water
						// A stable per-cell threshold in [0,1). The pair of primes keeps the
						// pattern from lining up with the grid, which would dissolve in
						// visible stripes. THE LIGHT ARRIVES FROM SEVERAL PLACES AT ONCE: one
						// ordered pattern over the whole tank comes down as a single even veil
						// — correct, and lifeless — where real light entering water finds it
						// in patches, some of which run ahead of the rest. A few slow standing
						// lobes are folded into the threshold, so some regions turn early and
						// others hold out, and the boundary between them wanders. The pattern
						// is still the same ordered dither underneath, which is what keeps it
						// pixel art rather than a soft gradient. `p1` and the seeds are the
						// pour's own, so the lobes fall differently for every jar and nobody
						// learns where the light will start.
						const seedX = gx * CELL / w, seedY = gy * CELL / h;
						const lobes =
							Math.sin(seedX * 5.1 + p1) * 0.16
							+ Math.sin(seedY * 3.7 - p2 + seedX * 2.2) * 0.12
							+ Math.sin((seedX + seedY) * 4.3 + p3) * 0.09;
						const thr  = Math.max(0, Math.min(1,
							(((gx * 7 + gy * 13) % 16) + 0.5) / 16 + lobes));
						// Depth into the lit band, so the dither only scatters at the FRONT:
						// well above it every cell has turned, below it none has. A WIDE, SOFT
						// EDGE: over three cells the scatter is a hard line with a few stray
						// pixels on it; over six the front reads as light SOAKING down rather
						// than a boundary moving. And the cells at the edge are drawn
						// part-strength — still one colour per cell, chosen per cell, but the
						// aurora's own alpha eased in — so the join with the water underneath
						// is a gradient of COVERAGE rather than a change of state.
						const into = (front - y) / Math.max(CELL * 6, 1);
						if (into <= thr) continue;
						// QUANTISED, like everything else in this tank. This
						// was a continuous alpha over a palette built
						// entirely from steps: every frame it changed by a
						// hair, so each cell at the front was composited a
						// fraction differently over water that is itself
						// moving — which is what "flickers when it starts
						// dithering down" was. On eighths a cell holds its
						// value for many frames and then steps once.
						// HELD, NOT SET. This wrote ctx.globalAlpha
						// directly and the fade below then had to juggle
						// a save/restore around it — see the note at the
						// fill. It is a plain number now, multiplied with
						// the cell's own fade at the one place the cell
						// is drawn.
						const depthA = quantA(Math.min(1, 0.35 + into * 0.9));
						// THE SWIRL. The lights are read from a point that is
						// dragged toward the middle of the jar and turned
						// slowly around it, so as the aurora arrives the
						// colours are pulled inward rather than simply
						// switched on where they stand. Strongest as the
						// front passes and easing off behind it, which is
						// what makes it read as a current rather than a
						// wobble.
						const u = gx / cols - 0.5, v2 = gy / rows - 0.5;
						const rad  = Math.sqrt(u * u + v2 * v2);
						// THE SWIRL BREATHES. It used to wind one way for
						// ever, which settles into a texture the eye stops
						// reading after a second. A slow sine on the
						// strength winds it in, unwinds it, and takes it
						// round the OTHER way — the current keeps changing
						// its mind, which is what a current does.
						const turn = Math.sin(f.t * 0.42 + swirlPhase);
						const pull = (1 - Math.min(1, rad * 2)) * 0.30 * f.auroraMix;
						const ang  = Math.atan2(v2, u) + turn * 1.1 * pull;
						// The inward drag breathes with it, so the colours
						// are pulled in as it winds and released as it
						// unwinds rather than staying permanently gathered.
						const draw = pull * (0.55 + 0.45 * Math.abs(turn));
						// `let`, not `const`: the poke loop below bends
						// these — a press on the lit jar winds the colour
						// field around the point pressed.
						let su   = 0.5 + Math.cos(ang) * rad * (1 - draw);
						let sv   = 0.5 + Math.sin(ang) * rad * (1 - draw);
						// AND THE CELL ITSELF FADES IN. A cell that had
						// crossed its threshold went straight to full
						// aurora, so the front was a scatter of opaque
						// cells over untouched water — crunchy, and
						// nothing like light entering. Each now arrives
						// over its own short ramp, quantised to eight
						// steps so it is still pixel art and not a
						// gradient: the ladder is what keeps the two
						// readings apart.
						const fade = quantA(Math.min(1, (into - thr) * 2.2));
						if (fade <= 0) continue;
						// ONE ALPHA, MULTIPLIED, AND HANDED BACK AT 1.
						// This is where "still flickers" lived. The old
						// code SET globalAlpha to the depth value, then
						// REPLACED it with the fade (so the two never
						// combined), and after the fill ran
						//   globalAlpha = 1; if (fade < 1) globalAlpha = prevA;
						// — a restore written backwards. Whenever the
						// LAST cell of the pass was an edge cell, the
						// context left the frame carrying that cell's
						// alpha instead of 1, and nothing else in the
						// gauge ever writes globalAlpha — so the NEXT
						// frame painted the entire tank, water and all,
						// through whatever fraction the dither happened
						// to end on. That fraction changed frame to
						// frame, which is exactly a full-jar strobe.
						// Depth and fade are one multiplied alpha now,
						// applied for the fill and returned to 1 right
						// after it, unconditionally.
						ctx.globalAlpha = Math.min(1, depthA * fade);
						// WHILE IT IS MIXING, each cell takes a hue near the aurora's rather
						// than exactly it — a scatter that shrinks to nothing as the water
						// calms, so the jar resolves INTO the aurora instead of cutting to it.
						// The offset is per cell and stable frame to frame (the same ordered
						// value the dither uses), or the whole tank would fizz. PLUS whatever
						// the writer has stirred in: a poke's colour spreads from where it
						// landed and fades with distance and with age, so a press on a lit jar
						// puts a bloom of another hue into the aurora rather than nudging the
						// surface and doing nothing visible.
						let rot = 0;
						// The press's two answers, gathered over every poke
						// and BOUNDED AS A SET before they are used — a run
						// of presses in one place otherwise stacks into a
						// white patch, which is the lesson this gauge has
						// now learned in the waves, the poke rings and the
						// ink humps alike.
						let phase = 0, fire = 0;
						if (f.auroraJitter > 0.01) {
							const j = ((gx * 11 + gy * 17) % 32) / 32 - 0.5;
							rot += j * 220 * f.auroraJitter;
						}
						// THE BALL WINDS THE LIGHT IN TOO — and this line is
						// why the aurora went dark. It read `hold`, a
						// variable the orb rewrite deleted, so the whole
						// aurora pass threw a ReferenceError on its first
						// cell and drew nothing at all. The lesson: a
						// name that survives its owner takes down whatever
						// reads it, and the failure looks like a feature
						// that "stopped working" rather than like a crash.
						//
						// It does what it was written to do, driven by the
						// ball instead: the field's sample point is rotated
						// about the orb, hardest at its centre, so the
						// curtains wind into the vortex the water is being
						// gathered into. The spin carries it, so the light
						// turns with the ball rather than merely bending
						// toward it.
						if (orb.amount > 0.01) {
							const cu = orb.x / w, cv = orb.y / h;
							const du = su - cu, dv = sv - cv;
							const dd = Math.hypot(du, dv);
							const sw = Math.exp(-dd * 6) * orb.amount * 3.2
								+ orb.spin * Math.exp(-dd * 9) * 0.35;
							if (Math.abs(sw) > 0.03) {
								const ca = Math.cos(sw), sa = Math.sin(sw);
								su = cu + du * ca - dv * sa;
								sv = cv + du * sa + dv * ca;
							}
						}
						// NEWEST PRESS WINS. The nudges and flares of every
						// live poke were simply added, bounded only as a
						// total — so four presses in four places all shouted
						// at once and the field became busy wherever the
						// reader had recently been. `newest` is the age of
						// the most recent one; an older poke is damped by
						// how far behind it that leaves it, so clicking
						// around the jar reads as MOVING one's attention
						// rather than as piling four presses on top of each
						// other. A single press is untouched (it is the
						// newest), which is why the gesture the vault
						// approved is unchanged.
						let newest = 1e9;
						for (const pk of pokes) {
							if (pk.hue == null) continue;
							const a2 = (f.now - pk.t) / 1000;
							if (a2 < newest) newest = a2;
						}
						for (const pk of pokes) {
							if (pk.hue == null) continue;
							const age = (f.now - pk.t) / 1000;
							if (age > 2.4) continue;
							// How far behind the newest this one is: level
							// with it, it keeps all its voice; a second
							// older, about a third of it.
							const yield2 = 1 / (1 + Math.max(0, age - newest) * 2.2);
							// ROUND, NOT A COLUMN. With only x recorded, the
							// bloom coloured the jar's full height under the
							// finger — a stripe, not an injection. The press
							// records y now, so the colour spreads from the
							// POINT pressed; pokes from before y existed fall
							// back to the column read rather than throwing.
							const d = pk.y != null
								? Math.hypot(gx * CELL - pk.x, y - pk.y)
								: Math.abs(gx * CELL - pk.x);
							const reach = Math.exp(-d / 46) * Math.exp(-age / 1.5);
							if (reach < 0.02) continue;
							// THE BLOOM IS BOUNDED. Each press injects the DIFFERENCE between its
							// hue and the water's, which can be most of the wheel; summed over
							// every live poke with no ceiling, four presses could rotate a cell by
							// several hundred degrees and the colours would tear around. It yields
							// to the newest press like everything else the loop gathers, and the
							// TOTAL is capped below, so a run of presses tints the light instead of
							// spinning it.
							rot += (pk.hue - hueNow()) * reach * yield2;
							// …AND IT SWIRLS WHERE IT LANDED. The injected colour is stirred in,
							// not stamped on: the field's sample point is rotated about the press,
							// hardest at the centre and dying with distance and age, so the
							// curtains wind into a little vortex there and let go over a couple of
							// seconds. This is the whole answer a press on a FULL jar gets — the
							// water has nowhere to go, so the light moves instead — and on a
							// part-lit jar it simply rides along with the ripple the same press
							// still makes. WHAT A PRESS DOES: it nudges the field's PHASE and it
							// IGNITES the curtains, and it moves nothing — a displacement drags a
							// cell across several features of a quantised field and it snaps,
							// never shades.
							if (pk.y != null) {
								const cu = pk.x / w, cv = pk.y / h;
								const du = su - cu, dv = sv - cv;
								const dd = Math.hypot(du, dv);
								// THE RIPPLE RUNS OUT THROUGH THE CURTAINS. The nudge's phase is the
								// DISTANCE from the press less the time since it — so the crest of it
								// travels outward, which is the flaming a real aurora does, rather
								// than the whole region shifting together. At these numbers it moves
								// the same amount of picture as the rotation does with less than half
								// the worst per-cell jump: same presence, half the violence.
								const trav = dd * 7.5 - age * 2.4;
								// It swells and lets go on one smooth
								// envelope, and both ends are zero: the
								// press does not begin or finish with a
								// step. This is the part the earlier
								// versions got right and it is kept.
								const grip = Math.min(1, age / 0.3)
									* Math.exp(-age / 1.7);
								phase += Math.sin(trav) * Math.exp(-dd * 3.6)
									* grip * yield2 * 0.5;
								// AND THE FLARE, which does not travel: it
								// sits where the finger did, brightest at
								// once and fading. Bounded as a SET below,
								// because a run of presses in one place
								// otherwise stacks into a white patch —
								// the lesson this gauge keeps relearning.
								fire += 0.6 * yield2 * Math.exp(-dd * 5.5)
									* Math.min(1, age / 0.12)
									* Math.exp(-age / 1.1);
							}
						}
						// BOUNDED AS A SET — a quarter turn is a bloom, half
						// the wheel is a different picture. The jitter that
						// also writes `rot` is inside the cap too: during
						// the dissolve both are live at once, which is
						// exactly when an unbounded sum shows.
						rot = Math.max(-95, Math.min(95, rot));
						if (rot !== 0) ctx.filter = 'hue-rotate(' + Math.round(rot) + 'deg)';
						ctx.fillStyle = auroraCell(su, sv, f.t,
							Math.max(-1.6, Math.min(1.6, phase)),
							Math.min(1.15, fire));
						ctx.fillRect(gx * CELL, y, CELL, CELL);
						if (rot !== 0) ctx.filter = 'none';
						ctx.globalAlpha = 1;
					}
				}
			}
		};

		const draw = (now: number) => {
			raf = null;
			// The modal empties its body on every tab switch and on close,
			// which detaches this canvas — that is the teardown signal. No
			// listener to leak, and nothing keeps rendering behind a closed
			// report.
			if (!canvas.isConnected) return;
			resize();
			const t = (now - t0) / 1000;
			// Seconds since the last frame, clamped: a tab that was in the
			// background hands back a gap of seconds, and integrating the
			// spray over that would fire every drop into the ceiling at
			// once the moment the writer looked back.
			const dt = Math.min(0.05, prevT ? (now - prevT) / 1000 : 0.016);
			prevT = now;
			// Where in the four stages this frame falls. One read, so
			// nothing downstream can decide it differently.
			const stageMs = now - stageStart;
			const stage   = stageAt(stageMs);
			// Where the pour has got to. Clamped at both ends, so a frame
			// that arrives late cannot overshoot the number.
			if (!reduce && rNow !== r) {
				const u = Math.min(1, Math.max(0, (now - pourStart) / POUR_MS));
				rNow = pourFrom + (r - pourFrom) * ease(u);
				if (u >= 1) rNow = r;
			}
			ctx.clearRect(0, 0, w, h);

			// A FULL JAR POURS TOO, and stays water: the tank fills as water, with
			// a BIGGER swell at the brim (a full tank has the most to move), and
			// the aurora is composited over it as it fades up. Nothing switches;
			// one thing becomes another. Reduced motion starts at the answer, so
			// it is aurora from the first frame. THE AURORA ARRIVES AFTER THE
			// SPLASH, when the water is falling back, and finishes as the surface
			// goes still — so the whole lively stage is water, the crests are seen
			// breaking, and the light arrives into a settling jar.
			const auroraMix = full
				? Math.max(0, Math.min(1, (stageMs - S_SPLASH) / (S_CALM - S_SPLASH)))
				: 0;
			// HOW MUCH THE HUES ARE STILL SCATTERING: while the water is churning
			// the cells take random hues around the aurora's own, and as it calms
			// they resolve into it — the mixing IS the transition. The scatter is
			// the inverse of the mix (full when the light arrives, gone when it
			// has settled) and QUANTISED: a continuous rotation over a quantised
			// palette is a shimmer with no lattice to sit on, so the scatter
			// resolves in a few visible steps instead of creeping.
			const auroraJitter = full ? quantA(1 - auroraMix) : 0;
			// THE FRAME, handed to each phase: what this tick computed, and two
			// things the surface phase leaves for the rest — the water's height per
			// column, and the flat level it oscillates about (kept for the aurora:
			// a front measured from a wave is a front that lurches).
			const f: WsJarFrame = { now, t, dt, stage, stageMs, auroraMix, auroraJitter, surfaceY: null, restNow: 0 };
			drawSurface(f);

			// THE AURORA ARRIVES AS A PIXEL DISSOLVE, cell by cell.
			//
			// Two earlier versions were wrong in opposite directions: the
			// first REPLACED the water at full, so the jar cut from waves
			// to a flat wash in one frame; the second faded the aurora over
			// it with globalAlpha, which blends two colours inside every
			// cell and produces exactly the smooth in-between shades this
			// whole gauge is drawn to avoid. A fade is not a transition
			// pixel art can make.
			//
			// So each cell is either water or aurora, and the SHARE of them
			// that has turned rises with the pour. Which cells turn is
			// decided by an ordered dither — the same 4×4 matrix idea as
			// the bar heat ramps — so they come on in a stable, scattered
			// pattern rather than a wave or a random sparkle, and a cell
			// that has turned stays turned. Nothing is ever half-coloured.

			// THE SPLASH, thrown once when the water falls back through its
			// own level. Spawned along the whole surface rather than at the
			// two walls, because this is the water hitting ITSELF — the
			// overshoot collapsing — and that happens everywhere at once.
			// The cells nearest the walls go up hardest and lean inward:
			// water with a wall behind it has one way left to go.
			surfaceNow = f.surfaceY;
			// THE SPRING SHEDS BLOBS, and this is the picture the splash
			// below is NOT: not water thrown out of a collapse, but water
			// welling over a mouth and rolling off it. A few lumps at a
			// time, lobbed barely clear of the swell and falling back
			// into it — thrown with a fraction of the splash's speed, so
			// they arc rather than fly, and always from the middle where
			// the swell is. `shed: true` is the flag that already means
			// "this came off the water rather than out of it", which is
			// exactly what these are.
			if (springNow > 0.15 && !reduce && f.surfaceY && drops.length < DROPS_MAX
				&& Math.random() < 0.28) {
				const gxm = Math.round(cols / 2);
				const topY = f.surfaceY[gxm] != null ? f.surfaceY[gxm] : h;
				const many = 1 + Math.floor(Math.random() * 2);
				for (let k = 0; k < many; k++) {
					drops.push({
						x: w / 2 + (Math.random() - 0.5) * CELL * 5,
						y: topY - CELL,
						// Sideways more than up: a blob rolling off a swell
						// leaves it, it does not leap from it.
						vx: (Math.random() - 0.5) * 52,
						vy: -(14 + Math.random() * 26),
						life: 0, shed: true,
						hue: hueNow() + (Math.random() - 0.5) * 16,
						size: Math.random() < 0.45 ? 2 : 1,
						shape: Math.floor(Math.random() * 4)
					});
				}
			}
			// …AND A SPRING DOES NOT SPLASH. The burst below is the
			// collapse throwing water out of the tank — lumps, beads, the
			// lot — and it is the "blobs" half of what a brim-full pour
			// was still doing. It belongs to a jar with air above it: at
			// the top of the range there is no room to throw anything
			// into, and the arrival should be water reaching the glass,
			// not water leaving it. Keyed to the TARGET like every other
			// part of the arrival, so it is decided before the first
			// frame rather than switching on partway up.
			const splashRoom = 1 - Math.max(0, Math.min(1, (r - 0.72) / 0.20));
			drawSplash(f, splashRoom);

			// The spray, integrated and drawn. Gravity in the same units as the
			// velocities above; a cell dies when it falls back to the water under
			// it or leaves the jar.
			//
			// ── THE WATER IN THE AIR, COMING HOME ────────────────────────────
			// `airborne` is filled by the burst and drained here, or the ball's
			// water leaves the jar and stays gone. It returns over about three
			// quarters of a second and EASES — fast while there is a lot of it,
			// gentle as the last of it lands — which is the difference between a
			// level that climbs and one that plops.
			if (airborne > 0.0002) {
				// Rate proportional to what is left, so the tail flattens
				// on its own rather than needing a curve imposed on it.
				airborne = Math.max(0, airborne - airborne * 4.2 * f.dt - 0.004);
				// AND THE SETTLE WAITS FOR THE MASS. The bounce is what a
				// jar does when it GETS its water, so it is armed at the
				// moment the air is nearly home rather than at the impact —
				// otherwise it was rocking while the water was still
				// falling, which is a jar settling before it has anything
				// to settle.
				if (airborne <= 0.02 && splashAmp > 0 && !splashAt) splashAt = f.now;
			} else if (airborne !== 0) {
				airborne = 0;
				if (splashAmp > 0 && !splashAt) splashAt = f.now;
			}

			// ── INK AND BUBBLES ───────────────────────────────────────────
			if (inks.length) {
				for (let ii = inks.length - 1; ii >= 0; ii--) {
					if ((f.now - inks[ii].t) / 1000 > INK_LIFE) inks.splice(ii, 1);
				}
			}
			drawGlow(f);

			drawTilt(f);

			drawWaves(f);

			drawOrb(f);

			drawDrops(f);

			drawAurora(f);
			// ~30fps. The lattice cannot show more, and this is a modal
			// that may sit open for minutes.
			if (reduce) return;
			last = f.now;
			// STILL DOES NOT MEAN STOPPED. A liquid in which NOTHING moves reads
			// as a screenshot of a liquid; the picture changes every frame — the
			// caustic net crawls, the light shafts drift and the hue breathes, all
			// functions of `t` — so the loop runs for as long as the canvas is
			// connected (isConnected at the top of draw is the teardown, so
			// nothing renders behind a closed report), throttled to ~30fps.
			// Reduced motion keeps the other contract in full: one frame, no
			// timer. `kick()` is what starts the loop, and every path that changes
			// the picture calls it.
			const busy = !reduce;
			if (!busy) { raf = null; return; }
			raf = window.requestAnimationFrame(step);
		};

		const step = (now: number) => {
			if (now - last < 33) { raf = window.requestAnimationFrame(step); return; }
			draw(now);
		};

		// Wakes the loop. Under reduced motion the gauge draws once and
		// stops, so a pour asked for then has to redraw by hand rather
		// than by scheduling frames nobody wants.
		kick = () => {
			if (reduce) { draw(performance.now()); return; }
			if (raf == null) raf = window.requestAnimationFrame(step);
		};

		// NO CURSOR, NO TOOLTIP, AND NOTHING HERE POURS. A pointer promises
		// an action, and the only action is pushing the water; there is
		// already a way to pour — reopening the report. The whole jar is
		// water, and a press takes hold of it.
		//
		// ── Press, hold, release ─────────────────────
		// Down starts a gather, up releases it. A quick tap is a click: charge
		// is near zero, so the release throws about what one press always
		// threw. A long hold pulls a heap up under the finger and then drops
		// it, and the spray it throws is the charge it had. One gesture, and it
		// is the same gesture on a phone.
		const pointAt = (ev: PointerEvent) => {
			// The CANVAS's coordinates — the wrap and the canvas are not
			// the same box, and using the wrap's would put every press a
			// few pixels off the finger.
			let px = w / 2, py = h / 2;
			try {
				const box = canvas.getBoundingClientRect();
				if (box && box.width  > 0) px = (ev.clientX - box.left) * (w / box.width);
				if (box && box.height > 0) py = (ev.clientY - box.top)  * (h / box.height);
			} catch (_) { wsCatch('buildGoalLiquid / pointAt: const box = canvas.getBoundingClientRect();', _); }
			return {
				x: Math.max(0, Math.min(w, px)),
				y: Math.max(0, Math.min(h, py))
			};
		};

		// CLICK, CLICK, CLICK. Each press takes another bite of the tank into
		// the ball and winds it faster. There is no hold to time and no charge
		// to wait out: the gathering is the COUNT of presses, so it is as fast
		// as you are, and the jar empties as quickly as you care to empty it.
		//
		// ── THE INK'S PRESS ──────────────────────────────────────────────
		// A drop of colour, and the water bursting away from where it landed.
		// Both halves matter: the ink alone would be a stain appearing, and
		// the burst alone would be a press with no reason behind it — together
		// they read as something ARRIVING in the water.
		const inkPress = (p: { x: number; y: number; }, now: number) => {
			// A WHOLE WHEEL OF INKS. The offsets are drawn from a spread of steps
			// around the ramp's own hue — a colour that belongs to this water
			// reads as more of the same substance — so consecutive drops are
			// plainly DIFFERENT inks, and because a cell takes the weighted
			// average of every drop reaching it, two colours overlapping genuinely
			// make a third rather than one covering the other. A BOX OF INKS
			// ABOVE 80%: a nearly-full jar sits late on the ramp, where every
			// relative offset lands in the same narrow arc, and it is the jar
			// people press most — so it gets pinks, reds, oranges, yellows,
			// purples and magentas, named as ABSOLUTE hues. It fades in rather
			// than switching at a line: 80% mixes a few of them, 100% is nearly
			// all box, so there is no fill at which the jar suddenly starts
			// behaving differently.
			const BOX = [330, 340, 355, 8, 22, 36, 50, 265, 285, 300, 318];
			const boxOdds = Math.max(0, Math.min(0.85, (rNow - 0.80) / 0.22));
			const STEPS = [-155, -120, -85, -55, 55, 85, 120, 155, 180];
			const hue = (Math.random() < boxOdds
				? BOX[Math.floor(Math.random() * BOX.length)]
				: hueNow() + STEPS[Math.floor(Math.random() * STEPS.length)])
				+ (Math.random() - 0.5) * 22;
			// KEEP CLICKING AND IT SPREADS FURTHER. A run of presses is a
			// jar being stirred, and stirred ink goes further and mixes
			// harder: the streak fades if you stop, so one drop into still
			// water stays a drop.
			inkRun = (now - inkAt < 900) ? Math.min(8, inkRun + 1) : 1;
			inkAt = now;
			const push = 1 + (inkRun - 1) * 0.42;
			if (inks.length >= INKS_MAX) inks.shift();
			// Dropped where the pointer is, but never above the water: ink
			// landing in mid-air would spread from a point with nothing in
			// it. The surface is where it enters.
			const gxi = Math.max(0, Math.min(cols - 1, Math.round(p.x / CELL)));
			const line = surfaceNow ? (surfaceNow[gxi] || h) : h;
			// …and which WAY it turns is the drop's own. All curling one
			// way would read as the whole tank rotating; a mix reads as
			// water, which is what it is.
			inks.push({ x: p.x, y: Math.max(p.y, line + CELL), t: now, hue, push,
				spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.7) });

			// THE MOUND, NOT A BURST. Four attempts at answering a drop on
			// the surface — travelling waves at 1.5×, 0.62×, 0.28×, then a
			// "tiny" 0.15× ripple pair plus a per-drop hump — and every one
			// was turbulence after ONE click, because a nearly-full jar
			// has no sky and anything the surface does per click is
			// immediate weather. So the click no longer makes weather: it
			// adds a share to ONE mound (see the surface sum), and the
			// mound moves toward wherever the pressing actually is rather
			// than standing where the first click happened to land.
			const wasVented = inkCharge >= 1;
			if (inkCharge <= 0.01) inkChargeX = p.x;
			else inkChargeX += (p.x - inkChargeX) * 0.45;
			inkCharge = Math.min(1, inkCharge + 0.2);
			inkChargeAt = now;
			// A FULL MOUND LEAVES — as the wave the gathering was for.
			// Five presses build it; the press that tops it up spends it,
			// at the wall OPPOSITE the mound (a mound near the middle has
			// no opposite wall, so it splits and runs at both), on the
			// same capped stack every other wave rides. HEADROOM decides
			// its height exactly as the wave band's press does: this band
			// is nearly full, so the tank gives what room it has and no
			// more — the release reads as the mound going somewhere, not
			// as a storm arriving from nowhere.
			if (inkCharge >= 1 && !wasVented) {
				inkCharge = 0;
				inkVent = now;
				const gxc = Math.max(0, Math.min(cols - 1, Math.round(inkChargeX / CELL)));
				const surfC = surfaceNow ? (surfaceNow[gxc] || h) : h;
				const room = Math.max(6, surfC);
				const mid = Math.abs(inkChargeX - w / 2) < w * 0.09;
				const dirs = mid ? [-1, 1] : [inkChargeX < w / 2 ? 1 : -1];
				const swellAmp = Math.min(waveAmp() * 2.6, room * 0.62);
				for (const dir of dirs) {
					if (waves.length >= WAVES_MAX) waves.shift();
					waves.push({
						x: inkChargeX, dir, born: 0,
						amp: swellAmp * (mid ? 0.78 : 1),
						// A swell, not a chop: broad, deliberate, with a
						// real hollow behind it — the water the mound was
						// made of, going.
						wid: 1700, spd: 240, hollow: 0.55, spray: 1.2,
						hue, broke: false
					});
				}
				// The release is an EVENT and may say so — a modest share
				// of agitation, under the same low ceiling a wave-band
				// press keeps, so even releasing over and over is a run of
				// waves rather than a storm.
				agitLevel = Math.min(0.55, agitNow(now) + 0.10);
				agitAt = now;
				// …and the collapsing crest throws a little, off the top
				// of the mound, wearing the ink that was pressed into it.
				if (surfaceNow && drops.length < DROPS_MAX) {
					const many2 = Math.min(DROPS_MAX - drops.length, 3 + Math.floor(Math.random() * 3));
					for (let k = 0; k < many2; k++) {
						drops.push({
							x: inkChargeX + (Math.random() - 0.5) * CELL * 5,
							y: surfC - CELL * 2,
							vx: (Math.random() - 0.5) * 120 + (dirs.length === 1 ? dirs[0] * 40 : 0),
							vy: -(55 + Math.random() * 90),
							life: 0, shed: true,
							hue: hue + (Math.random() - 0.5) * 40,
							size: Math.random() < 0.3 ? 2 : 1,
							shape: Math.floor(Math.random() * 4)
						});
					}
				}
			}
			// AN INKY BUBBLE GOING IN. A few bubbles born at the point of
			// entry, carrying the drop's own colour rather than the water's
			// — air pushed under by something arriving, coming back up a
			// moment later and popping at the surface. They use the same
			// machinery every other bubble does, so they wobble as they
			// climb and ring the surface where they break; they simply
			// start where the ink did and wear its hue.
			if (surfaceNow) {
				const bn = Math.min(BUBBLES_MAX - bubbles.length,
					2 + Math.floor(Math.random() * 3));
				for (let k = 0; k < bn; k++) {
					bubbles.push({
						x: p.x + (Math.random() - 0.5) * CELL * 5,
						// Just under the surface, not deep: they were
						// carried down by the drop, not released from the
						// floor, so they have a short way back.
						y: Math.min(h - CELL, line + CELL * (2 + Math.random() * 5)),
						size: Math.random() < 0.4 ? 2 : 1,
						rise: 22 + Math.random() * 30,
						phase: Math.random() * 6.283,
						wob: 0.6 + Math.random() * 1.3,
						hue: hue + (Math.random() - 0.5) * 30
					});
				}
			}
			// …and a handful of beads off the surface at the entry point,
			// carrying the ink's own colour, because that is the water the
			// drop displaced on its way in.
			if (surfaceNow && drops.length < DROPS_MAX) {
				// Three to five beads over the meniscus: a drop going in should push
				// a small crown of water above the line, and more than that over a
				// surface that barely moves reads as the beads being the event.
				const many = Math.min(DROPS_MAX - drops.length, 3 + Math.floor(Math.random() * 3));
				for (let k = 0; k < many; k++) {
					drops.push({
						x: p.x + (Math.random() - 0.5) * CELL * 4,
						y: line - CELL,
						vx: (Math.random() - 0.5) * 105,
						vy: -(48 + Math.random() * 78),
						life: 0, shed: true,
						hue: hue + (Math.random() - 0.5) * 40,
						size: Math.random() < 0.3 ? 2 : 1,
						shape: Math.floor(Math.random() * 4)
					});
				}
			}
			// A RING WHERE IT WENT IN, AND NO MORE. `still` is the flag that
			// means "draw the ripple, claim no energy": the drop marks the
			// surface it broke without making the whole tank livelier for
			// the next second. Without it every ink click was quietly
			// stirring the jar on top of everything else.
			if (pokes.length >= POKES_MAX) pokes.shift();
			pokes.push({ x: p.x, y: null, t: now, still: true, hue });
			kick();
		};

		// ── THE SLOSH'S PRESS ───────────────────────────────────────────────
		// A press pushes the water toward the side it landed on, and it adds
		// to the tilt's VELOCITY rather than setting its position. That one
		// choice is the whole feel: a shove is an impulse, not a placement,
		// so pushing while the water is already moving your way ADDS to it
		// and pushing against it takes away. Find the jar's rhythm and it
		// climbs until it slops over the rim; lose the rhythm and you
		// flatten your own water. Nothing announces that anywhere — it is
		// simply true, which is the kind of thing worth noticing on your
		// own.
		//
		// The push is strongest at the walls and nothing at the centre,
		// because that is where leverage is: a hand on the middle of a tray
		// does not tip it.
		const sloshPress = (p: { x: number; y: number; }, now: number) => {
			const u = Math.max(-1, Math.min(1, (p.x - w / 2) / (w / 2)));
			// Pressing near the centre with no side to push toward is not
			// nothing: it is a flat slap, so it makes a ripple instead.
			const lever = Math.abs(u) < 0.06 ? 0 : u;
			tiltV += lever * 2.6;
			// Bounded so a stuck key cannot wind it past what the spill can
			// spend, which would ring at the cap forever.
			tiltV = Math.max(-5.5, Math.min(5.5, tiltV));
			if (pokes.length >= POKES_MAX) pokes.shift();
			pokes.push({
				x: p.x, y: null, t: now, still: false,
				hue: hueNow() + (Math.random() - 0.5) * 70
			});
			// A slap disturbs the surface where it landed whatever the body
			// then does, and a centre press has only this to give.
			agitLevel = Math.min(0.55, agitNow(now) + (lever === 0 ? 0.12 : 0.04));
			agitAt = now;
			kick();
		};

		// ── THE ORB'S PRESS, for the top half of the jar ────────────────────
		// Restored rather than reinvented: this is the gesture the orb was
		// tuned to over several rounds — each click takes a share of what is
		// LEFT so the last of the water is the hardest to lift, and how
		// quickly the clicks follow each other decides both the bite and
		// the spin. Its draw-loop half (leak, fall, tear, deformation) never
		// went away; only this end of it did, when the waves took the
		// handler over.
		const orbPress = (p: { x: number; y: number; }, now: number) => {
			// A press catches it mid-fall, torn or not.
			orb.falling = false;
			orb.dropping = false;
			orb.vy = 0;
			orb.x = p.x;
			orb.y = p.y;
			const gap  = Math.max(0, now - (orb.last || 0));
			const urge = Math.max(0, Math.min(1, 1 - gap / 520));
			orb.last = now;
			const room = Math.max(0, 1 - orb.want);
			orb.want = Math.min(1, orb.want
				+ ORB_BITE * (0.45 + urge * 1.1) * (0.35 + room * 0.65));
			// KEEP CLICKING AND IT KEEPS WINDING. A run of presses used to
			// add the same push each time, so the ball reached a speed and
			// sat there however long you kept at it. `streak` counts the
			// presses that have followed one another closely and fades when
			// you stop, so the tenth press in a run pushes half again as
			// hard as the first — the ball accelerates while you are
			// working at it rather than settling into a pace.
			orb.streak = urge > 0.15 ? Math.min(14, (orb.streak || 0) + 1) : 0;
			// 0.7, down from 1.6. The streak is meant to make a sustained
			// run feel like it is winding something up, not to reach the
			// cap in six presses.
			const zeal = 1 + (orb.streak / 14) * 0.7;
			orb.vel = Math.min(ORB_SPIN_CAP, orb.vel + (0.7 + urge * 2.4) * zeal);
			// The water is SEEN to come: blobs leave the surface across the
			// whole width and are aimed to arrive, so the ball is visibly
			// made of water that left the jar rather than conjured at the
			// pointer. `pull` keeps them from ringing the surface if they
			// fall back — they were on their way up, not thrown down.
			if (surfaceNow) {
				const many = Math.min(Math.max(0, DROPS_MAX - drops.length), 7);
				for (let k = 0; k < many; k++) {
					const gx2 = Math.floor(Math.random() * cols);
					const sx = gx2 * CELL;
					const sy = surfaceNow[gx2] || h;
					const flight = 0.42;
					drops.push({
						x: sx,
						y: sy - CELL,
						vx: (p.x - sx) / flight,
						vy: (p.y - sy) / flight - 900 * flight * 0.5,
						life: 0,
						shed: true,
						pull: true,
						hue: hueNow() + (Math.random() - 0.5) * 70,
						size: Math.random() < 0.35 ? 2 : 1,
						shape: Math.floor(Math.random() * 4)
					});
				}
			}
			// A RING WHERE THE WATER LEFT, AND NO STORM. This poke was
			// `still: false`, which feeds the global agitation store — and
			// that store is a MAXIMUM decaying over 620ms, so a single
			// press pinned the whole surface at full amplitude for half a
			// second. One click, and the entire tank churned.
			//
			// `still: true` draws the ripple and claims no energy, which is
			// the right bargain here: the water leaving is already visible
			// as seven blobs climbing to the ball, and the ball itself is
			// the answer to the press. The surface does not also need to be
			// thrown about to say something happened.
			if (pokes.length >= POKES_MAX) pokes.shift();
			pokes.push({
				x: p.x, y: p.y, t: now, still: true,
				hue: hueNow() + 40 + Math.random() * 220
			});
			kick();
		};

		// ── WHAT A PRESS DOES ───────────────────────────────────────────────
		// Down gathers, up releases. A quick press is a plain wave; a held
		// one raises a mound first and leaves with a bigger one. Nothing
		// snaps into place at either end — the mound eases in while the
		// finger is down and eases out into the wave that carries it away.
		const bite = (ev: PointerEvent) => {
			const p = pointAt(ev);
			const now = performance.now();

			// A LIT JAR KEEPS ITS LIGHT. At 100%, past the splash, the
			// aurora is the whole point of the picture and there is no
			// headroom for a wave anyway. The press stirs colour and winds
			// the curtains, exactly as it did before any of this.
			// The lit jar answers neither half of a press (see the pointerdown twin).
			if (full && (now - stageStart >= S_SPLASH)) { hold = null; return; }

			const heldFor = hold ? Math.min(1, (now - hold.t) / 1100) : 0;
			const eased   = 1 - Math.pow(1 - heldFor, 3);
			hold = null;

			// WHERE THE PRESS LANDED, relative to the water. The same click
			// means three different things depending on whether it fell
			// through air, broke the meniscus, or reached down into the
			// body of the liquid — and a jar that answers all three the
			// same way is a jar that is not really wet.
			const gx = Math.max(0, Math.min(cols - 1, Math.round(p.x / CELL)));
			const surf = surfaceNow ? (surfaceNow[gx] || h) : h;
			const tank = Math.max(1, h - surf);
			const under = (p.y - surf) / tank;      // <0 air, ~0 meniscus, >0 deep
			let kind = 'surface';
			if (under < -0.06) kind = 'air';
			else if (under < 0.10) kind = 'crest';
			else kind = 'swell';

			// HEADROOM. A nearly full jar has nowhere to put a tall wave,
			// and a wave drawn taller than the room it has just clips
			// against the ceiling. The height it cannot take is thrown as
			// SPRAY instead — energy has to go somewhere, and upward out of
			// a brimming tank is where it actually goes.
			const room  = Math.max(6, surf);
			const base  = waveAmp();
			const wants = base * (kind === 'swell' ? 2.1 : kind === 'air' ? 3.4 : 2.8)
				* (0.75 + eased * 1.5);
			const height = Math.min(wants, room * 0.7);
			const spilled = Math.max(0, wants - height) / Math.max(1, base);

			// Every wave is a little unlike the last: a tank that answers
			// twenty identical clicks with twenty identical waves stops
			// reading as water by about the fourth.
			const jitter = (v: number, by: number) => v * (1 - by + Math.random() * by * 2);

			const shapes: Record<string, { wid: number; spd: number; hollow: number; spray: number }> = {
				// Something falling in: narrow, quick, and it throws.
				air:     { wid: 760,  spd: 330, hollow: 0.30, spray: 5 },
				// Struck at the surface: the classic travelling crest.
				crest:   { wid: 900,  spd: 305, hollow: 0.42, spray: 3 },
				// Reached into the body: a long slow swell with a deep
				// trough behind it, and almost nothing thrown.
				swell:   { wid: 2100, spd: 215, hollow: 0.62, spray: 1 },
				surface: { wid: 900,  spd: 305, hollow: 0.42, spray: 3 }
			};
			const sh = shapes[kind] || shapes.crest;
			const hue = hueNow() + (Math.random() - 0.5) * 70;

			// WHICH WAY. At the wall opposite the pointer — press left and
			// it runs right. Press near the middle and there is no opposite
			// wall to pick, so it splits and runs at both.
			const mid = Math.abs(p.x - w / 2) < w * 0.09;
			const dirs = mid ? [-1, 1] : [p.x < w / 2 ? 1 : -1];
			for (const dir of dirs) {
				if (waves.length >= WAVES_MAX) waves.shift();
				waves.push({
					x: p.x,
					dir,
					born: 0,   // stamped by the first frame that sees it
					amp: jitter(height, 0.14) * (mid ? 0.78 : 1),
					wid: jitter(sh.wid, 0.18),
					spd: jitter(sh.spd, 0.10),
					hollow: sh.hollow,
					spray: sh.spray * (1 + spilled * 0.8) * (0.6 + eased),
					hue,
					broke: false
				});
			}

			// The press itself disturbs the water where it landed, whatever
			// the wave then does with it.
			if (pokes.length >= POKES_MAX) pokes.shift();
			pokes.push({ x: p.x, y: null, t: now, still: false, hue });
			// A GENTLE SHARE, AND A LOW CEILING. Every press used to add to
			// the same store the pour's storm uses, and `stir` scales the
			// WHOLE surface's amplitude — so ten quick clicks drove it to
			// its 2.4 cap, the waves grew to a fifth of the tank's height,
			// and the surface swung across the canvas every frame. That is
			// the one-colour flash: not a colour bug at all, but the water
			// filling and emptying the picture.
			//
			// The wave IS the answer to a press; it does not also need the
			// tank to churn. A tenth of what it added, under a ceiling of
			// its own well below the pour's, so clicking fast makes many
			// waves rather than one storm.
			agitLevel = Math.min(0.55, agitNow(now) + 0.02 + eased * 0.05);
			agitAt = now;
			// A held press that spilled its height throws on release too,
			// so a brimming jar answers a big press with water in the air
			// rather than with a wave it has no room for.
			if (surfaceNow && (spilled > 0.2 || eased > 0.3)) {
				const many = Math.min(DROPS_MAX - drops.length,
					1 + Math.round(spilled * 5 + eased * 6));
				for (let k = 0; k < many; k++) {
					drops.push({
						x: p.x + (Math.random() - 0.5) * CELL * 4,
						y: surf - CELL,
						vx: (Math.random() - 0.5) * 110,
						vy: -(60 + Math.random() * 120),
						life: 0,
						shed: true,
						hue: hue + (Math.random() - 0.5) * 50,
						size: Math.random() < 0.3 ? 2 : 1,
						shape: Math.floor(Math.random() * 4)
					});
				}
			}
			kick();
		};

		// NOT ON A PHONE. Every gesture here is a press, and on a touch
		// screen a press in the middle of a report is how you scroll it — the
		// listeners are not attached at all rather than attached and
		// ignoring, so there is nothing to swallow a scroll. AND NOT UNDER
		// REDUCED MOTION, for the same reason: a gauge that asked to be a
		// still picture is a still picture, and there is nothing half-alive
		// to glitch. The pour itself still redraws (one frame per change, via
		// kick), because a level changing is content, not motion.
		if (!(Platform && Platform.isMobile) && !reduce) {
			// TWO GESTURES, ONE POINTER. Which one a press means is decided
			// by how full the jar is, and the two want opposite timings:
			//
			//   WAVE (under half)  Down GATHERS — a mound rises under the
			//       finger straight away — and UP releases it as the wave.
			//       Holding is the whole point, so the work is on release.
			//   ORB (half and up)  Down TAKES a bite immediately. The
			//       gesture is click-click-click, and a gather that waited
			//       for the button to come up would put a delay in front of
			//       every one of them.
			//
			// So the orb fires on down and the wave on up, and neither
			// waits on the other's clock.
			wrap.addEventListener('pointerdown', (ev) => {
				const p = pointAt(ev);
				const now = performance.now();
				try { if (wrap.setPointerCapture) wrap.setPointerCapture(ev.pointerId); } catch (_) { wsCatch('buildGoalLiquid: if (wrap.setPointerCapture) wrap.setPointerCapture(ev.pointerId);', _); }
				// A LIT JAR TAKES NO PRESSES. The aurora field cannot take a local
				// disturbance and stay calm: it is dense with features and its output
				// is quantised, so a changed cell snaps between bands rather than
				// shading. The aurora is a picture, not a toy; the water below 100%
				// keeps every one of its toys.
				if (full && (now - stageStart >= S_SPLASH)) return;
				const toy = toyHere();
				if (toy === 'orb')   { orbPress(p, now);   return; }
				if (toy === 'slosh') { sloshPress(p, now); return; }
				if (toy === 'ink')   { inkPress(p, now);   return; }
				hold = { x: p.x, y: p.y, t: now };
				kick();
			});
			// BOTH TOYS FOLLOW THE FINGER, and this handler serves both.
			// A comment here once claimed the orb did its own following
			// "in its draw-loop half" — it does not, and never did: the
			// orb's follow lived in the pointermove the waves replaced, so
			// when the split went in the ball simply stopped moving. The
			// draw loop only ever read orb.x/orb.y; something has to write
			// them.
			//
			// The wave's mound gathers where the press ENDS rather than
			// where it began; the ball is carried by the pointer while
			// there is a ball to carry. Neither is dragged once it has been
			// let go — a falling ball is falling, not being led.
			wrap.addEventListener('pointermove', (ev) => {
				const hasOrb = orb.amount > 0.001 && !orb.falling && !orb.dropping;
				if (!hold && !hasOrb) return;
				const p = pointAt(ev);
				if (hold) { hold.x = p.x; hold.y = p.y; }
				if (hasOrb) { orb.x = p.x; orb.y = p.y; }
			});
			// Only the wave has anything to release.
			wrap.addEventListener('pointerup', (ev) => { if (hold) bite(ev); });
			wrap.addEventListener('pointercancel', (ev) => { if (hold) bite(ev); });
			// A pointer that leaves the window never sends up: the water
			// must not be left holding a gather it can never spend.
			wrap.addEventListener('pointerleave', (ev) => { if (hold) bite(ev); });
		}

		// First frame synchronously-ish, so the tank is never briefly blank —
		// and the pour starts with it, so the gauge is climbing by the time
		// the writer's eye arrives. THE JAR CAN BE ASKED TO POUR AGAIN,
		// without being rebuilt: handing the pour out on the element means the
		// crumb press can re-fill THIS jar — same canvas, same loop, no
		// teardown — where a fresh canvas that has not had its first frame is
		// a hole in the panel for one paint.
		wrap.wsPour = () => { pour(); kick(); };
		pour();
		raf = window.requestAnimationFrame(draw);
		return wrap;
	},

	// rgb → hsl, hue in degrees, s/l in percent. Only used by the gauge to
	// read the heat ramp back off the holder.
	_rgbToHsl(this: WordSmith, r: number, g: number, b: number) {
		r /= 255; g /= 255; b /= 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		const l = (max + min) / 2;
		let hue = 0, s = 0;
		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			if (max === r)      hue = ((g - b) / d + (g < b ? 6 : 0));
			else if (max === g) hue = ((b - r) / d + 2);
			else                hue = ((r - g) / d + 4);
			hue *= 60;
		}
		return [hue, s * 100, l * 100];
	},

	// Goals render nowhere in the bar. Their state exists for the met flash
	// and the report only — the top-edge hairline that used to read from it
	// was removed, along with the per-goal colours that only ever tinted
	// that line. The folder total still refreshes in the background and
	// repaints when it lands.
	registerGoalStates(this: WordSmith) {
		if (!this._goalStates) this._goalStates = [];

		const view    = this.app.workspace.getActiveViewOfType(MarkdownView);
		const fpath   = view && view.file ? view.file.path : null;
		const ftarget = fpath ? this.fileGoalFor(fpath) : 0;
		if (fpath && ftarget) {
			const words = this._wsLastTotalWordCount || 0;
			this._goalStates.push({
				kind: 'file', ratio: Math.min(words / ftarget, 1), met: words >= ftarget
			});
		}

		const dpath   = this.activeFolderPath();
		const dtarget = dpath ? this.folderTargetRollup(dpath).value : 0;
		if (dpath && dtarget) {
			const words = this._folderWordCache && this._folderWordCache.path === dpath
				? this._folderWordCache.words : 0;
			this._goalStates.push({
				kind: 'folder', ratio: Math.min(words / dtarget, 1), met: words >= dtarget
			});
			void this.refreshFolderWords(dpath);
		}
	},

	async refreshFolderWords(this: WordSmith, path: string) {
		if (this._folderWordBusy) return;
		this._folderWordBusy = true;
		try {
			const stats = await this.analyzeFolder(path);
			const prev  = this._folderWordCache;
			this._folderWordCache = { path, words: stats.words };
			if (!prev || prev.path !== path || prev.words !== stats.words) this.updateRetroStatusBar();
		} catch (_) { wsCatch('refreshFolderWords: const stats = await this.analyzeFolder(path);', _); }
		finally { this._folderWordBusy = false; }
	},

	// The REPORT's finder searches the vault itself, not the writing
	// record: the history can only offer paths it has seen you write in,
	// and "how long is that other chapter" is a fair question about a
	// note this plugin has never watched. Same fuzzy scorer, same
	// folders-first nudge, so the two finders rank the same way — only
	// the pool of candidates differs. Scope rules still apply: a note
	// the plugin is told to ignore is not offered here either.
	reportFinderMatches(this: WordSmith, query: string, limit?: number) {
		const files = [];
		const folders = new Set<string>();
		try {
			for (const f of this.app.vault.getMarkdownFiles()) {
				if (!this.isFileCounted(f)) continue;
				files.push(f.path);
				let cut = f.path.lastIndexOf('/');
				while (cut > 0) {
					folders.add(f.path.slice(0, cut));
					cut = f.path.lastIndexOf('/', cut - 1);
				}
			}
		} catch (_) { wsCatch('reportFinderMatches: for (const f of this.app.vault.getMarkdownFiles())', _); }
		const tag = (list: string[], kind: string) => this.historyFuzzy(query, list)
			.map(m => ({ path: m.path, score: m.score + (kind === 'folder' ? 1.5 : 0), kind }));
		const all = tag(Array.from(folders).sort(), 'folder').concat(tag(files.sort(), 'file'));
		all.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
		return all.slice(0, limit || 8);
	},

	// A centred report rather than a bar popup: eight figures and a
	// gauge, twice over, is more than a strip above the status bar can
	// hold legibly.
	//
	// ── THE WAY BETWEEN THE FOUR WINDOWS ─────────────────────────────
	//
	// Report, Organizer, History, Export: four windows describing one
	// manuscript, and each would be a dead end in at least one direction.
	// A writer who has just read that a chapter is 6,300 words wants to
	// know whether it is flagged, whether they wrote any of it this week,
	// and whether it is going out — without closing this, finding the
	// command, opening that. ONE BUILDER, called by all four: four copies
	// of a row of four buttons would be in step for about a month. The
	// window you are IN is shown and not clickable: a button that reopens
	// what you are looking at is a button that answers nothing, and
	// removing it instead would move the other three every time.
	//
	// ── WHERE AM I LOOKING ───────────────────────────────────────────
	//
	// ONE CONTROL, in every window that scopes: the path, and a finder,
	// and they are the same object. The crumbs are what you see; typing
	// turns them into a search; picking a hit turns them back. A browser's
	// address bar, and for the browser's reason — the thing that says
	// where you are and the thing that takes you somewhere else are one
	// question asked twice. THE VAULT IS A DESTINATION: `exportKnownPaths`
	// walks FROM the root and never includes it, so it is the first hit
	// here, always, and it answers to its own name.
	scopeFinderMatches(this: WordSmith, query: string, limit: number, foldersOnly?: boolean) {
		const q = String(query || '').trim().toLowerCase();
		const out: { path: string; kind: string; score?: number; vault?: boolean }[] = [];
		// Matched by what a person would actually type for it.
		const vaultWords = ['', 'vault', 'the whole vault', 'all', 'root', '/', 'everything'];
		if (!q || vaultWords.some(w => w && w.indexOf(q) === 0)) {
			out.push({ path: '', kind: 'folder', vault: true });
		}
		const hits = q ? this.exportFinderMatches(q, (limit || 8) + 2)
			: this.exportNearbyScopes((limit || 8) + 2);
		for (const h of hits) {
			if (foldersOnly && h.kind !== 'folder') continue;
			out.push(h);
		}
		return out.slice(0, limit || 8);
	},

	// How many notes are under a scope, for the finder to say. Cheap: it
	// walks the file list the vault already has, and never reads a file —
	// a hit list that made a writer wait is a hit list they stop using.
	scopeNoteCount(this: WordSmith, path: string, kind: string) {
		if (kind === 'file') return 0;
		try {
			const all = this.app.vault.getMarkdownFiles() || [];
			if (!path) return all.length;
			const pre = path + '/';
			return all.filter(f => f.path.indexOf(pre) === 0).length;
		} catch { return 0; }
	},

	// `at` NAMES THE ROW TO REPORT ON, and is optional.
	//
	// It was not a parameter at all, and the Outliner's "Report on this" passed
	// one anyway — so the menu row opened the report on whatever note happened
	// to be in the editor and looked, from a vault, like it was reporting on
	// the wrong folder. A call with an argument nothing reads fails silently
	// and reads correctly in the source, which is how it got past me.
	//
	// Left optional because every other caller means "wherever I am": the
	// palette, the bar and the nav row all open the report on the note in hand.
	openReportModal(this: WordSmith, at?: string) {
		if (!Modal) return;
		const modal  = this.wsModal();
		if (!modal) return;
		// One aurora palette per opening of the report. Seeded here rather
		// than inside buildGoalLiquid because the modal rebuilds its body
		// on every tab switch — seeding there would re-roll the colours
		// each time you looked at a different tab and back, which reads as
		// a glitch rather than as a thing that was dealt you.
		this._auroraSeed = Math.random();
		modal.titleEl.setText('Writing report');
		modal.modalEl.addClass('ws-report-modal');

		const view       = this.activeMarkdownView();
		void view;
		// THE ROW THAT WAS ASKED FOR, if one was. A folder named here has no
		// note to report on, so the window opens on the folder link of the
		// path rather than on a note the writer did not point at.
		let asked: TAbstractFile | null = null;
		try { asked = at ? this.app.vault.getAbstractFileByPath(String(at)) : null; }
		catch { asked = null; }
		const askedFolder = !!(asked && asked.children);
		const openFile   = (asked && !askedFolder) ? asked : this.activeNoteFile();
		const openFolder = (asked && askedFolder) ? asked.path
			: (asked ? String(at).slice(0, String(at).lastIndexOf('/'))
				: this.activeFolderPath());

		const body = modal.contentEl.createDiv({ cls: 'ws-report-body' });

		// NO TAB STRIP AND NO HISTORY BUTTON, both by request. The whole
		// window is: the title, the finder under it, and then the PATH —
		// the note's name at its head, its folders behind it — which is
		// the one control the report needs. `active` says which link of
		// that path the figures currently describe. The writing HISTORY
		// keeps its own modal and its own ways in (the command and the
		// bar); a button to leave this window does not need to live in
		// this window.
		// …and a folder that was asked for opens ON that folder, not on the
		// note inside it. Pointing at a chapter and being shown a scene is the
		// same fault from the other end.
		let active = askedFolder ? 'folder' : 'note';

		// The chain of folders above the note, root last. A manuscript is not
		// one folder: it is scenes inside a chapter inside a part inside the
		// book, and "how long is this chapter" and "how long is the book" are
		// both real questions that the single active folder could not answer.
		// The chain is the path row itself, so the control does not grow
		// taller with the depth of somebody's outline — only longer, and it
		// wraps.
		const chainOf = (p: string | null) => {
			const out = [];
			let cur = (p && p !== '/') ? p : '';
			while (cur) {
				out.push(cur);
				const cut = cur.lastIndexOf('/');
				cur = cut > 0 ? cur.slice(0, cut) : '';
			}
			out.push('/');
			return out;
		};

		// WHAT the report is about is state now, not a constant: the finder
		// below can point the window at any note or folder in the vault, so
		// the subject — the file at the head of the path, the chain behind
		// it — has to be able to move.
		let repFile   = openFile;
		let chain     = chainOf(openFolder);
		let folderSel = chain[0] || '/';

		const render = async () => { try {
			body.empty();
			body.createDiv({ cls: 'ws-report-loading', text: 'Reading\u2026' });

			// ── The finder ──────────────────────────────────────────────
			// One text box that can point the whole window at any note or
			// folder in the vault — "how long is that other chapter"
			// without leaving the report. Built as a function because the
			// no-note and no-folder paths return early and must still
			// offer it: a report opened with nothing on screen is exactly
			// when a search box is the way in. Same classes as the
			// history's finder, so the two windows do not disagree about
			// what a search box looks like.
			// `barScope`: the path IS the search box — it shows where you are,
			// takes a letter and becomes a finder, and its last crumb carries
			// the siblings.
			const buildFinder = (container: HTMLDivElement) => {
				this.barScope(container, {
					// THE PATH, NOT A FINDER. The report answers for the note
					// in hand, for a folder above it, or for the row that was
					// right-clicked — three ways in, all of them from
					// somewhere else. A search box here was a fourth way to
					// arrive at a window you have already arrived at.
					noSearch: true,
					// THE SUBJECT, NOT ITS PARENT: the crumbs are one NAME, so the window
					// is named for the note, not for the folder it was opened on.
					current: active === 'folder' ? folderSel
						: (repFile ? repFile.path : ''),
					placeholder: 'Search for a folder or a note\u2026',
					onPick: (path: string, kind: string) => {
						if (kind === 'file') {
							const f = this.app.vault.getAbstractFileByPath(path);
							if (f) { repFile = f; active = 'note'; void render(); }
							return;
						}
						active = 'folder';
						folderSel = path || '/';
						void render();
					}
				});
			};
			let stats: WsTextStats | null = null, target = 0, freq: Map<string, number> | null = null;
			if (active === 'note') {
				if (!repFile) {
					// No note, but never a dead end: the finder is the
					// way in, and the path still offers whatever it can —
					// at minimum the Vault crumb, one click from the
					// whole vault's numbers.
					body.empty();
					buildFinder(body);
					// THE TWO DOORS THAT ARE THERE (the writer, 2026-09-21: "it should say
					// open the report in a note or right click a note"): the bar's and
					// the palette's report is the note in hand, and the file explorer's
					// menu carries "Report on this" on every note and folder. "Pick a
					// folder above" named crumbs that are not there when nothing is
					// open, and "a row in the Organizer" a window most readers of this
					// sentence have not opened yet.
					body.createDiv({ text: 'No note open \u2014 open one and ask again, '
						+ 'or right-click a note or a folder in the file explorer and choose \u201cReport on this\u201d.' });
					return;
				}
				let text = '';
				try { text = await this.app.vault.cachedRead(repFile); } catch (_) { wsCatch('openReportModal / render: text = await plugin.app.vault.cachedRead(repFile);', _); }
				stats  = this.analyzeText(text);
				freq   = this.wordFreqInto(text, new Map<string, number>());
				// The file's own goal, not the vault-wide writing goal — those
				// are different numbers and showing one under the other's name
				// made the ring meaningless.
				target = this.fileGoalFor(repFile.path);
			} else {
				stats  = await this.analyzeFolder(folderSel);
				freq   = await this.wordFreqFor(this.filesInFolder(folderSel, true).filter((f) => this.isFileCounted(f)));
				// A FOLDER IS THE SUM OF ITS NOTES; there is no typed number.
				target = this.folderTargetRollup(folderSel).value;
			}

			// A tab switch mid-read must not paint stale numbers. FINDER
			// under the title, PATH under the finder — the order asked
			// for — and no scope line: it spelled out the same path the
			// crumbs already are, and the lit crumb plus each crumb's
			// hover title (the full path) says everything it said.
			body.empty();
			buildFinder(body);

			body.createEl('hr', { cls: 'ws-report-rule' });

			const ringWrap = body.createDiv({ cls: 'ws-report-ring' });
			if (target > 0) {
				const ratio = Math.min(stats.words / target, 1);
				const holder = ringWrap.createSpan({ cls: 'ws-goal' + (stats.words >= target ? ' is-met' : '') });
				// Heat ramp: ember red at nothing, amber in the middle, green
				// at the goal. currentColor carries it into the liquid.
				holder.style.color = 'hsl(' + Math.round(8 + ratio * 122) + ', 62%, 44%)';
				holder.appendChild(this.buildGoalLiquid(ratio));
			} else {
				const none = ringWrap.createDiv({ cls: 'ws-report-ring-label is-muted' });
				none.createDiv({
					text: active === 'note' ? 'No goal set for this note yet.'
						: 'No goal set for this folder yet.'
				});
				// POINTED AT THE WINDOW, not at a settings pane: sending a writer to
				// Settings to type a number into a list of paths is sending them past
				// the thing built to answer this. THE SENTENCE NAMES A DOOR THAT IS
				// THERE, and a test holds it ("no user-visible string names a window
				// that is not there"), because a string nothing checks goes stale the
				// next time something moves.
				none.createDiv({
					cls: 'ws-report-hint',
					text: 'Set one in the Organizer \u2014 in the table, on the '
						+ 'Target column.'
				});
			}

			this.buildReportFigures(body, stats, target, freq);

		} catch (e) {
			// An async renderer swallows its own exceptions; without this the
			// modal just sat on "Reading\u2026" forever — which is exactly how the
			// missing celebrate() presented.
			body.empty();
			body.createDiv({ text: 'Report failed \u2014 ' + wsErrMsg(e) });
		} };
		void render();
		// THE FOOT IS FOR FIGURES: it was cleared on purpose and is spoken for.
		// Outside `render()`, which redraws on every crumb click.
		modal.contentEl.createDiv({ cls: 'ws-report-foot' });
		modal.open();
		// Returned so a caller can follow it — the menu reopens itself
		// when this closes. See openBarMenu's `reopen` rows.
		return modal;
	},

	// ── The nine figures, three by three ────────────────────────────────────
	//
	// ONE BUILDER, called by the report window and by the unified window's
	// Report tab. It was written inside the report's own render, which was
	// right while there was one place that drew figures; a second copy of
	// nine labels, nine hover notes and one grouping would stay in step for
	// about a month, and the copy that fell behind would be the one somebody
	// was reading.
	//
	// It takes STATS, not a note: what it draws is true of one file, of a
	// folder, and of a selection of both summed together, which is what lets
	// the same grid answer for a tree row and for the whole vault.
	buildReportFigures(this: WordSmith, into: HTMLDivElement, stats: WsTextStats, target: number, freq: Map<string, number> | null) {
		const grid = into.createDiv({ cls: 'ws-report-grid' });
		// Each figure carries its own explanation on hover, rather than a
		// block of footnotes below competing with the numbers for height.
		const cell = (label: string, value: string, tip: string) => {
			const c = grid.createDiv({ cls: 'ws-report-cell' + (tip ? ' has-tip' : '') });
			if (tip) c.setAttribute('title', tip);
			c.createDiv({ cls: 'ws-report-value', text: value });
			c.createDiv({ cls: 'ws-report-label', text: label });
		};
		// NINE FIGURES, THREE BY THREE, grouped by what they measure:
		// the row of SIZE (words, characters, characters without
		// spaces), the row of STRUCTURE (syllables, sentences,
		// paragraphs), and the row of WHAT IT COSTS A READER (pages,
		// read time, grade). Four-across put those groups wherever the
		// wrapping fell; three-across is the shape of the meaning, and
		// it leaves no orphan row.
		//
		// The fraction lives in the Words cell rather than beside the
		// gauge: it is a word count, and that is where a reader looks.
		cell(target > 0 ? 'of ' + target.toLocaleString() + ' words' : 'Words',
			stats.words.toLocaleString(),
			'Prose only. Frontmatter, code, maths and link targets don\u2019t count.');
		cell('Characters', stats.chars.toLocaleString(),
			'Without spaces. Skips whatever the word count skips.');
		// Counted all along — the analyser has returned it since the
		// count was first split out — and never shown. A publisher's
		// character limit almost always means this one.
		// The literal figure, for anyone whose limit is quoted the way a
		// word processor counts: every space, tab and newline once
		// each. It used to be the COLLAPSED length, which was neither
		// figure — a run of four spaces scored one.
		cell('With spaces', (stats.charsWithSpaces || 0).toLocaleString(),
			'The word-processor figure \u2014 spaces and line breaks included.');
		cell('Syllables',  stats.syllables.toLocaleString(),
			'A best guess. Unusual words trip it up.');
		cell('Sentences',  stats.sentences.toLocaleString(),
			'Anything ending in . ? or !');
		cell('Paragraphs', stats.paragraphs.toLocaleString(),
			'Blocks with a blank line between them.');
		cell('Pages',      (stats.pages || 0).toLocaleString(),
			'At 250 words a page \u2014 the manuscript standard.');
		cell('Read time',  this.formatReadTime(stats.words),
			'At ' + READ_WPM + ' words a minute.');
		cell('Grade',      stats.sentences ? stats.grade.toFixed(1) : '\u2014',
			'Years of school needed to read it easily. Under 9 is easy going.');
		if (freq && freq.size) this.buildReportWords(into, stats, freq);
		return grid;
	},

	// ── MOST USED WORDS ────────────────────────────────────────────────
	//
	// THE REPORT'S OTHER FACE. A button at the foot of the figures — the
	// bar-chart glyph and the words — and the whole report turns into the
	// frequency table: the figures, the ring and the finder step aside
	// (hidden, not rebuilt, so the jar keeps its water), the table takes
	// the window's height and scrolls inside it, and the same button, now
	// the arrow and "Report", brings the figures back. A collapsed block at
	// the foot gave the list a strip too short to read a novel's words in.
	// Each row is word · count · %: the count beside the percentage because
	// "12 times" is what a writer acts on and "1.4%" is what they compare.
	// Common words out by default (REPORT_STOPWORDS says which), a tick
	// brings them back; the tick is the panel's own and is not saved.
	buildReportWords(this: WordSmith, into: HTMLDivElement, stats: { words: number }, freq: Map<string, number>) {
		into.addClass('ws-report-host');
		const box = into.createDiv({ cls: 'ws-report-words' });
		const bar = box.createDiv({ cls: 'ws-report-words-bar' });
		const btn = bar.createEl('button', { cls: 'ws-export-mini ws-report-words-btn', attr: { type: 'button', 'aria-pressed': 'false' } });
		const say = (open: boolean) => {
			wsGlyphWord(btn, open ? ['arrow-left', 'chevron-left'] : ['chart-bar-decreasing', 'bar-chart-horizontal', 'bar-chart-2'], open ? 'Report' : 'Words frequency');
			btn.title = open ? 'Back to the figures' : 'Every word, most used first';
			btn.setAttribute('aria-pressed', open ? 'true' : 'false');
		};
		say(false);
		const lab = bar.createEl('label', { cls: 'ws-report-words-common' });
		const chk = lab.createEl('input');
		chk.type = 'checkbox';
		lab.createSpan({ text: ' Include common words' });
		// EVERY WORD, in a box that scrolls: a novel has thousands. TWO TABLES,
		// ONE SET OF COLUMNS: the heading row in a box of its own above the
		// scroller, so the bar runs beside the words only and never cuts the
		// header. Both tables are `table-layout: fixed` over the same three
		// <col>s, and both boxes reserve the scrollbar's gutter, so the columns
		// stand in line whether or not the list scrolls.
		const cols = (t: HTMLElement) => {
			const cg = t.createEl('colgroup');
			cg.createEl('col', { cls: 'ws-report-col-word' });
			cg.createEl('col', { cls: 'ws-report-col-n' });
			cg.createEl('col', { cls: 'ws-report-col-pct' });
		};
		const headBox = box.createDiv({ cls: 'ws-report-words-head' });
		const htable = headBox.createEl('table', { cls: 'ws-report-words-table is-head' });
		cols(htable);
		const scroll = box.createDiv({ cls: 'ws-report-words-scroll' });
		const table = scroll.createEl('table', { cls: 'ws-report-words-table' });
		cols(table);
		const total = stats && stats.words ? stats.words : 0;
		// THE ORGANIZER'S HEADER: the same heading costume the table wears,
		// the word column left, the figures centred.
		const head = htable.createEl('thead').createEl('tr');
		head.createEl('th', { cls: 'ws-report-word', text: 'Word' });
		head.createEl('th', { cls: 'ws-report-wordn', text: 'Count' });
		head.createEl('th', { cls: 'ws-report-wordpct', text: 'Frequency' });
		const tbody = table.createEl('tbody');
		const draw = () => {
			tbody.empty();
			const rows = this.topWords(freq, Infinity, chk.checked);
			// THE BAND IS THE TARGET CELL'S: the same four steps by the same
			// thresholds, the top word at 100% and every other word a share of it,
			// the percentage of all words written on the band.
			const top = rows.length ? rows[0].n : 0;
			for (const r of rows) {
				const tr = tbody.createEl('tr');
				tr.createEl('td', { cls: 'ws-report-word', text: r.w });
				tr.createEl('td', { cls: 'ws-report-wordn', text: r.n.toLocaleString() });
				// AS MANY DECIMALS AS IT TAKES: a word used once in three thousand is
				// 0.03%, and one in 26,557 is 0.004%, not 0.00%.
				const pct = tr.createEl('td', { cls: 'ws-report-wordpct has-band', text: total ? wsShareText(r.n * 100 / total) + '%' : '\u2014' });
				const ratio = top ? Math.max(0, Math.min(100, Math.round(r.n / top * 100))) : 0;
				pct.style.setProperty('--ws-goal-pct', String(ratio));
				const step = ratio >= 100 ? 'done' : ratio >= 80 ? 'high' : ratio >= 50 ? 'mid' : 'low';
				pct.addClass('is-band-' + step);
			}
			if (!rows.length) {
				const only = tbody.createEl('tr').createEl('td', { cls: 'ws-report-word is-muted', text: 'Only common words here.' });
				only.setAttribute('colspan', '3');
			}
		};
		chk.addEventListener('change', draw);
		// DRAWN ON THE FIRST OPENING, not at build: a folder's map is thousands
		// of rows, and most reports are read for their figures.
		let drawn = false;
		btn.addEventListener('click', () => {
			const open = !box.hasClass('is-open');
			if (open && !drawn) { draw(); drawn = true; }
			box.toggleClass('is-open', open);
			into.toggleClass('is-words', open);
			say(open);
		});
		return box;
	},

	selectionFiles(this: WordSmith, rows: { kind: string; path: string }[]) {
		const out = new Map<string, TFile>();
		const add = (f: TAbstractFile | null) => {
			try { if (f && f.path && wsIsFile(f) && this.isFileCounted(f)) out.set(f.path, f); } catch (_) { wsCatch('selectionFiles / add: if (f && f.path && this.isFileCounted(f)) out.set(f.path, f);', _); }
		};
		// THE WRITING WHEN THERE IS ONE, the vault when there is not — the
		// same rule the window's tree draws by, so a report on "everything"
		// and a tree of "everything" are the same everything.
		const wholeVault = () => {
			for (const f of this.filesInFolder('/', true)) {
				add(f);
			}
		};
		if (!rows || !rows.length) { wholeVault(); return Array.from(out.values()); }
		for (const it of rows) {
			if (!it) continue;
			if (it.kind === 'folder') {
				// '' and '/' are the same place — the root — and callers
				// disagree about which they say. The report drew "Vault ›
				// Vault" the last time that went unhandled.
				for (const f of this.filesInFolder(it.path ? it.path : '/', true)) add(f);
				continue;
			}
			let f = null;
			try { f = this.app.vault.getAbstractFileByPath(it.path); } catch (_) { wsCatch('selectionFiles: f = this.app.vault.getAbstractFileByPath(it.path);', _); }
			add(f);
		}
		return Array.from(out.values());
	},

	// …and what those files add up to.
	//
	// Summed from the PER-FILE cache the folder pass already keeps, rather
	// than by adding up folder totals: the cache is keyed on path and mtime,
	// so a selection that overlaps a folder read a moment ago costs nothing,
	// and the union above cannot be undone by summing at a coarser grain.
	//
	// THE GRADE IS RECOMPUTED, never averaged. Every word in the selection
	// over every sentence in it — a two-line scene would otherwise weigh the
	// same as a four-thousand-word chapter, which is the same rule a folder's
	// own grade follows and the reason it is stated on the row's hover.
	async analyzeSelection(this: WordSmith, rows: { kind: string; path: string }[]) {
		if (!this.wordCountCache) this.wordCountCache = new Map();
		const files = this.selectionFiles(rows);
		const total: WsTextStats & { tasksDone?: number; tasksAll?: number } = { words: 0, chars: 0, charsNoSpaces: 0, charsWithSpaces: 0,
			syllables: 0, sentences: 0, paragraphs: 0, lines: 0, pages: 0, grade: 0, files: files.length };
		for (const file of files) {
			let stats = null;
			const hit = this.wordCountCache.get('stats:' + file.path);
			if (hit && file.stat && hit.mtime === file.stat.mtime) stats = hit.stats;
			if (!stats) {
				try {
					stats = this.analyzeText(await this.app.vault.cachedRead(file));
					if (file.stat) {
						this.wordCountCache.set('stats:' + file.path,
							{ mtime: file.stat.mtime, stats });
					}
				} catch { continue; }
			}
			total.words           += stats.words || 0;
			total.chars           += stats.chars || 0;
			total.charsNoSpaces   += stats.charsNoSpaces || 0;
			total.charsWithSpaces += stats.charsWithSpaces || 0;
			total.syllables       += stats.syllables || 0;
			total.sentences       += stats.sentences || 0;
			total.paragraphs      += stats.paragraphs || 0;
			total.lines           += stats.lines || 0;
		}
		total.pages = total.words ? Math.max(1, Math.round(total.words / 250)) : 0;
		total.grade = fkGrade(total.words, total.sentences, total.syllables);
		return total;
	},

	// The TARGET a selection is working towards.
	//
	// WHAT AN ANCESTOR ALREADY COVERS IS DROPPED. A folder's target is a
	// statement about everything under it, so adding a selected scene's
	// target to its selected chapter's would count the same words twice and
	// draw a gauge that can never fill. The files are unioned above for the
	// same reason; this is that rule applied to the other half of the sum.
	selectionTarget(this: WordSmith, rows: { kind: string; path: string }[]) {
		if (!rows || !rows.length) {
			// THE WHOLE VAULT IS A FOLDER TOO: the root sums its notes like every
			// other folder — one rule, no spellings.
			return this.folderTargetRollup('/').value;
		}
		const folders = rows.filter((r) => r && r.kind === 'folder').map((r) => r.path);
		const covered = (p: string, kind: string) => folders.some((f) =>
			!(kind === 'folder' && f === p)
			&& (f === '' || f === '/' || p === f || String(p).indexOf(f + '/') === 0));
		let sum = 0;
		// ONE WALK, NOT ONE PER ROW. Same change as the explorer's badge pass,
		// and the same reason: a selection of many folders would pay the whole
		// goals map once per folder in it.
		const sums = this.folderTargetSums();
		for (const it of rows) {
			if (!it || covered(it.path, it.kind)) continue;
			// A FOLDER IS WORTH WHAT IS UNDER IT — see `folderTargetRollup`.
			sum += it.kind === 'folder'
				? (sums.get(it.path) || 0)
				: this.fileGoalFor(it.path);
		}
		return sum;
	},
};
export type ReportMethods = typeof reportMethods;
