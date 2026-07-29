'use strict';

const { Plugin, PluginSettingTab, Setting, MarkdownView, TFile, TFolder, FuzzySuggestModal, Menu, setIcon } = require('obsidian');

// Path picker for the scope list. Defined conditionally because `class X
// extends undefined` throws at definition time, and FuzzySuggestModal is not
// present on very old API versions — there the Add buttons simply hide.
const WsPathSuggestModal = FuzzySuggestModal ? class extends FuzzySuggestModal {
	constructor(app, items, placeholder, onPick) {
		super(app);
		this._items = items;
		this._onPick = onPick;
		if (this.setPlaceholder) this.setPlaceholder(placeholder);
	}
	getItems() { return this._items; }
	getItemText(item) { return item; }
	onChooseItem(item) { this._onPick(item); }
} : null;

// Obsidian exposes its bundled CodeMirror 6 packages to plugins via require.
// Decorations registered through registerEditorExtension render inside CM6's
// own pipeline, which is the only glitch-free way to do per-line styling —
// any MutationObserver / direct-DOM approach races the editor's rendering
// and flickers (this is also how the reference typewriter-mode plugin works).
let CM = null;
try {
	const { ViewPlugin, Decoration, WidgetType, keymap, EditorView } = require('@codemirror/view');
	const { RangeSetBuilder, Prec } = require('@codemirror/state');
	CM = { ViewPlugin, Decoration, WidgetType, RangeSetBuilder, keymap, EditorView, Prec };
	// Optional: only used to force the typography substitution into its own
	// undo step. Without it undo still works, it just takes the literal
	// characters with it.
	try { CM.isolateHistory = require('@codemirror/commands').isolateHistory; } catch (_) {}
} catch (_) {
	// Extremely old Obsidian build — dimming + hidden markers silently off.
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrow style presets
// ─────────────────────────────────────────────────────────────────────────────

const ARROW_STYLES = {
	'solid-triangle':   { top: '▲', bottom: '▼' },
	'outline-triangle': { top: '△', bottom: '▽' },
	'standard-arrow':   { top: '↑', bottom: '↓' },
	'chevron':          { top: '∧', bottom: '∨' },
	'double-chevron':   { top: '⇑', bottom: '⇓' },
	'custom':           { top: '',   bottom: ''  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Prose analysis — lexicon, tagger, detectors
//
// Everything here is deliberately dependency-free. A real POS tagger
// (compromise, wink, natural) is 200KB–2MB and would dwarf the plugin; this
// is a lexicon + suffix + context tagger in the Brill tradition, which gets
// roughly 90% of ordinary English prose right. That is the correct accuracy
// target for a *writing aid*: the highlighting is a nudge to look at a
// sentence, not a grammatical assertion, and a wrong colour costs the writer
// a glance. Anything that needs to be exact (word counts, goals) is computed
// elsewhere and never goes through here.
//
// Tags used internally:
//   DET PRON PREP CONJ AUX MOD ADV ADJ NOUN VERB NUM TO
// which collapse to five highlight classes (noun / verb / adj / adv / conj)
// mirroring syntax colouring.
// ─────────────────────────────────────────────────────────────────────────────

const POS_LEX = Object.create(null);
(function buildLexicon() {
	const add = (tag, words) => {
		for (const w of words.split(/\s+/)) if (w) POS_LEX[w] = tag;
	};

	add('DET', `a an the this that these those my your his her its our their
		some any each every no another both either neither all much many few
		little several enough such which whose what`);

	add('PRON', `i me you he him she it we us they them mine yours hers ours
		theirs myself yourself himself herself itself ourselves yourselves
		themselves who whom someone somebody something anyone anybody anything
		everyone everybody everything nobody nothing none one`);

	add('PREP', `of in for with on at by from about into over under above
		across against along among amid around before behind below beneath
		beside besides between beyond despite during except inside near off
		onto outside past since through throughout till toward towards
		underneath until unto upon within without via per unlike`);

	add('CONJ', `and but or nor yet so because although though while whereas
		unless if when whenever wherever whether than plus versus`);

	add('AUX', `am is are was were be been being have has had having do does
		did doing`);

	add('MOD', `will would shall should can could may might must ought`);

	add('TO', 'to');

	// Adverbs that do not end in -ly, plus the discourse connectives.
	add('ADV', `not never always often sometimes usually rarely seldom very
		quite rather too also just only even still already soon now then here
		there again once twice far away back together apart forward ahead
		almost nearly hardly barely scarcely somewhat somehow perhaps maybe
		indeed instead however therefore thus moreover nevertheless nonetheless
		anyway otherwise meanwhile furthermore hence why how well today
		tomorrow yesterday tonight later earlier ever else rather forth aside
		abroad anymore altogether upward downward inward outward`);

	add('ADJ', `good bad big small large little old new young long short high
		low great same different other own able early late main major minor
		real true false whole full empty free hard easy simple complex clear
		dark light heavy soft loud quiet strong weak rich poor deep shallow
		wide narrow thick thin clean dirty warm cool hot cold dry wet sharp
		dull fast slow safe next last first second third final total certain
		sure possible likely necessary important common general specific
		particular single double sorry ready open close public private local
		national international social political economic human natural best
		better worse worst less least more most difficult strange quick slight
		direct exact vast brief sudden silent distant ancient modern current
		recent obvious similar familiar popular regular various serious
		previous senior junior chief prime sole mere utter sheer stark plain
		vague subtle blunt harsh calm tense tight loose smooth rough steep
		flat round square straight curved hollow solid dense sparse lengthy
		tidy messy odd fine keen bold quiet sweet bitter sour tough gentle
		fierce eager weary alive alone aware alike`);

	// Common nouns that suffix rules would otherwise mis-tag.
	add('NOUN', `time way people man woman men women child children day year
		work place case point group number world life hand eye head word thing
		name home room door house water fire air book story line page thought
		idea money family friend school city country state night morning
		evening week month hour minute moment reason question answer problem
		sense mind heart voice face body kind sort part end side form order
		matter fact view level rate area field course result effect chance
		change nothing everything something anything`);

	// Base-form verbs. Many are also nouns (work, call, run, hold); context
	// rules below demote them to NOUN after a determiner or preposition.
	add('VERB', `go goes went gone going come comes came make makes made take
		takes took taken see sees saw seen know knows knew known think thinks
		say says said tell tells told give gives gave given find finds want
		wants need needs use uses try tries ask asks call calls feel feels felt
		seem seems leave leaves left keep keeps kept let lets begin begins
		began begun help helps show shows shown turn turns start starts run
		runs ran move moves live lives believe believes hold holds held bring
		brings brought happen happens write writes wrote written read stand
		stands stood hear hears heard mean means meant set sets meet meets met
		pay pays paid sit sits sat speak speaks spoke spoken lie lies lay lead
		leads led grow grows grew grown open opens win wins won offer offers
		remember remembers love loves consider considers appear appears buy
		buys bought wait waits serve serves die dies send sends build builds
		built stay stays fall falls fell cut cuts reach reaches remain remains
		put puts get gets got gotten become becomes became look looks like
		likes work works play plays walk walks talk talks check checks add adds
		note notes list lists click clicks press presses save saves load loads
		close closes choose chooses pick picks draw draws point points push
		pushes pull pulls carry carries follow follows lead include includes
		provide provides create creates allow allows report reports describe
		describes explain explains suggest suggests decide decides expect
		expects prefer prefers manage manages develop develops support
		supports require requires produce produces receive receives return
		returns continue continues change changes learn learns teach teaches
		spend spends watch watches listen listens forget forgets enjoy enjoys
		agree agrees accept accepts refuse refuses avoid avoids reduce reduces
		improve improves replace replaces remove removes apply applies`);
})();

// -ly words that are adjectives (or otherwise not the manner adverbs a
// writer is being asked to reconsider). Without this list "family",
// "reply" and "supply" all light up as adverbs.
const LY_NOT_ADVERB = new Set(`only family reply apply supply imply comply
	multiply rely rally ally july italy holy ugly silly early likely lonely
	lovely friendly deadly costly orderly elderly monthly weekly daily yearly
	nightly hourly timely lively unlikely ghastly ghostly homely jolly folly
	bully belly sally tally melancholy anomaly assembly bristly burly chilly
	crumbly curly dolly gully hilly jelly kindly lolly manly measly oily
	prickly rally scaly smelly steely surly wobbly wooly worldly italy sicily
	assembly panoply monopoly`.split(/\s+/).filter(Boolean));

// ── Tokenizer ────────────────────────────────────────────────────────────────

const WORD_RE = /[A-Za-z][A-Za-z'\u2019-]*/g;

function tokenizeLine(text) {
	const out = [];
	WORD_RE.lastIndex = 0;
	let m;
	while ((m = WORD_RE.exec(text))) {
		// Trailing hyphens/apostrophes belong to the markup, not the word.
		let w = m[0].replace(/[-'\u2019]+$/, '');
		if (!w) continue;
		out.push({ w, lw: w.toLowerCase().replace(/\u2019/g, "'"), from: m.index, to: m.index + w.length, tag: null });
	}
	return out;
}

// ── Suffix tagging ───────────────────────────────────────────────────────────

function suffixTag(lw, raw, isFirstInSentence) {
	if (/^\d/.test(lw)) return 'NUM';
	if (lw.length > 3 && /ly$/.test(lw) && !LY_NOT_ADVERB.has(lw)) return 'ADV';
	if (lw.length > 4 && /(ing)$/.test(lw)) return 'VERB';
	if (lw.length > 3 && /(ed)$/.test(lw)) return 'VERB';
	if (lw.length > 4 && /(est)$/.test(lw)) return 'ADJ';
	if (lw.length > 4 && /(tion|sion|ment|ness|ity|ance|ence|ship|hood|dom|ism|ist|acy|age|ure|ery|ology|graphy|itis)$/.test(lw)) return 'NOUN';
	if (lw.length > 4 && /(ous|ful|less|ive|able|ible|ical|ic|ish|ary|ent|ant|ile|ory|some|like|ward|proof)$/.test(lw)) return 'ADJ';
	if (lw.length > 4 && /(ize|ise|ate|ify|fy)$/.test(lw)) return 'VERB';
	if (lw.length > 3 && /(er|or)$/.test(lw)) return 'NOUN';
	if (lw.length > 3 && /s$/.test(lw) && !/ss$/.test(lw)) {
		const base = lw.replace(/(ies|es|s)$/, m => (m === 'ies' ? 'y' : ''));
		if (POS_LEX[base] === 'VERB') return 'VERB';
		return 'NOUN';
	}
	// Capitalised mid-sentence → proper noun.
	if (!isFirstInSentence && /^[A-Z]/.test(raw)) return 'NOUN';
	return 'NOUN';
}

// ── Context rules ────────────────────────────────────────────────────────────

const SENT_END = /[.!?\u2026]$/;

function tagTokens(tokens, text) {
	// Pass 1 — lexicon, then suffix.
	let firstInSentence = true;
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		const lex = POS_LEX[t.lw];
		t.first = firstInSentence;
		t.tag = lex || suffixTag(t.lw, t.w, firstInSentence);
		// A sentence ends when the character right after this token is a
		// terminator (the tokenizer never swallows punctuation).
		const after = text.slice(t.to, t.to + 2);
		firstInSentence = SENT_END.test(after.trim().charAt(0) || '');
	}

	// Pass 2 — context. Cheap, local, and in the order that matters:
	// determiner/preposition demotion before infinitive promotion, so
	// "the run" stays a noun but "to run" becomes a verb.
	for (let i = 0; i < tokens.length; i++) {
		const t    = tokens[i];
		const prev = i > 0 ? tokens[i - 1] : null;
		const next = i + 1 < tokens.length ? tokens[i + 1] : null;

		// "the work", "a call", "in place" → noun, not verb. An -ing word
		// in the same slot is a gerund ("the meeting") unless a noun
		// follows, which makes it a participial modifier ("the running
		// water"). -ed words after a determiner are always modifiers.
		if (t.tag === 'VERB' && prev && (prev.tag === 'DET' || prev.tag === 'PREP')) {
			if (/ed$/.test(t.lw))       t.tag = 'ADJ';
			else if (/ing$/.test(t.lw)) t.tag = (next && next.tag === 'NOUN') ? 'ADJ' : 'NOUN';
			else                        t.tag = 'NOUN';
		}
		// Determiner + adjective with no noun after it → the adjective is
		// carrying the noun slot ("the poor", "the best").
		if (t.tag === 'ADJ' && prev && prev.tag === 'DET' && (!next || next.tag !== 'NOUN')) {
			// leave adjectives that clearly modify something later
			if (!next || (next.tag !== 'ADJ' && next.tag !== 'NOUN')) t.tag = 'NOUN';
		}
		// "to write" → infinitive.
		if (prev && prev.tag === 'TO' && (t.tag === 'NOUN' || t.tag === 'ADJ') && POS_LEX[t.lw] !== 'NOUN') {
			t.tag = 'VERB';
		}
		// Auxiliary or modal followed by a candidate → verb.
		if (prev && (prev.tag === 'AUX' || prev.tag === 'MOD') && t.tag === 'NOUN' && /ing$|ed$|en$/.test(t.lw)) {
			t.tag = 'VERB';
		}
		// Noun immediately before a noun, where the first is also an
		// adjective by suffix, reads as a modifier.
		if (t.tag === 'NOUN' && next && next.tag === 'NOUN' && /(ic|al|ive|ous|ful)$/.test(t.lw)) {
			t.tag = 'ADJ';
		}
		// An unknown word between a determiner (or another adjective) and a
		// noun is filling the modifier slot: "her difficult book". Limited to
		// words the lexicon does not claim, so noun-noun compounds like "the
		// book cover" keep both nouns.
		if (t.tag === 'NOUN' && !POS_LEX[t.lw] && prev && next &&
			(prev.tag === 'DET' || prev.tag === 'ADJ') && next.tag === 'NOUN') {
			t.tag = 'ADJ';
		}
		// Sentence-initial word followed by a determiner or pronoun, with no
		// lexicon entry claiming it as a noun, is almost always an
		// imperative verb ("Check the file", "Open your notes").
		if (t.first && t.tag === 'NOUN' && !POS_LEX[t.lw] && next &&
			(next.tag === 'DET' || next.tag === 'PRON')) {
			t.tag = 'VERB';
		}
	}

	// "to" is an infinitive marker before a verb and a preposition everywhere
	// else. Decided last, so the infinitive promotion above has already run
	// and "to write" is distinguishable from "to the shop".
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].tag !== 'TO') continue;
		const next = tokens[i + 1];
		if (!next || next.tag !== 'VERB') tokens[i].tag = 'PREP';
	}
	return tokens;
}

// Collapse the internal tag set to the five highlight buckets.
function posBucket(tag) {
	switch (tag) {
		case 'NOUN': case 'PRON': return 'noun';
		case 'VERB': case 'AUX': case 'MOD': return 'verb';
		case 'ADJ':  return 'adj';
		case 'ADV':  return 'adv';
		case 'CONJ': case 'PREP': return 'conj';
		default: return null;
	}
}

// ── Smart typography ─────────────────────────────────────────────────────────
// Rules are pure data: `text` is what the user has typed once the newest
// character lands, `insert` is what replaces it. One matcher drives all of
// them, so adding a rule is a line rather than a branch.
//
// The dash chain is the interesting case — -- gives an en dash, another -
// promotes it to an em dash, and a third backs all the way out to three
// literal dashes, which is the escape hatch for anyone who wanted ---.
const TYPO_RULES = [
	{ group: 'ellipsis',    text: '...',  insert: '\u2026' },

	{ group: 'dashes',      text: '--',            insert: '\u2013' },
	{ group: 'dashes',      text: '\u2013-',        insert: '\u2014' },
	{ group: 'dashes',      text: '\u2014-',        insert: '---'    },

	{ group: 'arrows',      text: '->',   insert: '\u2192' },
	{ group: 'arrows',      text: '<-',   insert: '\u2190' },
	{ group: 'arrows',      text: '=>',   insert: '\u21d2' },

	{ group: 'guillemets',  text: '<<',   insert: '\u00ab' },
	{ group: 'guillemets',  text: '>>',   insert: '\u00bb' },

	{ group: 'comparisons', text: '<=',   insert: '\u2264' },
	{ group: 'comparisons', text: '>=',   insert: '\u2265' },
	{ group: 'comparisons', text: '/=',   insert: '\u2260' },

	// notAfter stops 11/2 from collapsing into 1½.
	{ group: 'fractions', text: '1/2',  insert: '\u00bd', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/3',  insert: '\u2153', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '2/3',  insert: '\u2154', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/4',  insert: '\u00bc', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '3/4',  insert: '\u00be', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/5',  insert: '\u2155', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '2/5',  insert: '\u2156', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '3/5',  insert: '\u2157', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '4/5',  insert: '\u2158', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/6',  insert: '\u2159', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '5/6',  insert: '\u215a', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/7',  insert: '\u2150', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/8',  insert: '\u215b', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '3/8',  insert: '\u215c', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '5/8',  insert: '\u215d', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '7/8',  insert: '\u215e', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/9',  insert: '\u2151', notAfter: /[\d/]/ },
	{ group: 'fractions', text: '1/10', insert: '\u2152', notAfter: /[\d/]/ }
];

// Longest first, so 1/10 wins over 1/1 and the em-dash chain resolves before
// the en-dash rule gets a look.
TYPO_RULES.sort((a, b) => b.text.length - a.text.length);

const TYPO_MAX_LOOKBACK = TYPO_RULES.reduce((n, r) => Math.max(n, r.text.length), 0);

// A quote opens when nothing meaningful precedes it — start of line,
// whitespace, an opening bracket, or a dash. It closes otherwise, which is
// what makes don't come out as don\u2019t with no apostrophe special case.
const TYPO_OPENS_AFTER = /[\s([{<\u2018\u201c\u2013\u2014\u2026-]/;

// ── Non-prose line scanning ──────────────────────────────────────────────────

// Line numbers (1-based) that are not prose: YAML frontmatter, fenced code
// (``` and ~~~), and $$ math blocks. Shared by the word counter, which works
// on a raw string, and the syntax highlighter, which works on a CodeMirror
// document — one implementation means the two can never disagree about which
// lines are text.
function scanNonProseLines(lines) {
	const set = new Set();
	let inFence = false, fenceChar = '', inFront = false, inMath = false;
	for (let i = 0; i < lines.length; i++) {
		const n = i + 1, text = lines[i];
		if (n === 1 && /^---\s*$/.test(text)) { inFront = true; set.add(n); continue; }
		if (inFront) { set.add(n); if (/^---\s*$/.test(text)) inFront = false; continue; }
		const fence = text.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (fence) {
			const ch = fence[1].charAt(0);
			if (!inFence)         { inFence = true;  fenceChar = ch; set.add(n); continue; }
			if (ch === fenceChar) { inFence = false; set.add(n); continue; }
		}
		if (inFence) { set.add(n); continue; }
		if (/^\s{0,3}\$\$/.test(text)) {
			set.add(n);
			if (!/^\s{0,3}\$\$.*\$\$\s*$/.test(text)) inMath = !inMath;
			continue;
		}
		if (inMath) set.add(n);
	}
	return set;
}

// ── Paragraph detection ──────────────────────────────────────────────────────

// Lines that open a block construct. Every one of these carries its own
// indentation already — a bullet, a table cell, a quote marker — so adding a
// first-line indent on top just breaks the alignment it depends on.
const BLOCK_LINE_RE = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~|\[\^[^\]]*\]:|:\s)|^(?:\s{4,}|\t)\S/;

// Thematic breaks and setext underlines: --- *** ___ ===
const RULE_LINE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,}|={2,})\s*$/;

function isParagraphLine(text) {
	if (!text || !text.trim()) return false;
	if (RULE_LINE_RE.test(text))  return false;
	if (BLOCK_LINE_RE.test(text)) return false;
	return true;
}

// ── Counting ─────────────────────────────────────────────────────────────────

// Han and kana are counted per character, because Japanese and Chinese are
// not space-delimited — splitting on whitespace returns 1 for an entire
// paragraph. Hangul is deliberately absent: Korean *does* put spaces between
// words, so it counts the same way English does.
const CJK_CHAR = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;

// A word is any run starting with a letter or digit. Requiring one of those
// is what keeps list bullets, table pipes, blockquote markers and emphasis
// asterisks from each counting as a word.
const WORDISH = /[\p{L}\p{N}][\p{L}\p{N}'\u2019_-]*/gu;

// Blanks out markup while preserving nothing but the prose. Unlike
// maskMarkup (used for highlighting) this keeps inline code *content* — "the
// `config` file has three keys" is a seven-word sentence to any writer — and
// strips list, task and blockquote prefixes, which highlighting does not care
// about but counting very much does.
function maskForCounting(text) {
	const blank = m => ' '.repeat(m.length);
	let out = text;
	out = out.replace(/^\s*(?:>\s?)+/, blank);                    // blockquote markers
	out = out.replace(/^\s*[-*+]\s+\[[ xX\-]\]\s*/, blank);      // task checkbox
	out = out.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, blank);         // list bullet / number
	out = out.replace(/`+/g, blank);                              // fences only; code text counts
	out = out.replace(/!\[\[[^\]]*\]\]/g, blank);                 // embeds
	out = out.replace(/\[\[([^\]|]*)\|/g, blank);                 // wikilink target + pipe
	out = out.replace(/\[\[|\]\]/g, blank);
	out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, blank);            // images
	out = out.replace(/\]\([^)]*\)/g, blank);                     // link target
	out = out.replace(/https?:\/\/\S+/g, blank);                  // bare urls
	out = out.replace(/<[^>]+>/g, blank);                         // html tags
	out = out.replace(/\[\^[^\]]*\]/g, blank);                    // footnote markers
	out = out.replace(/\$[^$\n]+\$/g, blank);                     // inline math
	return out;
}

// ── Markup masking ───────────────────────────────────────────────────────────

// Blanks out everything that is not prose, preserving string length so all
// offsets stay valid against the real line. Inline code, URLs, link targets,
// HTML tags and footnote markers are replaced by spaces; the visible text of
// a link is kept, because that text is prose the writer is responsible for.
function maskMarkup(text) {
	const blank = m => ' '.repeat(m.length);
	let out = text;
	out = out.replace(/`[^`]*`?/g, blank);                        // inline code
	out = out.replace(/!\[\[[^\]]*\]\]/g, blank);                 // embeds
	out = out.replace(/\[\[([^\]|]*)\|/g, blank);                 // wikilink target + pipe
	out = out.replace(/\[\[|\]\]/g, blank);                       // wikilink brackets
	out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, blank);            // images
	out = out.replace(/\]\([^)]*\)/g, blank);                     // md link target
	out = out.replace(/https?:\/\/\S+/g, blank);                  // bare urls
	out = out.replace(/<[^>]+>/g, blank);                         // html tags
	out = out.replace(/\[\^[^\]]*\]/g, blank);                    // footnotes
	out = out.replace(/^\s{0,3}#{1,6}\s/, blank);                 // heading marker
	out = out.replace(/\{\{[^}]*\}\}/g, blank);                   // templates
	return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default settings
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
	// ── Master switch ─────────────────────────────────────────────────────────
	pluginEnabled:            true,
	restoreCursorPosition:    true,
	cursorMemory:             {},        // path -> {line, ch}, bounded on write

	// ── Scope ─────────────────────────────────────────────────────────────────
	// An empty list means every note, in either mode. That is the only sane
	// default: a scope feature that starts out excluding everything would look
	// exactly like a broken plugin.
	scopeMode:                'include',  // 'include' | 'exclude'
	scopePaths:               [

	],

	// ── Zen mode ──────────────────────────────────────────────────────────────
	// zenMode stays false as a default even though the author writes in zen:
	// it's a runtime mode, not a preference — defaulting it on would collapse
	// sidebars and hide the entire UI the moment a new user installs the
	// plugin, before they know what's happening or how to exit.
	zenMode:                  true,
	fullscreen:               false,
	leftSidebar:              true,       // saved state (was collapsed when entering zen)
	rightSidebar:             true,
	hideProperties:           true,
	hideInlineTitle:          true,
	hideStatusBar:            true,
	hideLinkedMentions:       true,
	hideScrollBar:            true,
	hideRibbon:               true,
	topPadding:               17,
	bottomPadding:            21,
	focusedFileMode:          false,

	// ── Typewriter / letterbox ────────────────────────────────────────────────
	enableTypewriter:         false,
	editorPaddingH:           0,
	// The Zen tab's master switch. Focus mode and letterbox are its two
	// halves; the Z badge in the bar toggles this, not focus mode alone.
	zenEnabled:               true,
	enableLetterbox:          true,
	letterboxLines:           8,
	letterboxPx:              67,
	maskPaddingH:             193,
	maskOverhang:             4,
	arrowStyle:               'solid-triangle',
	customArrowTop:           '^',
	customArrowBottom:        'v',
	arrowCount:               5,
	arrowScale:               1,
	separatorStyle:           'solid',
	separatorWeight:          2,
	highlightCurrentLine:     false,
	lineHighlightDarkColor:   '#3a3a2a',
	lineHighlightLightColor:  '#fff2b2',
	lineHighlightOpacity:     0.15,
	typewriterLinesAbove:     8,
	typewriterLinesBelow:     8,
	dimUnfocusedEnabled:      false,
	dimFocusMode:             'paragraph', // 'paragraph' | 'sentence'
	dimOpacity:               0.55,

	// ── Retro status bar ──────────────────────────────────────────────────────
	enableRetroStatus:        true,
	// statusRows is the source of truth for bar content. The old flat
	// statusFormatLeft/Center/Right keys are folded into row 0 on load and
	// then deleted, so there is never a second place holding the same text.
	statusBarRows:            2,
	statusRows: [
		{ left: '{file}', center: '{goal}', right: ' {paragraph} | {battery} | {date} {time} ' },
		{ left: '{num} {caps} {mode} {lock} ', center: '{words} words', right: '{markers} {syntax} {readtime} read' },
		{ left: '', center: '', right: '' }
	],
	readTimeWpm:              200,        // reading speed {readtime} divides by
	fileTokenFormat:          'path',     // 'path' (~/folder/name) | 'name' (basename only)
	statusBarBorderStyle:     'solid',     // matches the mask separator options
	statusBarBorderWidth:     2,           // 1–8 px; 'none' style hides it
	statusBarFontSize:        12,
	statusBarHeight:          27,
	goalTarget:               1000,
	goalDisplay:              'ring',      // 'ring' | 'fraction'
	goalBaseline:             0,          // per-vault word-count counter — never ship a non-zero default
	goalRingPercent:          true,        // draw the percentage inside the ring
	goalRingWeight:           4,           // ring stroke, in viewBox units
	dateFormat:               'dd/mm',
	// Off by default: the bar should look like part of the app it lives in,
	// not like a second app parked at the bottom of the window.
	retroCustomColors:        false,
	retroDarkBgColor:         '#050505',
	retroDarkTextColor:       '#fbfaf9',
	retroLightBgColor:        '#f5f0e8',
	retroLightTextColor:      '#050505',
	arrowDarkColor:           '#fbfaf9',
	arrowLightColor:          '#2b2b2b',
	lineDarkColor:            '#faf8f5',
	lineLightColor:           '#2b2b2b',

	// ── Misc options ──────────────────────────────────────────────────────────
	miscEnabled:              true,

	// ── Text options ──────────────────────────────────────────────────────────
	enableParagraphIndent:    true,
	paragraphIndentEm:        4,
	paragraphIndentMode:      'single',   // 'double' | 'single'
	lineSpacing:              1.5,
	editorFont:               '',        // '' = whatever the theme sets
	limitLineLength:          true,
	maxLineChars:             64,
	justifyText:              true,
	showHiddenMarkers:        false,
	markSpaces:               false,
	markTabs:                 false,
	markParagraphs:           false,
	markEndOfLines:           false,

	// ── Hemingway mode ────────────────────────────────────────────────────────
	// Every lock is individually switchable, but the defaults describe what
	// "Hemingway mode" means when you turn it on: you can type forward and
	// nothing else. Paste is the one exception — pulling in a quote or a note
	// is not self-editing, and blocking it mostly just breaks research.
	hemingwayEnabled:         false,
	hemBlockBackspace:        true,
	hemBlockDelete:           true,
	hemBlockUndo:             true,
	hemBlockCut:              true,
	hemBlockPaste:            true,
	hemBlockArrows:           false,
	hemBlockJumpKeys:         false,     // Home / End / PageUp / PageDown
	hemBlockSelectAll:        false,
	hemBlockMouse:            false,     // clicking to reposition the caret
	hemFlashTarget:           'retrobar',  // 'none' | 'screen' | 'retrobar' | 'both'

	// ── Syntax highlight ──────────────────────────────────────────────────────
	syntaxSkipCode:           true,
	posEnabled:               false,
	posDimOthers:             true,
	posNoun:                  true,
	posNounColor:             '#4f9dde',
	posVerb:                  true,
	posVerbColor:             '#4caf7d',
	posAdjective:             true,
	posAdjectiveColor:        '#d98cc4',
	posAdverb:                true,
	posAdverbColor:           '#e0913a',
	posConjunction:           true,
	posConjunctionColor:      '#9aa0a6',

	// ── Typography ────────────────────────────────────────────────────────────
	// Off by default: it rewrites the document as you type, and that is not a
	// thing to start doing to someone's notes uninvited.
	typographyEnabled:        true,
	typoSmartQuotes:          true,
	typoEllipsis:             true,
	typoDashes:               true,
	typoArrows:               true,
	typoComparisons:          false,
	typoGuillemets:           false,
	typoFractions:            true,

	// ── Sidebar word counts ───────────────────────────────────────────────────
	enableFileTreeCounts:     true,
	enableOutlineCounts:      true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

module.exports = class WordSmith extends Plugin {

	// ════════════════════════════════════════════════════════════════════════
	// LIFECYCLE
	// ════════════════════════════════════════════════════════════════════════

	async onload() {
		// ── Mask / letterbox state ─────────────────────────────────────────────
		this.maskTopEl        = null;
		this.maskBottomEl     = null;
		this.arrowsTopEl      = null;
		this.arrowsBottomEl   = null;
		this.maskResizeObserver = null;
		this._maskRaf         = null;

		// ── Retro bar state ───────────────────────────────────────────────────
		this.retroStatusBarEl = null;
		this.clockInterval    = null;
		this.batteryLevel     = null;
		this.batteryCharging  = false;
		this._batteryManager  = null;   // kept so listeners can be detached on unload
		this._batteryHandler  = null;
		this._zgLastTotalWordCount = 0;
		this._docStatsCache   = null;   // { doc, totalWC, charCount, paras } keyed on CM doc identity
		this._lastFit         = null;   // fitStatusBarText memo { text, width, base }
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
		this._cursorMemory    = {};     // path -> {line, ch, scroll}
		this._cursorLastFile  = null;   // note the poll is allowed to record for
		this._cursorLoading   = false;  // true while a restore is in flight
		this._cursorDirty     = false;  // memory changed since the last save
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
		this.styleEl          = null;

		// ── Word count cache ──────────────────────────────────────────────────
		this.explorerObserver = null;
		this.wordCountCache   = new Map();
		this._patchScheduled  = false;

		// ── Zen state ─────────────────────────────────────────────────────────
		this._isTogglingZen   = false;
		this._wasZenMode      = false;
		this._tabContainersCache = null;

		// ── Drag / refresh bookkeeping ────────────────────────────────────────
		this._activeDragCleanup = null;   // aborts an in-flight mask drag on unload
		this._refreshTimer      = null;   // debounced saveSettings → refresh

		// ── Live selection rAF ────────────────────────────────────────────────
		this._selectionRaf    = null;

		// ── Theme observer ────────────────────────────────────────────────────
		this._themeObserver   = null;

		await this.loadSettings();
		this._wasZenMode = this.settings.zenMode;

		// Zen mode persists across restarts, but _wasZenMode above makes
		// setSidebarVisibility() a no-op on the first refresh() — so a vault
		// relaunched in zen mode could come back with body classes applied yet
		// sidebars open. Force the sidebars into the zen state once the
		// workspace layout exists, without touching the saved pre-zen
		// leftSidebar/rightSidebar restore state.
		this.app.workspace.onLayoutReady(() => {
			if (!this.settings.pluginEnabled || !this.settings.zenMode) return;
			const ws = this.app.workspace;
			if (ws.leftSplit  && !ws.leftSplit.collapsed)  ws.leftSplit.collapse();
			if (ws.rightSplit && !ws.rightSplit.collapsed) ws.rightSplit.collapse();
		});

		this.addSettingTab(new WordSmithSettingTab(this.app, this));
		this.setupBattery();

		// Commands
		this.addCommand({
			id: 'toggle-wordsmith',
			name: 'Toggle Word-Smith on/off',
			callback: () => this.toggleFullPlugin()
		});
		// "WS" badge ribbon button — toggles the whole plugin on/off.
		// Obsidian's addRibbonIcon expects a Lucide icon name; we replace
		// the SVG it inserts with a text badge and use a class hook for
		// styling. The label doubles as the tooltip.
		this.wsRibbonEl = this.addRibbonIcon('type', 'Toggle Word-Smith on/off', () => this.toggleFullPlugin());
		this.wsRibbonEl.addClass('ws-ribbon-btn');
		this.wsRibbonEl.empty();
		this.wsRibbonEl.createSpan({ cls: 'ws-ribbon-badge', text: 'WS' });
		this.updateWsRibbonState();

		// Workspace events
		this.registerEvent(this.app.workspace.on('file-open', (file) => {
			this.syncScope();
			this.applyEditorFont();
			this.restoreCursorFor(file);
			this.updateWorkspaceAesthetics();
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.flushCursorMemory();
			this.syncScope();
			this.applyEditorFont();
			this.updateWorkspaceAesthetics();
			this.scheduleExplorerPatch();
			if (this.settings.zenMode && this.settings.focusedFileMode) this.updateFocusedFileMode();
			this.typewriterScroll();
		}));
		this.registerEvent(this.app.workspace.on('editor-change', () => {
			this.updateRetroStatusBar();
			this.typewriterScroll();
		}));
		this.registerEvent(this.app.workspace.on('resize', () => this.scheduleMaskPosition()));
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this._tabContainersCache = null;
			this._scopeGen++;
			if (this.settings.zenMode && this.settings.focusedFileMode) this.updateFocusedFileMode();
			// The explorer/outline observers are scoped to their leaf
			// containers, which layout changes can recreate — re-bind them.
			if (this.settings.pluginEnabled &&
				(this.settings.enableFileTreeCounts || this.settings.enableOutlineCounts)) {
				this.attachExplorerObserver();
				this.scheduleExplorerPatch();
			}
		}));

		// DOM events
		this.registerDomEvent(document, 'keyup', (evt) => {
			this.updateModifierState(evt);
			this.updateRetroStatusBar();
			this.typewriterScroll();
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
			this._selectionRaf = requestAnimationFrame(() => {
				this._selectionRaf = null;
				this.updateRetroStatusBar();
			});
		});
		// Escape exits zen mode (from new zen plugin — respects vim mode and excalidraw)
		this.registerDomEvent(document, 'keydown', (evt) => {
			this.updateModifierState(evt);
			if (evt.key === 'Escape' && this.settings.zenMode) {
				const target = evt.target;
				if (target) {
					const cmEditor = target.closest('.cm-editor');
					if (cmEditor) {
						const vault = this.app.vault;
						if (vault.config && vault.config.vimMode === true) return;
					}
					if (target instanceof HTMLTextAreaElement && target.className && target.className.includes('excalidraw')) return;
				}
				const activeModal = document.querySelector('.modal');
				if (!activeModal) { this.toggleZenMode(); evt.preventDefault(); }
			}
		});

		// Track whether the note editor itself has focus. Used to gate the
		// elevated z-index (above Cursor Smith's canvas) so masks/arrows/bar
		// only float above everything while actually writing — not above the
		// command palette, settings, context menus, or other modals, which
		// take focus away from .cm-editor.
		const updateEditorFocusClass = () => {
			const active = document.activeElement;
			const inEditor = !!(active && active.closest && active.closest('.cm-editor'));
			document.body.classList.toggle('zg-editor-focused', inEditor);
		};
		this.registerDomEvent(document, 'focusin', updateEditorFocusClass);
		this.registerDomEvent(document, 'focusout', () => requestAnimationFrame(updateEditorFocusClass));
		updateEditorFocusClass();

		// Vault events
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (this.wordCountCache) this.wordCountCache.delete(file.path);
			this.scheduleExplorerPatch();
		}));
		// Cursor positions are polled rather than observed; see cursorMem().
		this.registerInterval(window.setInterval(() => this.checkCursorChanged(), 150));
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (this._fmCache && file && file.path) delete this._fmCache[file.path];
			this._scopeGen++;
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (this.wordCountCache) this.wordCountCache.delete(oldPath);
			this.renameScopePath(oldPath, file.path);
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (this.wordCountCache) this.wordCountCache.delete(file.path);
			this.removeScopePath(file.path);
		}));

		// Theme observer. Guarded on pluginEnabled: disablePlugin() removes
		// body classes, which fires this very observer — without the guard
		// it would recreate the injected styles (line highlight etc.) and
		// re-stamp CSS variables immediately after they were removed.
		this._themeObserver = new MutationObserver(() => {
			if (!this.settings.pluginEnabled) return;
			this.applyCssVariables();
			this.updateStyleEl();
		});
		this._themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

		// CM6 decoration extensions (focus dimming + hidden markers)
		this.setupEditorExtensions();

		this.refresh();
	}

	onunload() {
		// Clean up retro bar
		this.removeCustomElements();
		this.stopClockTick();
		// Clean up style injection
		this.removeStyleEl();
		// Clean up para tagger
		// Clean up word count observer
		this.detachExplorerObserver();
		this.removeWordCounts();
		// Clean up scroll/resize handlers
		this.detachScrollHandler();
		this.detachResizeHandler();
		// Restore the native status bar (inline hide is not class-based)
		this.applyNativeStatusBarVisibility(false);
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
		if (this._hemScreenEl) { this._hemScreenEl.remove(); this._hemScreenEl = null; }
		this.closeBarPicker();
		document.querySelectorAll('.cm-editor.zg-hem-blocked')
			.forEach(el => el.classList.remove('zg-hem-blocked'));
		// Exit zen mode cleanly
		if (this.settings.zenMode) {
			this.settings.zenMode = false;
			this.applyBodyClasses();
			this.setSidebarVisibility();
		}
		document.body.classList.remove(
			'zenmode-active', 'zenmode-hide-properties', 'zenmode-hide-status-bar',
			'zenmode-hide-scroll-bar', 'zenmode-hide-title-bar',
			'zenmode-hide-linked-mentions', 'zg-para-indent', 'zg-justify', 'zg-pos-dim',
			'zg-hemingway-active', 'zg-line-limit'
		);
		document.body.removeAttribute('data-zen-hide-inline-title');
		document.body.removeAttribute('data-zen-focused-file');
		// Restore all tab containers
		document.querySelectorAll('.workspace-tabs').forEach(el => {
			el.classList.remove('zenmode-tab-hidden', 'zenmode-tab-active');
			el.style.display = '';
			el.style.width   = '';
			el.style.flex    = '';
		});
	}

	// ════════════════════════════════════════════════════════════════════════
	// SETTINGS: load, save, migrate
	// ════════════════════════════════════════════════════════════════════════

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
				for (const slot of ['left', 'center', 'right']) {
					if (typeof row[slot] === 'string' && row[slot].includes('{wpm}')) {
						row[slot] = row[slot].replace(/\s*\{wpm\}\s*(wpm)?/g, '').trim();
					}
				}
			}
		}
		delete this.settings.wpmWindowSec;
		// {nump} became {num}; {toc} and {textview} were removed. Rewrite saved
		// rows so nobody is left with literal token text in their bar.
		if (Array.isArray(this.settings.statusRows)) {
			for (const row of this.settings.statusRows) {
				if (!row) continue;
				for (const slot of ['left', 'center', 'right']) {
					if (typeof row[slot] !== 'string') continue;
					let v = row[slot]
						.split('{nump}').join('{num}')
						.replace(/\s*\{(toc|textview)\}\s*/g, ' ')
						.replace(/[ \t]{2,}/g, ' ');
					// A slot that held nothing but a removed token is empty,
					// not a lone space. Slots with real content keep whatever
					// padding the user deliberately typed around it.
					if (!v.trim()) v = '';
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
			delete this.settings[dead];
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
		// The border was a single on/off flag; width 0 is now the "off".
		if (this.settings.statusBarBorder != null) {
			if (!this.settings.statusBarBorder) this.settings.statusBarBorderWidth = 0;
			delete this.settings.statusBarBorder;
		}
		if (this.settings.goalBarCells != null) delete this.settings.goalBarCells;
		// The slim bar was dropped; the ring is the only indicator now.
		if (this.settings.goalDisplay === 'bar') this.settings.goalDisplay = 'ring';
		// goalLabel used to place text beside the indicator. The percentage
		// now lives inside the ring, so the old setting maps onto the toggle.
		if (this.settings.goalLabel != null) {
			this.settings.goalRingPercent = this.settings.goalLabel !== 'none';
			delete this.settings.goalLabel;
		}
		// The ASCII arrow style was removed (too similar to Chevron) — carry
		// anyone still on it over to the closest replacement.
		if (this.settings.arrowStyle === 'ascii') {
			this.settings.arrowStyle = 'chevron';
		}
		// Transient UI state that older versions leaked into data.json, plus
		// settings for the removed exit button. Dropped on next save.
		delete this.settings._lastArrowCount;
		delete this.settings.exitButtonVisibility;
		delete this.settings.autoHideButtonOnDesktop;
	}

	// Persist settings. By default the full refresh() (mask/observer teardown
	// and rebuild) is debounced so a slider drag firing onChange every tick
	// doesn't rebuild the world per tick — only the trailing call applies.
	// Pass applyImmediately for state changes that must land now (zen toggle,
	// master switch).
	async saveSettings(applyImmediately = false) {
		await this.saveData(this.settings);
		if (applyImmediately) {
			if (this._refreshTimer) { window.clearTimeout(this._refreshTimer); this._refreshTimer = null; }
			this.refresh();
		} else {
			this.scheduleRefresh();
		}
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
		this.updateWsRibbonState();
		if (!this.settings.pluginEnabled) { this.disablePlugin(); this.reconfigureEditors(); return; }
		// Scope decides what the rest of this method may apply, and the list
		// may have just changed, so it is resolved first.
		this._scopeGen++;
		this._lastScopeInScope = this.isActiveFileInScope();
		this.applyBodyClasses();
		this.applyCssVariables();
		this.applyEditorFont();
		this.updateStyleEl();
		this.updateWorkspaceAesthetics();
		this.setSidebarVisibility();
		this.updateFocusedFileMode();
		this.typewriterScroll();
		// The dim/marker decorations read settings only when (re)built, so a
		// settings change needs the editors reconfigured to take effect.
		this.reconfigureEditors();
		if (this.settings.enableFileTreeCounts || this.settings.enableOutlineCounts) {
			this.attachExplorerObserver();
		} else {
			this.detachExplorerObserver();
			this.removeWordCounts();
		}
	}

	// Swaps the registered extension array's contents for freshly built
	// plugin instances, then reconfigures every open editor. Both halves are
	// required: updateOptions() alone with the same extension values is a
	// no-op (CM6 keeps the old instances), and swapping without
	// updateOptions() never reaches the editors. With the plugin disabled
	// the array is emptied, which fully removes the decorations.
	reconfigureEditors() {
		if (CM && this.editorExtensions) {
			this.editorExtensions.length = 0;
			this.editorExtensions.push(...this.buildEditorExtensions());
		}
		try { this.app.workspace.updateOptions(); } catch (_) {}
	}

	// Tear down everything without unloading the plugin
	disablePlugin() {
		this.removeCustomElements();
		this.stopClockTick();
		this.removeStyleEl();
		this.detachExplorerObserver();
		this.removeWordCounts();
		this.detachScrollHandler();
		this.detachResizeHandler();
		this.applyNativeStatusBarVisibility(false);
		// Both caches hold a reference to a CodeMirror document; drop them so
		// a disabled plugin does not pin one.
		this._fenceCache = null;
		this._paraCache = null;
		this._docStatsCache = null;
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }
		// Strip all body classes and attributes
		document.body.classList.remove(
			'zenmode-active', 'zenmode-hide-properties', 'zenmode-hide-status-bar',
			'zenmode-hide-scroll-bar', 'zenmode-hide-linked-mentions', 'zg-para-indent',
			'zg-justify', 'zg-masks-active', 'zenmode-hide-ribbon', 'zg-retrobar-active',
			'zg-pos-dim', 'zg-hemingway-active', 'zg-line-limit', 'zg-editor-focused',
			'zg-font-active'
		);
		// The bar colours are stamped on <body>, so they need clearing here
		// too — the class list above does not reach them.
		document.body.style.removeProperty('--zg-bg');
		document.body.style.removeProperty('--zg-text');
		document.body.style.removeProperty('--zg-font');
		document.body.removeAttribute('data-zen-hide-inline-title');
		document.body.removeAttribute('data-zen-focused-file');
		// The horizontal padding rule is unscoped (applies always), so it
		// needs its own reset when the plugin itself is turned off.
		document.documentElement.style.removeProperty('--zg-editor-padding-h');
		// Restore tab containers
		document.querySelectorAll('.workspace-tabs').forEach(el => {
			el.classList.remove('zenmode-tab-hidden', 'zenmode-tab-active');
			el.style.display = ''; el.style.width = ''; el.style.flex = '';
		});
		// Restore sidebars
		const ws = this.app.workspace;
		if (ws.leftSplit && !ws.leftSplit.collapsed)   ws.leftSplit.expand();
		if (ws.rightSplit && !ws.rightSplit.collapsed) ws.rightSplit.expand();
		// Exit fullscreen
		if (document.fullscreenElement && document.exitFullscreen) {
			document.exitFullscreen().catch(() => {});
		}
	}

	applyBodyClasses() {
		const body = document.body;
		const zen  = this.zenActive();
		// Zen's own chrome is intentionally not scoped (see the Scope section
		// above); everything below it that touches the text is.
		const scoped = this.isActiveFileInScope();
		// The retro bar visually replaces the native status bar, so it always
		// hides it while active — independent of the separate "hide native
		// status bar in zen mode" toggle below. These used to share a single
		// setting, which meant flipping either one could silently flip the
		// other's effect (e.g. turning the retro bar on/off would overwrite
		// the zen-mode toggle's value, or vice versa).
		const hideNativeStatusBar = this.retroBarActive() || (zen && this.settings.hideStatusBar);
		body.classList.toggle('zenmode-active',             zen);
		body.classList.toggle('zenmode-hide-properties',    zen && this.settings.hideProperties);
		body.classList.toggle('zenmode-hide-status-bar',    hideNativeStatusBar);
		this.applyNativeStatusBarVisibility(hideNativeStatusBar);
		body.classList.toggle('zenmode-hide-scroll-bar',    zen && this.settings.hideScrollBar);
		body.classList.toggle('zenmode-hide-linked-mentions', zen && this.settings.hideLinkedMentions);
		body.classList.toggle('zenmode-hide-ribbon',        zen && this.settings.hideRibbon);
		body.classList.toggle('zg-para-indent',             scoped && this.settings.enableParagraphIndent);
		body.classList.toggle('zg-justify',                 scoped && this.settings.justifyText);
		body.classList.toggle('zg-line-limit',              scoped && this.settings.limitLineLength);
		body.classList.toggle('zg-masks-active',            scoped && this.letterboxActive());
		body.classList.toggle('zg-pos-dim',                 scoped && this.settings.posEnabled && this.settings.posDimOthers);
		body.classList.toggle('zg-hemingway-active',        scoped && this.settings.hemingwayEnabled);
		if (zen) {
			body.setAttribute('data-zen-hide-inline-title', String(this.settings.hideInlineTitle));
			body.setAttribute('data-zen-focused-file',      String(this.settings.focusedFileMode));
		} else {
			body.removeAttribute('data-zen-hide-inline-title');
			body.removeAttribute('data-zen-focused-file');
		}
	}

	// Hides/restores the native status bar via an inline
	// display:none!important. The class-based CSS rule alone proved
	// unreliable: themes and snippets commonly style .status-bar with
	// higher-specificity or !important rules that outrank a descendant
	// selector, which let the native bar show through the retro bar's
	// goal-met flash (whose strobe dips the retro bar's opacity). An inline
	// important declaration cannot be beaten by any stylesheet rule.
	applyNativeStatusBarVisibility(hide) {
		const nb = document.querySelector('.status-bar');
		if (!nb) return;
		if (hide) nb.style.setProperty('display', 'none', 'important');
		else nb.style.removeProperty('display');
	}

	applyCssVariables() {
		const root = document.documentElement.style;
		root.setProperty('--zg-editor-padding-h',    this.settings.editorPaddingH + 'px');
		// (z-index vars intentionally not stamped here — the stylesheet
		// defaults already provide them, and inline values on :root would
		// still lose to the elevated body.zg-masks-active values anyway.)
		root.setProperty('--zen-mode-top-padding',    this.settings.topPadding + 'px');
		root.setProperty('--zen-mode-bottom-padding', this.settings.bottomPadding + 'px');

		// Arrow size is a vw-based clamp() in styles.css so it tracks window
		// resizes with zero JS; only the user's scale multiplier is stamped.
		root.setProperty('--zg-arrow-scale',          String(this.settings.arrowScale || 1));
		root.setProperty('--zg-separator-style',      this.settings.separatorStyle);
		root.setProperty('--zg-separator-weight',     this.settings.separatorWeight + 'px');
		root.setProperty('--zg-status-bar-font-size', this.settings.statusBarFontSize + 'px');
		// Row height is what the user sets; the bar's own height is the
		// product, so mask positioning and the cm-panels-bottom offset keep
		// working unchanged against --zg-status-bar-height.
		const barRows = Math.max(1, Math.min(3, this.settings.statusBarRows || 1));
		root.setProperty('--zg-status-row-height',    this.settings.statusBarHeight + 'px');
		root.setProperty('--zg-status-bar-height',    (this.settings.statusBarHeight * barRows) + 'px');
		root.setProperty('--zg-para-indent',          (this.settings.paragraphIndentEm || 2) + 'em');
		root.setProperty('--zg-mask-overhang',        (this.settings.maskOverhang || 4) + 'px');

		const isDark = document.body.classList.contains('theme-dark');
		// These two go on <body>, not <html>. Obsidian defines
		// --background-primary on body.theme-dark / body.theme-light, so
		// `var(--background-primary)` written at :root has nothing to resolve
		// against: the variable computes to invalid and the bar renders
		// transparent. On body the reference resolves normally.
		const barRoot = document.body.style;
		if (this.settings.retroCustomColors) {
			barRoot.setProperty('--zg-bg',   isDark ? this.settings.retroDarkBgColor   : this.settings.retroLightBgColor);
			barRoot.setProperty('--zg-text', isDark ? this.settings.retroDarkTextColor : this.settings.retroLightTextColor);
		} else {
			barRoot.setProperty('--zg-bg',   'var(--background-primary)');
			barRoot.setProperty('--zg-text', 'var(--text-normal)');
		}
		root.setProperty('--zg-arrow-color', isDark ? this.settings.arrowDarkColor      : this.settings.arrowLightColor);
		root.setProperty('--zg-line-color',  isDark ? this.settings.lineDarkColor       : this.settings.lineLightColor);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Injected styles
	// ─────────────────────────────────────────────────────────────────────────

	updateStyleEl() {
		if (!this.settings.pluginEnabled) { this.removeStyleEl(); return; }
		if (!this.styleEl) {
			this.styleEl = document.head.createEl('style');
			this.styleEl.id = 'zengrinder-injected';
		}
		const rules = [];
		if (this.settings.enableParagraphIndent) {
			const ind = 'var(--zg-para-indent)';
			// Source view is driven entirely by the paraPlugin decoration, so
			// these selectors never need to know what a list line looks like.
			if (this.settings.paragraphIndentMode === 'single') {
				rules.push('.zg-para-indent .zg-para-line { text-indent: ' + ind + ' !important; }');
				rules.push('.zg-para-indent .markdown-preview-view p { text-indent: ' + ind + ' !important; }');
			} else {
				rules.push('.zg-para-indent .zg-para-first { text-indent: ' + ind + ' !important; }');
				rules.push('.zg-para-indent .markdown-preview-view p + p { text-indent: ' + ind + ' !important; }');
			}
			// Reading view renders list items, quotes, callouts and table cells
			// as <p> too, so the rules above catch them. Rather than a fragile
			// :not() chain, indent every paragraph and then take it back from
			// the containers where it does not belong.
			rules.push([
				'.zg-para-indent .markdown-preview-view li p',
				'.zg-para-indent .markdown-preview-view blockquote p',
				'.zg-para-indent .markdown-preview-view td p',
				'.zg-para-indent .markdown-preview-view th p',
				'.zg-para-indent .markdown-preview-view .callout p',
				'.zg-para-indent .markdown-preview-view figcaption'
			].join(',\n') + ' { text-indent: 0 !important; }');
		}
		if (this.settings.editorFont || this.opt('editorFont')) {
			// !important and the full chain for the same reason as the line
			// measure: themes set font-family on these elements directly.
			rules.push('body.zg-font-active .markdown-source-view.mod-cm6 .cm-content,\n' +
				'body.zg-font-active .markdown-reading-view .markdown-preview-view ' +
				'{ font-family: var(--zg-font) !important; }');
		}
		if (this.settings.limitLineLength) {
			// ch is the width of a "0", which is the conventional stand-in for
			// a character in a proportional face. The horizontal padding is
			// added back on top so the measure is the *text* column rather
			// than the box, whatever the padding is set to.
			const measure = 'calc(' + Math.max(20, Math.min(200, this.settings.maxLineChars || 64))
				+ 'ch + (var(--zg-editor-padding-h) * 2))';
			// !important and the .cm-content chain are both needed: zen mode
			// sets max-width:100% on this very element a few rules above.
			rules.push('.zg-line-limit .markdown-source-view.mod-cm6 .cm-content { max-width: ' + measure +
				' !important; margin-left: auto !important; margin-right: auto !important; }');
			rules.push('.zg-line-limit .markdown-reading-view .markdown-preview-view { max-width: ' + measure +
				' !important; margin-left: auto !important; margin-right: auto !important; }');
		}
		if (this.settings.justifyText) {
			// Justify in the source editor (skip code blocks and table cells).
			// The .cm-line selector is chained through .cm-content so it wins
			// over theme styles without !important in most cases.
			rules.push('.zg-justify .cm-content .cm-line { text-align: justify; text-align-last: left; }');
			// Reading view: paragraphs and list items.
			rules.push('.zg-justify .markdown-preview-view p, .zg-justify .markdown-preview-view li { text-align: justify; }');
		}
		if (this.settings.lineSpacing && this.settings.lineSpacing !== 1.5) {
			const ls = String(this.settings.lineSpacing);
			rules.push('.cm-content { line-height: ' + ls + ' !important; }');
			rules.push('.markdown-preview-view { line-height: ' + ls + ' !important; }');
		}
		if (this.settings.highlightCurrentLine) {
			const isDark = document.body.classList.contains('theme-dark');
			const hex     = isDark ? this.settings.lineHighlightDarkColor : this.settings.lineHighlightLightColor;
			const opacity = this.settings.lineHighlightOpacity != null ? this.settings.lineHighlightOpacity : 0.35;
			rules.push('.cm-active.cm-line { background-color: ' + this.hexToRgba(hex, opacity) + ' !important; }');
		}
		if (this.settings.dimUnfocusedEnabled) {
			const opacity = this.settings.dimOpacity != null ? this.settings.dimOpacity : 0.35;
			rules.push('.zg-dim-line, .zg-dim-text { opacity: ' + opacity + '; transition: opacity 0.15s ease; }');
		}
		// ── Syntax highlight ──────────────────────────────────────────────
		if (this.settings.posEnabled) {
			const pos = [
				['noun', this.settings.posNoun,        this.settings.posNounColor],
				['verb', this.settings.posVerb,        this.settings.posVerbColor],
				['adj',  this.settings.posAdjective,   this.settings.posAdjectiveColor],
				['adv',  this.settings.posAdverb,      this.settings.posAdverbColor],
				['conj', this.settings.posConjunction, this.settings.posConjunctionColor]
			];
			for (const entry of pos) {
				if (entry[1]) rules.push('.zg-pos-' + entry[0] + ' { color: ' + entry[2] + '; }');
			}
			// Muting everything else is what makes one class read as the
			// sentence's skeleton. The mark spans set their own colour and are
			// separate elements, so this ancestor rule never outranks them
			// however specific it is.
			if (this.settings.posDimOthers) {
				rules.push('body.zg-pos-dim .markdown-source-view.mod-cm6 .cm-content .cm-line { color: var(--text-faint); }');
			}
		}

		this.styleEl.textContent = rules.join('\n');
		if (this.settings.enableParagraphIndent && this.settings.paragraphIndentMode !== 'single') {
		} else {
		}
	}

	removeStyleEl() {
		if (this.styleEl) { this.styleEl.remove(); this.styleEl = null; }
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
	async toggleSetting(key, ensurePos) {
		this.settings[key] = !this.settings[key];
		if (ensurePos && this.settings[key]) this.settings.posEnabled = true;
		await this.saveSettings(true);
	}

	async toggleZenMode() {
		if (this._isTogglingZen) return;
		this._isTogglingZen = true;
		try {
			// If the plugin is off, turn it on first — zen mode depends on the
			// body classes, masks, and observers that refresh()/applyBodyClasses()
			// set up, none of which run while pluginEnabled is false. Flipping
			// the flag here and letting saveSettings() → refresh() below handle
			// the wiring means the command works from either state.
			if (!this.settings.pluginEnabled) this.settings.pluginEnabled = true;
			const entering = !this.settings.zenMode;

			if (entering) {
				if (this.settings.focusedFileMode) await this.revealPinnedTabIfExists();
				if (this.settings.fullscreen && document.documentElement.requestFullscreen) {
					try {
						await document.documentElement.requestFullscreen();
						await new Promise(r => requestAnimationFrame(r));
					} catch (_) {}
				}
				this.settings.zenMode = true;
			} else {
				if (document.fullscreenElement && document.exitFullscreen) {
					try {
						await document.exitFullscreen();
						await new Promise(r => requestAnimationFrame(r));
					} catch (_) {}
				}
				this.settings.zenMode = false;
			}
			await this.saveSettings(true);
		} finally {
			this._isTogglingZen = false;
		}
	}

	async toggleFullPlugin() {
		const next = !this.settings.pluginEnabled;
		if (!next && this.settings.zenMode) {
			// Exit zen mode cleanly (fullscreen, sidebars, saved state) while
			// the plugin is still enabled — toggleZenMode() no-ops once
			// pluginEnabled is false.
			await this.toggleZenMode();
		}
		this.settings.pluginEnabled = next;
		await this.saveSettings(true); // refresh() tears everything down or re-applies it
	}

	updateWsRibbonState() {
		if (!this.wsRibbonEl) return;
		this.wsRibbonEl.classList.toggle('is-disabled', !this.settings.pluginEnabled);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Sidebar management (from new zen plugin)
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// ZEN CHROME: sidebars, tabs, focused-file mode
	// ════════════════════════════════════════════════════════════════════════

	setSidebarVisibility() {
		if (this.settings.zenMode === this._wasZenMode) return;
		const ws = this.app.workspace;
		if (!ws.leftSplit || !ws.rightSplit) return;
		if (!this.settings.zenMode) {
			if (!this.settings.leftSidebar)  ws.leftSplit.expand();
			if (!this.settings.rightSidebar) ws.rightSplit.expand();
		} else {
			this.settings.rightSidebar = ws.rightSplit.collapsed;
			this.settings.leftSidebar  = ws.leftSplit.collapsed;
			if (!ws.leftSplit.collapsed)  ws.leftSplit.collapse();
			if (!ws.rightSplit.collapsed) ws.rightSplit.collapse();
		}
		this._wasZenMode = this.settings.zenMode;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Focused file mode (from new zen plugin)
	// ─────────────────────────────────────────────────────────────────────────

	getTabContainerFromLeaf(leaf) {
		if (!leaf) return null;
		const el = leaf.containerEl || null;
		if (!el) return null;
		const tc = el.closest('.workspace-tabs');
		return (tc instanceof HTMLElement) ? tc : null;
	}

	async revealPinnedTabIfExists() {
		try {
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				let pinned = leaf.pinned === true;
				if (!pinned && leaf.view && leaf.view.getState) {
					const s = leaf.view.getState();
					if (s.pinned === true) pinned = true;
				}
				if (!pinned && leaf.containerEl) {
					const th = leaf.containerEl.querySelector('.workspace-tab-header');
					if (th && (th.classList.contains('is-pinned') || th.hasAttribute('data-pinned'))) pinned = true;
				}
				if (pinned) {
					await this.app.workspace.revealLeaf(leaf);
					await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
					return;
				}
			}
		} catch (_) {}
	}

	findActiveTabContainerFromDOM() {
		const active = document.querySelector('.workspace-tab-header.is-active');
		if (active) {
			const tc = active.closest('.workspace-tabs');
			if (tc instanceof HTMLElement) return tc;
		}
		for (const c of Array.from(document.querySelectorAll('.workspace-tabs'))) {
			const el = c;
			if (el.offsetParent !== null && !el.classList.contains('zenmode-tab-hidden')) return el;
		}
		return null;
	}

	async updateFocusedFileMode() {
		if (!this.settings.zenMode || !this.settings.focusedFileMode) {
			document.querySelectorAll('.workspace-tabs').forEach(el => {
				el.classList.remove('zenmode-tab-hidden', 'zenmode-tab-active');
				el.style.display = ''; el.style.width = ''; el.style.flex = '';
			});
			return;
		}
		await this.revealPinnedTabIfExists();
		if (!this._tabContainersCache) {
			this._tabContainersCache = Array.from(document.querySelectorAll('.workspace-tabs'));
		}
		const all = this._tabContainersCache;
		let active = null;
		for (const c of all) {
			const pinned = c.querySelectorAll('.workspace-tab-header.is-pinned, .workspace-tab-header[data-pinned="true"]');
			if (pinned.length > 0) { active = c; break; }
		}
		if (!active) {
			const leaf = this.app.workspace.getMostRecentLeaf();
			if (leaf) active = this.getTabContainerFromLeaf(leaf);
		}
		if (!active) active = this.findActiveTabContainerFromDOM();
		if (!active) return;
		all.forEach(c => {
			if (c === active) {
				c.classList.remove('zenmode-tab-hidden');
				c.style.display = ''; c.style.width = '100%'; c.style.flex = '1 1 100%';
			} else {
				c.classList.add('zenmode-tab-hidden');
				c.style.display = 'none';
			}
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Workspace aesthetics (letterbox + retro bar)
	// ─────────────────────────────────────────────────────────────────────────

	updateWorkspaceAesthetics() {
		// Event handlers (active-leaf-change etc.) call this unconditionally;
		// without this guard, opening a note rebuilds the retro bar and masks
		// even while the plugin is toggled off.
		if (!this.settings.pluginEnabled) return;
		// Retro status bar: independent of zen mode
		this.updateStatusBar();
		this.updateRetroStatusBar();

		// The paragraph tagger is scoped to the active editor's .cm-content,
		// so it needs re-binding whenever the active leaf changes.
		if (this.settings.enableParagraphIndent && this.settings.paragraphIndentMode !== 'single') {
		}
		// (Focus dimming and hidden markers are CM6 decorations registered
		// once via registerEditorExtension — they follow every editor
		// automatically and need no per-leaf re-binding here.)

		// Letterbox masks + typewriter: driven by enableTypewriter, not zenMode,
		// and only where the plugin is scoped to apply.
		const scoped = this.isActiveFileInScope();
		// Masks follow letterbox, not typewriter. They are separate features
		// and toggling one should never silently take the other with it.
		if (this.letterboxActive() && scoped) {
			this.buildMaskElements();
		} else {
			this.removeMaskElements();
		}

		// Positioning (masks AND/OR retro bar width) needs the scroll/resize
		// wiring whenever either feature is visible.
		if (((this.settings.enableTypewriter || this.letterboxActive()) && scoped) || this.retroBarActive()) {
			this.attachScrollHandler();
			this.attachResizeHandler();
			this.scheduleMaskPosition();
		} else {
			this.detachScrollHandler();
			this.detachResizeHandler();
		}
	}

	// Remove only mask/arrow elements (not the retro bar)
	removeMaskElements() {
		for (const el of [this.maskTopEl, this.maskBottomEl, this.arrowsTopEl, this.arrowsBottomEl]) {
			if (el) el.remove();
		}
		this.maskTopEl = this.maskBottomEl = this.arrowsTopEl = this.arrowsBottomEl = null;
		document.documentElement.style.setProperty('--zg-scroller-pad-top',    '0px');
		document.documentElement.style.setProperty('--zg-scroller-pad-bottom', '0px');
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Retro status bar
	// ─────────────────────────────────────────────────────────────────────────

	// The retro bar is one fixed element shared by every pane, so it follows
	// the active file's scope rather than any single editor's.
	retroBarActive() {
		return this.settings.enableRetroStatus && this.isActiveFileInScope();
	}

	updateStatusBar() {
		const wantBar = this.retroBarActive();
		if (wantBar && !this.retroStatusBarEl) {
			this.retroStatusBarEl = document.body.createEl('div', { cls: 'zengrinder-status-bar' });
			this.startClockTick();
		} else if (!wantBar && this.retroStatusBarEl) {
			this.retroStatusBarEl.remove();
			this.retroStatusBarEl = null;
			this.stopClockTick();
		}
		if (this.retroStatusBarEl) {
			const bw    = Math.max(1, Math.min(8, this.settings.statusBarBorderWidth || 2));
			const style = this.settings.statusBarBorderStyle || 'solid';
			this.retroStatusBarEl.style.borderTopWidth = style === 'none' ? '0' : bw + 'px';
			this.retroStatusBarEl.style.borderTopStyle = style;
			this.retroStatusBarEl.style.borderTopColor = 'var(--zg-text)';
		}
		// Body class lets CSS lift bottom editor panels (vim ":" command
		// line etc.) above the bar — see styles.css.
		document.body.classList.toggle('zg-retrobar-active', !!this.retroStatusBarEl);
		// Re-stamp on every call (runs on leaf changes) so a status bar
		// element created after plugin load is still caught.
		this.applyNativeStatusBarVisibility(
			wantBar || (this.settings.zenMode && this.settings.hideStatusBar));
		this.applyCssVariables();
	}

	startClockTick() {
		if (this.clockInterval) return;
		// registerInterval → Obsidian clears it automatically on unload
		this.clockInterval = this.registerInterval(window.setInterval(() => this.updateRetroStatusBar(), 15000));
	}

	stopClockTick() {
		if (this.clockInterval) { window.clearInterval(this.clockInterval); this.clockInterval = null; }
	}

	async setupBattery() {
		if (!navigator.getBattery) return;
		try {
			const bm = await navigator.getBattery();
			const update = () => {
				this.batteryLevel    = Math.round(bm.level * 100);
				this.batteryCharging = bm.charging;
				this.updateRetroStatusBar();
			};
			this._batteryManager = bm;
			this._batteryHandler = update;
			bm.addEventListener('levelchange', update);
			bm.addEventListener('chargingchange', update);
			update();
		} catch (_) {}
	}

	formatBattery() {
		if (this.batteryLevel === null) return '?%';
		return (this.batteryCharging ? '⚡︎' : '') + this.batteryLevel + '%';
	}

	// Converts a #rrggbb / #rgb hex color plus an alpha (0–1) into an
	// rgba() string, so a single color-picker + slider pair can produce a
	// translucent highlight without needing CSS color-mix() support.
	hexToRgba(hex, alpha) {
		if (!hex) return 'transparent';
		let h = hex.replace('#', '');
		if (h.length === 3) h = h.split('').map(c => c + c).join('');
		const r = parseInt(h.substring(0, 2), 16) || 0;
		const g = parseInt(h.substring(2, 4), 16) || 0;
		const b = parseInt(h.substring(4, 6), 16) || 0;
		const a = Math.max(0, Math.min(1, alpha != null ? alpha : 1));
		return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
	}

	formatDate(now) {
		const dd = String(now.getDate()).padStart(2, '0');
		const mm = String(now.getMonth() + 1).padStart(2, '0');
		const yyyy = String(now.getFullYear());
		const yy   = yyyy.slice(-2);
		return (this.settings.dateFormat || 'dd/mm/yyyy')
			.replace(/yyyy/g, yyyy).replace(/yy/g, yy).replace(/mm/g, mm).replace(/dd/g, dd);
	}

	formatTime(now) {
		return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
	}

	// ════════════════════════════════════════════════════════════════════════
	// CURSOR MEMORY
	// ════════════════════════════════════════════════════════════════════════

	// Modelled on dy-sh's Remember Cursor Position, which the reference plugin
	// also derives from. Two things make it work where an editor update
	// listener did not:
	//
	//   1. Recording is a poll, not an event. There is then no window in which
	//      Obsidian's own caret placement can be mistaken for the reader's,
	//      and no need to map an editor back to the file it is showing.
	//
	//   2. Restoring waits for currentMode.getScroll() to return a number,
	//      which is the first moment the view genuinely holds the new
	//      document. Frame counts and fixed delays are guesses; this is the
	//      actual readiness signal, and guessing is what failed twice.
	cursorMem() {
		if (!this._cursorMemory) {
			this._cursorMemory = Object.assign({}, (this.settings && this.settings.cursorMemory) || {});
		}
		return this._cursorMemory;
	}

	// Cursor plus scroll: restoring the caret without the scroll still leaves
	// you looking at the top of the note.
	captureCursorState() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		const out = {};
		if (view.editor && view.editor.getCursor) {
			const c = view.editor.getCursor();
			if (c) { out.line = c.line; out.ch = c.ch; }
		}
		try {
			if (view.currentMode && view.currentMode.getScroll) {
				const sc = view.currentMode.getScroll();
				if (sc != null) out.scroll = sc;
			}
		} catch (_) { /* preview mode may not expose it yet */ }
		return (out.line != null || out.scroll != null) ? out : null;
	}

	// Runs on an interval. Skipped entirely while a restore is in flight, and
	// while the active file is not the one we last restored — which is the
	// window where the editor still holds the outgoing document.
	checkCursorChanged() {
		if (!this.settings.restoreCursorPosition || this._cursorLoading) return;
		const file = this.app.workspace.getActiveFile();
		if (!file || !file.path || this._cursorLastFile !== file.path) return;
		const st = this.captureCursorState();
		if (!st) return;
		const prev = this.cursorMem()[file.path];
		if (prev && prev.line === st.line && prev.ch === st.ch && prev.scroll === st.scroll) return;
		this.cursorMem()[file.path] = st;
		this._cursorDirty = true;
	}

	flushCursorMemory() {
		if (!this.settings.restoreCursorPosition || !this._cursorDirty) return;
		const mem  = this.cursorMem();
		const keys = Object.keys(mem);
		// Bounded, or a long-lived vault turns data.json into a cursor log.
		if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete mem[k];
		this.settings.cursorMemory = mem;
		this._cursorDirty = false;
		this.saveSettings();
	}

	async restoreCursorFor(file) {
		if (!this.settings.restoreCursorPosition) return;
		const path = file && file.path;
		if (!path || this._cursorLastFile === path) return;

		this._cursorLoading = true;
		this._cursorLastFile = path;
		const saved = this.cursorMem()[path];
		if (saved) {
			// Poll for readiness rather than assuming a delay is enough.
			for (let i = 0; i < 25; i++) {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				let ready = false;
				try {
					ready = !!(view && view.file && view.file.path === path &&
						view.currentMode && view.currentMode.getScroll &&
						view.currentMode.getScroll() != null);
				} catch (_) { ready = false; }
				if (ready) break;
				await new Promise(r => window.setTimeout(r, 20));
			}
			this.applyCursorState(saved, path);
		}
		this._cursorLoading = false;
	}

	applyCursorState(st, path) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file || view.file.path !== path) return;
		if (st.line != null && view.editor) {
			const last = view.editor.lastLine();
			const line = Math.max(0, Math.min(st.line, last));
			const ch   = Math.max(0, Math.min(st.ch || 0, (view.editor.getLine(line) || '').length));
			view.editor.setCursor({ line, ch });
		}
		if (st.scroll != null && view.currentMode && view.currentMode.applyScroll) {
			try { view.currentMode.applyScroll(st.scroll); } catch (_) { /* not in this mode */ }
		}
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
	//   ws-syntax: true
	//   ws-markers: false
	//   ws-typography: false
	//   ws-goal: 2000        word target for this note
	//
	// Cached per path and dropped whenever the metadata cache reports a
	// change, so editing the frontmatter takes effect on the next repaint.
	getOverrides(file) {
		if (!file || !file.path) return null;
		if (!this._fmCache) this._fmCache = {};
		if (Object.prototype.hasOwnProperty.call(this._fmCache, file.path)) {
			return this._fmCache[file.path];
		}
		let fm = null;
		try {
			const cache = this.app.metadataCache && this.app.metadataCache.getFileCache(file);
			fm = cache && cache.frontmatter;
		} catch (_) { fm = null; }

		let out = null;
		if (fm) {
			// YAML gives booleans for true/false but strings for on/off/yes/no,
			// and people write all of them.
			const isOff = v => v === false || /^(false|off|no)$/i.test(String(v));
			const isOn  = v => v === true  || /^(true|on|yes)$/i.test(String(v));
			const add   = (k, v) => { (out = out || {})[k] = v; };

			if ('wordsmith' in fm) add('__disabled', isOff(fm.wordsmith));
			const MAP = {
				'ws-zen':        'zenMode',
				'ws-typewriter': 'enableTypewriter',
				'ws-hemingway':  'hemingwayEnabled',
				'ws-syntax':     'posEnabled',
				'ws-markers':    'showHiddenMarkers',
				'ws-typography': 'typographyEnabled'
			};
			for (const key in MAP) {
				if (!(key in fm)) continue;
				if (isOn(fm[key]))       add(MAP[key], true);
				else if (isOff(fm[key])) add(MAP[key], false);
			}
			const goal = Number(fm['ws-goal']);
			if (!isNaN(goal) && goal > 0) add('goalTarget', Math.round(goal));
			// A font name, or an explicit empty string to fall back to the
			// theme for this one note.
			if ('ws-font' in fm) add('editorFont', String(fm['ws-font'] || '').trim());
		}
		this._fmCache[file.path] = out;
		return out;
	}

	// Effective value of a setting for a given note.
	optFor(file, key) {
		const o = this.getOverrides(file);
		if (o && Object.prototype.hasOwnProperty.call(o, key)) return o[key];
		return this.settings[key];
	}

	// Same, for the note in the active pane.
	opt(key) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return this.optFor(view ? view.file : null, key);
	}

	// And for whichever note a given editor is showing.
	optForView(cmView, key) {
		return this.optFor(this.getFileForEditorView(cmView), key);
	}

	// Focus mode and letterbox are the two halves of Zen. Letterbox used to be
	// gated on typewriter instead, which is why turning typewriter off took
	// the masks with it — two unrelated features sharing one flag.
	zenActive() {
		return !!(this.opt('zenEnabled') && this.opt('zenMode'));
	}

	letterboxActive() {
		return !!(this.opt('zenEnabled') && this.settings.enableLetterbox);
	}

	hasScopeLimits() {
		return Array.isArray(this.settings.scopePaths) && this.settings.scopePaths.length > 0;
	}

	// True when the path is named by the list, either exactly (a note) or as
	// an ancestor (a folder). Prefix matching appends the separator so that
	// "Novel" does not also claim "Novel Ideas/draft.md".
	pathMatchesScope(path) {
		if (!path) return false;
		for (const entry of this.settings.scopePaths) {
			if (!entry) continue;
			if (entry === '/') return true;                 // vault root
			if (path === entry) return true;
			if (path.startsWith(entry.endsWith('/') ? entry : entry + '/')) return true;
		}
		return false;
	}

	isFileInScope(file) {
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
		// No "no limits configured" shortcut here: frontmatter can disable a
		// note on its own, and the shortcut used to return true before the
		// override was ever read. getOverrides is cached, so this is cheap.
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return this.isFileInScope(view ? view.file : null);
	}

	// Which file a given CodeMirror view is showing. Needed because split
	// panes can hold one in-scope and one out-of-scope note at the same time,
	// and the decorations have to follow their own editor, not the active one.
	getFileForEditorView(cmView) {
		let found = null;
		try {
			this.app.workspace.iterateAllLeaves(leaf => {
				if (found) return;
				const v = leaf && leaf.view;
				if (v && v.editor && v.editor.cm === cmView) found = v.file || null;
			});
		} catch (_) {}
		return found;
	}

	// Memoised against a generation counter that every file/layout change
	// bumps, so the leaf walk above happens once per editor per change rather
	// than once per repaint.
	isEditorInScope(cmView) {
		if (!cmView) return true;
		// Same reasoning as isActiveFileInScope: the file has to be resolved
		// even with no path list, because its frontmatter may opt out. The
		// generation memo below keeps that to one leaf walk per editor per
		// file/layout change rather than one per repaint.
		if (cmView._zgScope && cmView._zgScope.gen === this._scopeGen) return cmView._zgScope.in;
		const val = this.isFileInScope(this.getFileForEditorView(cmView));
		cmView._zgScope = { gen: this._scopeGen, in: val };
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
	}

	// Keep the list pointing at real paths as notes and folders move. Without
	// this, renaming a folder silently orphans its entry and the plugin stops
	// applying somewhere the user still expects it.
	async renameScopePath(oldPath, newPath) {
		if (!this.hasScopeLimits() || !oldPath || !newPath) return;
		const list = this.settings.scopePaths;
		let changed = false;
		for (let i = 0; i < list.length; i++) {
			if (list[i] === oldPath) { list[i] = newPath; changed = true; }
			else if (list[i].startsWith(oldPath + '/')) {
				list[i] = newPath + list[i].slice(oldPath.length);
				changed = true;
			}
		}
		if (changed) await this.saveSettings(true);
	}

	async removeScopePath(path) {
		if (!this.hasScopeLimits() || !path) return;
		const list = this.settings.scopePaths;
		const next = list.filter(p => p !== path && !p.startsWith(path + '/'));
		if (next.length !== list.length) {
			this.settings.scopePaths = next;
			await this.saveSettings(true);
		}
	}

	// ════════════════════════════════════════════════════════════════════════
	// DOCUMENT ANALYSIS: counting, paragraphs, non-prose lines
	// ════════════════════════════════════════════════════════════════════════

	getFilePath(view) {
		const file = view && view.file;
		if (!file) return 'no file';
		if (this.settings.fileTokenFormat === 'name') return file.basename;
		const parts = file.path.split('/');
		return (parts.length <= 1 ? '~/' : '~/' + parts.slice(0, -1).join('/') + '/') + file.basename;
	}

	// Strip a leading YAML frontmatter block. Frontmatter inflates word
	// counts on heavily-tagged notes and makes goals inconsistent with
	// Obsidian's own counter.
	stripFrontmatter(text) {
		if (text.startsWith('---\n') || text.startsWith('---\r\n')) {
			const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
			if (m) return text.slice(m[0].length);
		}
		return text;
	}

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
	countProse(text) {
		if (!text) return { words: 0, chars: 0 };
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

		return {
			words: cjk + runs,
			chars: prose.replace(/\s+/g, ' ').trim().length
		};
	}

	countWords(text) {
		return this.countProse(text).words;
	}

	// Doc-derived stats (total word count, char count, paragraph ranges),
	// cached on the CodeMirror doc object — reference equality means the
	// cache only invalidates after actual edits, so the selection/cursor
	// paths never re-split a 50k-word note just to redraw the bar.
	getDocStats(view) {
		const editor = view.editor;
		const doc = editor && editor.cm && editor.cm.state ? editor.cm.state.doc : null;
		if (doc && this._docStatsCache && this._docStatsCache.doc === doc) {
			return this._docStatsCache;
		}
		const full      = view.getViewData();
		const prose     = this.countProse(full);
		const totalWC   = prose.words;
		// Was full.length, which counted the frontmatter that totalWC strips —
		// so {words} and {chars} described different documents.
		const charCount = prose.chars;
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
		const stats = { doc, totalWC, charCount, paras };
		if (doc) this._docStatsCache = stats; // only cache when identity is trackable
		return stats;
	}

	// Line numbers the prose analyser must not touch: YAML frontmatter, fenced
	// code (``` and ~~~), and $$ math blocks. Cached on CodeMirror doc
	// identity exactly like getDocStats, so it costs one scan per edit rather
	// than one per repaint.
	getNonProseLines(doc) {
		if (this._fenceCache && this._fenceCache.doc === doc) return this._fenceCache.set;
		// On very large notes the whole-document scan is not worth paying on
		// every keystroke. Per-line inline masking still applies, so the only
		// thing lost is multi-line fence awareness.
		const set = doc.length > 400000
			? new Set()
			: scanNonProseLines(doc.toString().split('\n'));
		this._fenceCache = { doc, set };
		return set;
	}

	// Which lines are body paragraphs, and which of those open one. Cached on
	// document identity like the fence map, and computed over the whole
	// document rather than the viewport: whether a paragraph is the *first*
	// one depends on lines that may be scrolled far out of sight.
	getParagraphLines(doc) {
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
	}

	getParagraphInfo(view, stats) {
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
	}

	formatGoal(total) {
		const count  = Math.max(0, total - (this.settings.goalBaseline || 0));
		const target = this.settings.goalTarget || 1000;
		const ratio  = Math.min(count / target, 1);
		return { text: count.toLocaleString() + '/' + target.toLocaleString(), ratio, met: count >= target };
	}

	// ════════════════════════════════════════════════════════════════════════
	// RETRO BAR: rows, modes, pickers
	// ════════════════════════════════════════════════════════════════════════

	// Normalised row list — always exactly statusBarRows entries, each with
	// left/center/right strings, regardless of what data.json holds.
	getStatusRows() {
		const n   = Math.max(1, Math.min(3, this.settings.statusBarRows || 1));
		const src = Array.isArray(this.settings.statusRows) ? this.settings.statusRows : [];
		const out = [];
		for (let i = 0; i < n; i++) {
			out.push(Object.assign({ left: '', center: '', right: '' }, src[i] || {}));
		}
		return out;
	}

	// The three modes that change how the editor behaves. Typewriter and
	// Hemingway are scope-gated because they genuinely stop applying on an
	// out-of-scope note; zen is not, because its chrome is workspace-wide.
	// An empty result is a real answer here — no modes on — not a failure.
	// All three, each with its live state. The bar shows every one of them so
	// the badges can double as switches — a mode you cannot see is a mode you
	// cannot turn back on from here.
	getAllModes() {
		const scoped = this.isActiveFileInScope();
		return [
			{ key: 'tw',  letter: 'T', label: 'Typewriter mode', setting: 'enableTypewriter',
			  on: !!this.opt('enableTypewriter') && scoped },
			{ key: 'hem', letter: 'H', label: 'Hemingway mode',  setting: 'hemingwayEnabled',
			  on: !!this.opt('hemingwayEnabled') && scoped },
			{ key: 'zen', letter: 'Z', label: 'Zen',             setting: 'zenEnabled',
			  on: !!this.opt('zenEnabled') }
		];
	}

	getActiveModes() {
		return this.getAllModes().filter(m => m.on);
	}

	getModeLabel() {
		return this.getActiveModes().map(m => m.letter).join('');
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Bar pickers
	//
	// Obsidian's Menu cannot show a colour swatch beside a label or fade a row
	// that is switched off, and both are the whole point here — the syntax
	// picker has to be a legend as well as a control. So this is a small
	// popup of our own: rows of { dot, label }, anchored above the bar.
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// BAR PICKERS: the shared popup
	// ════════════════════════════════════════════════════════════════════════

	// items: [{ label, on, color?, icon?, onClick }]
	// mode 'toggle' keeps the popup open so several classes can be flipped in
	// one visit; 'choose' closes on the first pick, which is what a
	// three-way view switch wants.
	openBarPicker(anchorEl, items, mode) {
		this.closeBarPicker();
		const pop = document.createElement('div');
		pop.className = 'zg-picker';

		for (const item of items) {
			const row = document.createElement('div');
			row.className = 'zg-picker-row' + (item.on ? '' : ' is-off');

			// Only colour-bearing rows get a swatch. A hollow ring beside
			// "Spaces" said nothing except that a circle could have gone
			// there; without one the whole popup collapses to labels.
			if (item.color) {
				const dot = document.createElement('span');
				dot.className = 'zg-picker-dot';
				dot.style.backgroundColor = item.color;
				row.appendChild(dot);
			}

			const label = document.createElement('span');
			label.className = 'zg-picker-label';
			label.textContent = item.label;
			// A font list that does not show the fonts is a list of words.
			if (item.font) label.style.fontFamily = item.font;
			row.appendChild(label);

			// mousedown, not click. The bar rebuilds itself on edits, on the
			// clock tick and on scroll; if a rebuild lands between mousedown
			// and mouseup, the browser fires `click` on the nearest common
			// ancestor instead of the element, and the handler never runs.
			// That is why these buttons felt dead — the listener was correct
			// and simply never reached.
			row.addEventListener('mousedown', async (e) => {
				e.preventDefault();
				e.stopPropagation();
				await item.onClick();
				if (mode === 'choose') this.closeBarPicker();
				else this.refreshBarPicker(pop);
			});
			pop.appendChild(row);
		}

		document.body.appendChild(pop);
		this._barPicker = pop;

		// Anchored to the token, flipped up, and nudged back inside the
		// viewport if the token sits near an edge.
		const a = anchorEl.getBoundingClientRect();
		const r = pop.getBoundingClientRect();
		let left = a.left + (a.width / 2) - (r.width / 2);
		left = Math.max(6, Math.min(left, window.innerWidth - r.width - 6));
		pop.style.left   = left + 'px';
		pop.style.bottom = (window.innerHeight - a.top + 6) + 'px';

		// Dismissal tests containment rather than relying on stopPropagation,
		// so a stray listener elsewhere cannot leave the popup stuck open.
		this._barPickerDismiss = (e) => {
			if (pop.contains && e && e.target && pop.contains(e.target)) return;
			this.closeBarPicker();
		};
		window.setTimeout(() => {
			document.addEventListener('mousedown', this._barPickerDismiss, true);
			document.addEventListener('keydown', this._barPickerKey);
		}, 0);
	}

	// Rebuild the rows in place. Re-opening the popup instead would move it
	// out from under the pointer between two clicks.
	refreshBarPicker(pop) {
		const live = pop._live;
		if (!live) return;
		const rows = pop.children;
		for (let i = 0; i < live.length && i < rows.length; i++) {
			rows[i].classList.toggle('is-off', !live[i].on());
		}
	}

	closeBarPicker() {
		if (this._barPickerDismiss) {
			document.removeEventListener('mousedown', this._barPickerDismiss, true);
			document.removeEventListener('keydown', this._barPickerKey);
			this._barPickerDismiss = null;
		}
		if (this._barPicker) { this._barPicker.remove(); this._barPicker = null; }
	}

	// A button in the bar: label or icon, click opens a picker.
	buildBarButton(cls, render, title, onClick) {
		const el = document.createElement('span');
		el.className = 'zg-barbtn is-clickable ' + cls;
		render(el);
		el.title = title;
		// mousedown for the same reason as the picker rows: a bar repaint
		// between press and release swallows `click` entirely.
		el.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick(el, e);
		});
		return el;
	}

	// The fonts the user added under Appearance \u2192 Text font, not every font
	// installed on the machine. Obsidian keeps that list in appearance.json and
	// exposes it through vault.getConfig; the computed --font-text is the
	// fallback, and needs the generic stack filtered back out of it.
	getConfiguredFonts() {
		let raw = '';
		try {
			if (this.app.vault.getConfig) {
				const cfg = this.app.vault.getConfig('textFontFamily');
				raw = Array.isArray(cfg) ? cfg.join(',') : (cfg || '');
			}
		} catch (_) { raw = ''; }
		if (!raw) {
			try { raw = getComputedStyle(document.body).getPropertyValue('--font-text') || ''; }
			catch (_) { raw = ''; }
		}
		// Everything Obsidian appends as a fallback, plus the CSS generics.
		const GENERIC = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif',
			'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
			'ui-monospace', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
			'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
			'Helvetica', 'Arial', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol']);
		const seen = new Set();
		const out  = [];
		for (const part of String(raw).split(',')) {
			const name = part.trim().replace(/^["']|["']$/g, '');
			if (!name || GENERIC.has(name) || seen.has(name)) continue;
			seen.add(name);
			out.push(name);
		}
		return out;
	}

	// Stamped separately from the rest of applyCssVariables because the value
	// can change per note, and so has to be re-applied on every file switch
	// rather than only on a settings change.
	applyEditorFont() {
		const font = this.settings.pluginEnabled && this.isActiveFileInScope()
			? (this.opt('editorFont') || '')
			: '';
		if (font) document.body.style.setProperty('--zg-font', font);
		else      document.body.style.removeProperty('--zg-font');
		document.body.classList.toggle('zg-font-active', !!font);
	}

	buildFontIndicator() {
		const current = this.opt('editorFont') || '';
		const el = this.buildBarButton(
			'zg-barbtn-font' + (current ? '' : ' is-off'),
			(node) => {
				node.textContent = 'Aa';
				// The button previews the choice too.
				if (current) node.style.fontFamily = current;
			},
			current ? 'Font: ' + current + ' \u2014 click to change' : 'Font \u2014 click to choose',
			(anchor) => this.openFontPicker(anchor)
		);
		return el;
	}

	openFontPicker(anchor) {
		const fonts   = this.getConfiguredFonts();
		const current = () => this.opt('editorFont') || '';
		const items = [{
			label: 'Theme default',
			on: () => !current(),
			onClick: async () => {
				this.settings.editorFont = '';
				await this.saveSettings(true);
				this.applyEditorFont();
			}
		}];
		for (const name of fonts) {
			items.push({
				label: name,
				font: name,
				on: () => current() === name,
				onClick: async () => {
					this.settings.editorFont = name;
					await this.saveSettings(true);
					this.applyEditorFont();
				}
			});
		}
		if (fonts.length === 0) {
			items.push({
				label: 'No fonts added yet',
				on: () => false,
				onClick: async () => {}
			});
		}
		this.openPickerLive(anchor, items, 'choose');
	}

	// The five syntax-highlight classes, in the order they appear everywhere
	// else. The settings keys keep their pos* names: renaming them would force
	// a migration on every existing vault, and nobody reads data.json.
	getSyntaxCategories() {
		return [
			{ key: 'posNoun',        color: 'posNounColor',        label: 'Nouns'        },
			{ key: 'posVerb',        color: 'posVerbColor',        label: 'Verbs'        },
			{ key: 'posAdjective',   color: 'posAdjectiveColor',   label: 'Adjectives'   },
			{ key: 'posAdverb',      color: 'posAdverbColor',      label: 'Adverbs'      },
			{ key: 'posConjunction', color: 'posConjunctionColor', label: 'Conjunctions' }
		];
	}

	// Reads "Syntax" in the bar; the colours live in the picker, where each
	// class sits beside its own swatch and fades when it is off.
	buildSyntaxIndicator() {
		const s = this.settings;
		const active = s.posEnabled ? this.getSyntaxCategories().filter(c => s[c.key]) : [];
		const title = active.length
			? 'Syntax highlight: ' + active.map(c => c.label.toLowerCase()).join(', ')
			: 'Syntax highlight is off';
		const el = this.buildBarButton(
			'zg-barbtn-syntax' + (active.length ? '' : ' is-off'),
			(node) => { node.textContent = 'Syntax'; },
			title,
			(anchor) => this.openSyntaxPicker(anchor)
		);
		return el;
	}

	openSyntaxPicker(anchor) {
		const s = this.settings;
		const items = this.getSyntaxCategories().map(c => ({
			label: c.label,
			color: s[c.color],
			on: () => !!(s.posEnabled && s[c.key]),
			onClick: async () => {
				s[c.key] = !s[c.key];
				// Ticking a class from the bar plainly means "show me this",
				// so it switches the feature on rather than changing a setting
				// with no visible effect.
				if (s[c.key]) s.posEnabled = true;
				// Turning the last one off turns the feature off with it,
				// rather than leaving it running over nothing.
				else if (!this.getSyntaxCategories().some(x => s[x.key])) s.posEnabled = false;
				await this.saveSettings(true);
			}
		}));
		// Master switch last, so the list reads as "these classes… and the
		// whole thing" rather than burying the classes under a header.
		items.push({
			label: 'Syntax highlight',
			on: () => !!s.posEnabled,
			onClick: async () => {
				s.posEnabled = !s.posEnabled;
				// Switching it on with nothing selected would highlight
				// nothing at all, so hand back the default class.
				if (s.posEnabled && !this.getSyntaxCategories().some(c => s[c.key])) s.posNoun = true;
				await this.saveSettings(true);
			}
		});
		this.openPickerLive(anchor, items, 'toggle');
	}

	// Caps Lock as the key cap itself: an upward chevron with an A inside it,
	// the way the key is engraved. Drawn rather than typed, because no font
	// carries a glyph for this and CAPS in flat text reads as shouting.
	buildCapsIndicator() {
		const NS  = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('class', 'zg-key zg-key-caps');
		svg.setAttribute('viewBox', '0 0 20 20');
		svg.setAttribute('aria-hidden', 'true');

		// A hollow up-arrow outline, wide enough to hold a letter.
		const arrow = document.createElementNS(NS, 'path');
		arrow.setAttribute('class', 'zg-key-shape');
		arrow.setAttribute('d', 'M10 1.5 L18.5 9 H14.5 V18 H5.5 V9 H1.5 Z');
		svg.appendChild(arrow);

		const letter = document.createElementNS(NS, 'text');
		letter.setAttribute('class', 'zg-key-text');
		letter.setAttribute('x', '10');
		letter.setAttribute('y', '15.4');
		letter.setAttribute('text-anchor', 'middle');
		letter.setAttribute('font-size', '7.5');
		letter.textContent = 'A';
		svg.appendChild(letter);

		const wrap = document.createElement('span');
		wrap.className = 'zg-keycap';
		wrap.title = 'Caps Lock is on';
		wrap.appendChild(svg);
		return wrap;
	}

	// Num Lock as a rounded key cap with the legend on two lines, which is how
	// it is actually printed on a keyboard.
	buildNumIndicator() {
		const NS  = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('class', 'zg-key zg-key-num');
		svg.setAttribute('viewBox', '0 0 22 20');
		svg.setAttribute('aria-hidden', 'true');

		const cap = document.createElementNS(NS, 'rect');
		cap.setAttribute('class', 'zg-key-shape');
		cap.setAttribute('x', '1.2'); cap.setAttribute('y', '1.2');
		cap.setAttribute('width', '19.6'); cap.setAttribute('height', '17.6');
		cap.setAttribute('rx', '3.4');
		svg.appendChild(cap);

		// Two rows, sized to sit inside the cap without touching its radius.
		const rows = [['Num', 8.6], ['Lock', 16.2]];
		for (const row of rows) {
			const t = document.createElementNS(NS, 'text');
			t.setAttribute('class', 'zg-key-text');
			t.setAttribute('x', '11');
			t.setAttribute('y', String(row[1]));
			t.setAttribute('text-anchor', 'middle');
			t.setAttribute('font-size', '6.6');
			t.textContent = row[0];
			svg.appendChild(t);
		}

		const wrap = document.createElement('span');
		wrap.className = 'zg-keycap';
		wrap.title = 'Num Lock is on';
		wrap.appendChild(svg);
		return wrap;
	}

	// ¶ in the bar; the picker toggles which invisibles are drawn.
	buildMarkersIndicator() {
		const s = this.settings;
		const any = s.showHiddenMarkers &&
			(s.markSpaces || s.markTabs || s.markParagraphs || s.markEndOfLines);
		return this.buildBarButton(
			'zg-barbtn-markers' + (any ? '' : ' is-off'),
			(node) => { node.textContent = '\u00b6'; },
			any ? 'Hidden markers \u2014 click to change' : 'Hidden markers are off',
			(anchor) => this.openMarkersPicker(anchor)
		);
	}

	openMarkersPicker(anchor) {
		const s = this.settings;
		const defs = [
			{ key: 'markSpaces',     label: 'Spaces \u00b7'    },
			{ key: 'markTabs',       label: 'Tabs \u2192'      },
			{ key: 'markParagraphs', label: 'Paragraphs \u00b6' },
			{ key: 'markEndOfLines', label: 'Line ends \u21b5' }
		];
		const items = defs.map(d => ({
			label: d.label,
			on: () => !!(s.showHiddenMarkers && s[d.key]),
			onClick: async () => {
				s[d.key] = !s[d.key];
				if (s[d.key]) s.showHiddenMarkers = true;
				else if (!defs.some(x => s[x.key])) s.showHiddenMarkers = false;
				await this.saveSettings(true);
			}
		}));
		this.openPickerLive(anchor, items, 'toggle');
	}

	// Small wrapper so pickers can pass live getters rather than a snapshot.
	openPickerLive(anchor, items, mode) {
		// Copy the whole item and overwrite only `on`, rather than listing the
		// fields by hand — the hand-written version silently dropped `font`
		// the moment a picker started using it.
		const snapshot = items.map(i => Object.assign({}, i, { on: i.on() }));
		this.openBarPicker(anchor, snapshot, mode);
		if (this._barPicker) this._barPicker._live = items;
	}

	// Badges rather than bare letters. The shapes carry the meaning at a	// Badges rather than bare letters. The shapes carry the meaning at a
	// glance: a ring for zen, a box for the Hemingway lock, and rules above
	// and below for typewriter — the letterbox mask in miniature. All of it
	// is drawn from currentColor and sized in em, so it inherits the bar's
	// palette and shrinks with fitStatusBarText like everything else.
	buildModeIndicator() {
		const wrap = document.createElement('span');
		wrap.className = 'zg-mode';
		for (const mode of this.getAllModes()) {
			const badge = document.createElement('span');
			badge.className = 'zg-mode-badge is-clickable is-' + mode.key + (mode.on ? '' : ' is-off');
			badge.textContent = mode.letter;
			badge.title = mode.label + (mode.on ? ' \u2014 click to turn off' : ' \u2014 click to turn on');
			// mousedown, like every other control in the bar: a repaint
			// between press and release swallows click entirely.
			badge.addEventListener('mousedown', async (e) => {
				e.preventDefault();
				e.stopPropagation();
				await this.toggleSetting(mode.setting);
			});
			wrap.appendChild(badge);
		}
		return wrap;
	}

	// ════════════════════════════════════════════════════════════════════════
	// BAR RENDERING: tokens to DOM
	// ════════════════════════════════════════════════════════════════════════

	formatReadTime(words) {
		const wpm = Math.max(50, this.settings.readTimeWpm || 200);
		if (!words) return '0 min';
		const mins = words / wpm;
		if (mins < 1) return '<1 min';
		const m = Math.round(mins);
		if (m < 60) return m + ' min';
		return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
	}

	// Reads CapsLock/NumLock state off a keyboard event and refreshes the
	// retro bar when either changes. Not every keyboard event supports
	// getModifierState (and NumLock has no meaning on keyboards/OSes without
	// a physical numpad concept, e.g. most Mac laptops), so this fails quiet.
	updateModifierState(evt) {
		if (!evt || typeof evt.getModifierState !== 'function') return;
		let changed = false;
		try {
			const caps = evt.getModifierState('CapsLock');
			if (caps !== this._capsLockOn) { this._capsLockOn = caps; changed = true; }
		} catch (_) { /* getModifierState with an unsupported key name can throw */ }
		try {
			const num = evt.getModifierState('NumLock');
			if (num !== this._numLockOn) { this._numLockOn = num; changed = true; }
		} catch (_) {}
		if (changed) this.updateRetroStatusBar();
	}

	// Best-effort Vim mode label for {vim}. Obsidian's Vim mode is backed by
	// @replit/codemirror-vim, which exposes its state on a CM5-compatible
	// facade at editor.cm.cm — not officially documented, but it's the same
	// access pattern community Vim-status plugins rely on. Falls back to ''
	// (token renders empty) any time the shape isn't what's expected, e.g.
	// Vim mode is off, or a future Obsidian version changes internals.
	getVimModeLabel() {
		try {
			const vault = this.app.vault;
			if (!vault.config || vault.config.vimMode !== true) return '';

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const cm6  = view && view.editor && view.editor.cm;
			const cm5  = cm6 && cm6.cm;
			const vim  = cm5 && cm5.state && cm5.state.vim;
			if (!vim) return '';

			// Replace mode (R) is represented as insert mode with the CM5
			// facade's overwrite flag set — vim.replaceMode alone is not
			// reliable across versions, which is why REPLACE never showed.
			if (vim.insertMode) {
				return (cm5.state.overwrite || vim.replaceMode) ? '-- REPLACE --' : '-- INSERT --';
			}
			if (vim.replaceMode) return '-- REPLACE --';
			if (vim.visualMode) {
				if (vim.visualBlock) return '-- VISUAL BLOCK --';
				if (vim.visualLine)  return '-- VISUAL LINE --';
				return '-- VISUAL --';
			}
			switch (vim.mode) {
				case 'insert':  return '-- INSERT --';
				case 'replace': return '-- REPLACE --';
				case 'visual':  return '-- VISUAL --';
			}
			// The ex command-line (":") prompt doesn't flip `mode` in every
			// version of the vim layer, so also check for its dialog in the DOM.
			if (document.querySelector('.cm-vim-panel, .CodeMirror-dialog')) return '-- COMMAND --';
			return '-- NORMAL --';
		} catch (_) {
			return '';
		}
	}

	updateRetroStatusBar() {
		if (!this.retroStatusBarEl) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const now  = new Date();
		let stats = null, totalWC = 0, charCount = 0, displayWC = 0, displayCC = 0;

		if (view) {
			stats     = this.getDocStats(view);
			totalWC   = stats.totalWC;
			charCount = stats.charCount;
			const editor = view.editor;
			const sel = editor ? editor.getSelection() : '';
			if (sel && sel.trim().length > 0) {
				const selProse = this.countProse(sel);
				displayWC = selProse.words;
				displayCC = selProse.chars;
			} else {
				displayWC = totalWC;
				displayCC = charCount;
			}
		}

		const goal = this.formatGoal(totalWC);
		const subs = {
			'{file}':      this.getFilePath(view),
			'{words}':     displayWC,
			'{chars}':     displayCC,
			'{time}':      this.formatTime(now),
			'{date}':      this.formatDate(now),
			'{battery}':   this.formatBattery(),
			'{paragraph}': this.getParagraphInfo(view, stats),
			'{caps}':      this._capsLockOn ? '\x00CAPS\x00' : '',
			'{num}':       this._numLockOn  ? '\x00NUM\x00'  : '',
			'{vim}':       this.getVimModeLabel(),
			'{lock}':      this.settings.hemingwayEnabled ? 'LOCK' : '',
			'{mode}':      '\x00MODE\x00',
			'{syntax}':    '\x00SYNTAX\x00',
			'{markers}':   '\x00MARKERS\x00',
			'{font}':      '\x00FONT\x00',
			'{readtime}':  this.formatReadTime(totalWC),
			'{goal}':      '\x00GOAL\x00'
		};

		const rows   = this.getStatusRows();
		const allFmt = rows.map(r => r.left + r.center + r.right).join('');
		const hasGoal = allFmt.includes('{goal}');

		// Click-to-reset now lives on the {goal} element itself (see
		// buildGoalIndicator). It used to be a mousedown on the entire bar,
		// which meant any stray click near the bottom edge — including the
		// start of a drag — silently reset the baseline.
		this.retroStatusBarEl.style.cursor = '';
		this.retroStatusBarEl.title        = '';

		this._goalWasMet = hasGoal ? goal.met : null;

		this._zgLastTotalWordCount = totalWC;

		this.retroStatusBarEl.empty();
		this._statusRowEls = [];
		for (const row of rows) {
			const rowEl = this.retroStatusBarEl.createDiv({ cls: 'zg-status-row' });
			rowEl.createSpan({ cls: 'zg-status-section zg-status-left' })
				.appendChild(this.renderStatusSection(row.left, subs, goal));
			rowEl.createSpan({ cls: 'zg-status-section zg-status-center' })
				.appendChild(this.renderStatusSection(row.center, subs, goal));
			rowEl.createSpan({ cls: 'zg-status-section zg-status-right' })
				.appendChild(this.renderStatusSection(row.right, subs, goal));
			this._statusRowEls.push(rowEl);
		}
		this.retroStatusBarEl.classList.toggle('zg-status-multirow', rows.length > 1);

		// Flash the bar when goal is met (if enabled)
		this.retroStatusBarEl.classList.toggle('zg-goal-met', goal.met);

		// Shrink font size if the content overflows the bar's current width
		// (e.g. when a sidebar is open and the note pane narrows).
		this.fitStatusBarText();
	}

	// Turns one of the three format strings (left/center/right) into a DOM
	// fragment, substituting tokens and swapping in the live goal-bar element
	// where {goal} appeared (rather than plain text, when the bar display
	// style is chosen).
	renderStatusSection(formatStr, subs, goal) {
		const frag = document.createDocumentFragment();
		if (!formatStr) return frag;

		let out = formatStr;
		// Guarded on the brace so a future non-token entry on this object
		// cannot be substituted into the format string by accident.
		for (const token in subs) {
			if (token.charAt(0) !== '{') continue;
			out = out.split(token).join(String(subs[token]));
		}

		// Tokens that render as elements rather than text are substituted as
		// sentinels above and spliced back in as real nodes here. Splitting on
		// one combined pattern, rather than handling a single token, is what
		// makes repeats work: the previous version took parts[0] and parts[1]
		// only, so a second {goal} in the same slot silently swallowed
		// everything after it.
		const builders = {
			GOAL:     () => this.buildGoalIndicator(goal),
			MODE:     () => this.buildModeIndicator(),
			SYNTAX:   () => this.buildSyntaxIndicator(),
			MARKERS:  () => this.buildMarkersIndicator(),
			FONT:     () => this.buildFontIndicator(),
			CAPS:     () => this.buildCapsIndicator(),
			NUM:      () => this.buildNumIndicator()
		};
		// \x00 cannot appear in a note or a format string, so the split is
		// unambiguous. Odd indices are the captured sentinel names.
		const parts = out.split(/\x00(GOAL|MODE|SYNTAX|MARKERS|FONT|CAPS|NUM)\x00/);
		for (let i = 0; i < parts.length; i++) {
			const chunk = parts[i];
			if (!chunk) continue;
			if (i % 2 === 1) {
				if (builders[chunk]) frag.appendChild(builders[chunk]());
			} else {
				frag.appendChild(document.createTextNode(chunk));
			}
		}
		return frag;
	}

	// Reduce the retro bar's font size until the text fits its current width,
	// never going above the user's configured size. Resets to the configured
	// size first so it grows back when the bar has room again (sidebar closed).
	fitStatusBarText() {
		const el = this.retroStatusBarEl;
		if (!el) return;
		const baseSize = this.settings.statusBarFontSize || 13;
		// Resetting font-size forces a reflow; skip the whole measure when
		// nothing that affects fit has changed since the last call.
		// With several rows the widest one decides the size for all of them —
		// per-row font sizes would make the bar look ragged.
		const rowEls = (this._statusRowEls && this._statusRowEls.length) ? this._statusRowEls : [el];
		const text   = el.textContent;
		const width  = el.clientWidth;
		if (this._lastFit && this._lastFit.text === text && this._lastFit.width === width &&
			this._lastFit.base === baseSize && this._lastFit.rows === rowEls.length) return;
		this._lastFit = { text, width, base: baseSize, rows: rowEls.length };

		const overflows = () => rowEls.some(r => r.scrollWidth > r.clientWidth);
		el.style.fontSize = baseSize + 'px';
		if (!overflows()) return;

		const minSize = Math.max(7, Math.floor(baseSize * 0.5));
		let size = baseSize;
		while (overflows() && size > minSize) {
			size -= 1;
			el.style.fontSize = size + 'px';
		}
	}


	// ════════════════════════════════════════════════════════════════════════
	// GOAL INDICATOR
	// ════════════════════════════════════════════════════════════════════════

	// Ring or plain fraction. Everything is drawn from currentColor, so the
	// indicator inherits --zg-text without a second set of colour settings.
	buildGoalIndicator(goal) {
		const wrap = document.createElement('span');
		wrap.className = 'zg-goal is-clickable';
		if (goal.met) wrap.classList.add('is-met');
		wrap.title = goal.text + ' \u2014 click to reset the baseline';

		if ((this.settings.goalDisplay || 'ring') === 'fraction') {
			const span = document.createElement('span');
			span.className = 'zg-goal-text';
			span.textContent = goal.text;
			wrap.appendChild(span);
			// The ring carries the reset glyph inside it; in fraction mode
			// there is no inside, so it sits alongside the number.
			if (goal.met) wrap.appendChild(this.buildResetGlyph());
		} else {
			wrap.appendChild(this.buildGoalRing(goal.ratio, goal.met));
		}

		wrap.addEventListener('mousedown', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.settings.goalBaseline = this._zgLastTotalWordCount || 0;
			this._goalWasMet = false;
			await this.saveSettings();
			this.updateRetroStatusBar();
		});
		return wrap;
	}

	// The circled arrow shared by both goal displays.
	buildResetGlyph(size) {
		const NS  = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('class', 'zg-goal-reset');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		const icon = document.createElementNS(NS, 'path');
		icon.setAttribute('class', 'zg-goal-ring-icon');
		icon.setAttribute('d', 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z');
		svg.appendChild(icon);
		return svg;
	}

	// A stroked SVG arc. Only the circles are rotated, not the whole element:
	// rotating the svg would stand the percentage on its side.
	buildGoalRing(ratio, met) {
		const NS = 'http://www.w3.org/2000/svg';
		const W  = Math.max(1, Math.min(8, this.settings.goalRingWeight || 4));
		const R  = 12 - (W / 2) - 0.5;          // keep the stroke inside a 24x24 box
		const C  = 2 * Math.PI * R;
		const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);

		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('class', 'zg-goal-ring');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');

		const g = document.createElementNS(NS, 'g');
		g.setAttribute('transform', 'rotate(-90 12 12)');   // start at twelve o'clock
		for (const cls of ['zg-goal-ring-track', 'zg-goal-ring-fill']) {
			const c = document.createElementNS(NS, 'circle');
			c.setAttribute('class', cls);
			c.setAttribute('cx', '12');
			c.setAttribute('cy', '12');
			c.setAttribute('r', String(R));
			c.setAttribute('stroke-width', String(W));
			if (cls === 'zg-goal-ring-fill') {
				c.setAttribute('stroke-dasharray',  String(C));
				c.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(Math.max(ratio, 0), 1))));
				// A round cap at exactly zero reads as progress that has not
				// happened, so hide the arc entirely instead.
				if (ratio <= 0) c.setAttribute('visibility', 'hidden');
			}
			g.appendChild(c);
		}
		svg.appendChild(g);

		// Once the target is met the number has done its job — it reads 100 and
		// stays there. The refresh glyph says what a click does now instead.
		if (met && this.settings.goalRingPercent) {
			const g2 = document.createElementNS(NS, 'g');
			g2.setAttribute('transform', 'translate(12 12) scale(0.44) translate(-12 -12)');
			const icon = document.createElementNS(NS, 'path');
			icon.setAttribute('class', 'zg-goal-ring-icon');
			icon.setAttribute('d', 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z');
			g2.appendChild(icon);
			svg.appendChild(g2);
		} else if (this.settings.goalRingPercent) {
			const t = document.createElementNS(NS, 'text');
			t.setAttribute('class', 'zg-goal-ring-pct');
			t.setAttribute('x', '12');
			t.setAttribute('y', '12');
			t.setAttribute('text-anchor', 'middle');
			t.setAttribute('dominant-baseline', 'central');
			// Three digits need to fit once the goal is met, so the type
			// steps down rather than overflowing the ring.
			t.setAttribute('font-size', pct >= 100 ? '7.6' : '9');
			t.textContent = String(pct);
			svg.appendChild(t);
		}
		return svg;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Letterbox mask system
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// LETTERBOX MASKS + TYPEWRITER SCROLL
	// ════════════════════════════════════════════════════════════════════════

	buildMaskElements() {
		for (const el of [this.maskTopEl, this.maskBottomEl, this.arrowsTopEl, this.arrowsBottomEl]) {
			if (el) el.remove();
		}
		this.maskTopEl = this.maskBottomEl = this.arrowsTopEl = this.arrowsBottomEl = null;
		if (this.maskResizeObserver) { this.maskResizeObserver.disconnect(); this.maskResizeObserver = null; }

		if (!this.letterboxActive()) return;
		if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return;

		this.maskTopEl    = document.body.createEl('div', { cls: 'zengrinder-mask zengrinder-mask-top' });
		this.maskBottomEl = document.body.createEl('div', { cls: 'zengrinder-mask zengrinder-mask-bottom' });

		const chars = this.getArrowChars();
		this.arrowsTopEl    = this.buildArrowLayer('top',    chars.top);
		this.arrowsBottomEl = this.buildArrowLayer('bottom', chars.bottom);

		const scroller = this.getActiveScroller();
		if (scroller && 'ResizeObserver' in window) {
			this.maskResizeObserver = new ResizeObserver(() => this.scheduleMaskPosition());
			this.maskResizeObserver.observe(scroller);
		}
		this.updateMaskVisibility();
	}

	stampMaskPositions() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { this._maskRaf = null; return; }

		const scroller = view.contentEl.querySelector('.cm-scroller')
			|| view.contentEl.querySelector('.markdown-preview-view')
			|| view.contentEl;
		const sr = scroller.getBoundingClientRect();

		let statusH = 0;
		if (this.settings.enableRetroStatus && this.retroStatusBarEl) {
			statusH = this.retroStatusBarEl.getBoundingClientRect().height || this.settings.statusBarHeight || 30;
		} else {
			const nb = document.querySelector('.status-bar');
			if (nb && getComputedStyle(nb).display !== 'none') statusH = nb.getBoundingClientRect().height || 0;
		}

		// Use the scroller's actual top — it already sits below whatever chrome is visible.
		// Do NOT clamp to an arbitrary drag-bar height; that was pushing the mask down.
		const sTop    = Math.max(0, sr.top);
		const sLeft   = Math.max(0, sr.left);
		const sWidth  = sr.width;
		// visualViewport.height is the honest bottom edge on mobile when the
		// on-screen keyboard is open; innerHeight ignores it.
		const vpH     = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
		const sBottom = vpH - statusH;
		const sHeight = Math.max(0, sBottom - sTop);

		let maskH = this.settings.letterboxPx != null ? this.settings.letterboxPx : (this.settings.letterboxLines || 8) * 26;
		maskH = Math.min(maskH, Math.floor(sHeight * 0.45));
		maskH = Math.max(maskH, 34);

		const padH      = this.settings.maskPaddingH || 0;
		const arrowLeft = sLeft + padH;
		const arrowW    = Math.max(0, sWidth - padH * 2);
		const arrowH    = maskH;
		const overhang  = this.settings.maskOverhang != null ? this.settings.maskOverhang : 4;

		const S = (el, styles) => { if (el) Object.assign(el.style, styles); };
		S(this.maskTopEl,    { left: sLeft+'px', width: sWidth+'px', top: sTop+'px', height: (arrowH+overhang)+'px', bottom:'' });
		S(this.arrowsTopEl,  { left: arrowLeft+'px', width: arrowW+'px', top: sTop+'px', height: arrowH+'px', bottom:'' });
		S(this.maskBottomEl, { left: sLeft+'px', width: sWidth+'px', top: (sBottom-arrowH-overhang)+'px', height: (arrowH+overhang)+'px', bottom:'' });
		S(this.arrowsBottomEl, { left: arrowLeft+'px', width: arrowW+'px', top: (sBottom-arrowH)+'px', height: arrowH+'px', bottom:'' });

		// Retro status bar: match the note pane's width, not the full window —
		// keeps it clear of open sidebars instead of spanning edge to edge.
		S(this.retroStatusBarEl, { left: sLeft+'px', width: sWidth+'px' });
		this.fitStatusBarText();

		// Outside zen mode there's no big 50vh scroller padding to push the
		// first/last lines clear of the masks, so a brand-new or short note
		// starts hidden behind the top mask. Give the scroller just enough
		// top/bottom breathing room to clear the mask height, independent of
		// zen mode — zen mode's own 50vh padding (see styles.css) already
		// covers this and is left untouched.
		const scrollPad = this.letterboxActive() ? Math.round(arrowH + overhang + 24) : 0;
		document.documentElement.style.setProperty('--zg-scroller-pad-top',    scrollPad + 'px');
		document.documentElement.style.setProperty('--zg-scroller-pad-bottom', scrollPad + 'px');

		this._maskRaf = null;
	}

	scheduleMaskPosition() {
		if (this._maskRaf) return;
		this._maskRaf = requestAnimationFrame(() => this.stampMaskPositions());
	}

	buildArrowLayer(position, char) {
		const wrap   = document.body.createEl('div', { cls: 'zengrinder-arrows-wrap zengrinder-arrows-wrap-' + position + ' is-visible' });
		const line   = wrap.createEl('div', { cls: 'zengrinder-arrow-line' });
		const arrows = wrap.createEl('div', { cls: 'zengrinder-arrows' });
		for (let i = 0; i < this.settings.arrowCount; i++) arrows.createEl('span', { text: char });
		if (position === 'top') wrap.insertBefore(arrows, line);

		// Pointer events (with capture) instead of mouse events: identical on
		// desktop, and tablet/mobile dragging works for free.
		line.style.cursor        = 'ns-resize';
		line.style.pointerEvents = 'auto';
		line.addEventListener('pointerdown', e => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			e.preventDefault(); e.stopPropagation();
			this._startVerticalDrag(e, position, line);
		});

		arrows.style.cursor        = 'ew-resize';
		arrows.style.pointerEvents = 'auto';
		arrows.addEventListener('pointerdown', e => {
			if (e.pointerType === 'mouse' && e.button !== 0) return;
			e.preventDefault(); e.stopPropagation();
			this._startHorizontalDrag(e, arrows);
		});
		return wrap;
	}

	// Shared pointer-drag plumbing. setPointerCapture routes all move/up
	// events to the grabbed element, so no document-level listeners are
	// needed — and _activeDragCleanup lets onunload abort a drag that's
	// still in flight instead of leaking its listeners.
	_startPointerDrag(e, el, cursor, onMove) {
		if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (_) {} }
		document.body.style.cursor = cursor; document.body.style.userSelect = 'none';
		const finish = (save) => {
			el.removeEventListener('pointermove',   onMove);
			el.removeEventListener('pointerup',     onUp);
			el.removeEventListener('pointercancel', onCancel);
			if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
				try { el.releasePointerCapture(e.pointerId); } catch (_) {}
			}
			document.body.style.cursor = ''; document.body.style.userSelect = '';
			this._activeDragCleanup = null;
			if (save) this.saveSettings();
		};
		const onUp     = () => finish(true);
		const onCancel = () => finish(false);
		el.addEventListener('pointermove',   onMove);
		el.addEventListener('pointerup',     onUp);
		el.addEventListener('pointercancel', onCancel);
		this._activeDragCleanup = () => finish(false);
	}

	_startVerticalDrag(e, position, el) {
		const startY = e.clientY;
		const startH = (this.maskTopEl ? parseFloat(this.maskTopEl.style.height) : null)
			|| (this.settings.letterboxPx != null ? this.settings.letterboxPx : (this.settings.letterboxLines || 8) * 26);
		this._startPointerDrag(e, el, 'ns-resize', me => {
			const dy = me.clientY - startY;
			this.settings.letterboxPx = Math.max(0, startH + dy * (position === 'top' ? 1 : -1));
			this.scheduleMaskPosition();
		});
	}

	_startHorizontalDrag(e, el) {
		const startX   = e.clientX;
		const startPad = this.settings.maskPaddingH || 0;
		const cx       = window.innerWidth / 2;
		this._startPointerDrag(e, el, 'ew-resize', me => {
			const dx = me.clientX - startX;
			this.settings.maskPaddingH = Math.max(0, Math.min(Math.round(cx) - 20, Math.round(startPad + dx * (startX < cx ? 1 : -1))));
			this.scheduleMaskPosition();
		});
	}

	getArrowChars() {
		if (this.settings.arrowStyle === 'custom') {
			return { top: this.settings.customArrowTop || '^', bottom: this.settings.customArrowBottom || 'v' };
		}
		return ARROW_STYLES[this.settings.arrowStyle] || ARROW_STYLES['solid-triangle'];
	}

	removeCustomElements() {
		// Tear down retro bar
		if (this.retroStatusBarEl) { this.retroStatusBarEl.remove(); this.retroStatusBarEl = null; }
		this._statusRowEls = [];
		document.body.classList.remove('zg-retrobar-active');
		this.stopClockTick();
		// Tear down masks
		this.removeMaskElements();
	}

	getActiveScroller() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		return view.contentEl.querySelector('.cm-scroller') || view.contentEl.querySelector('.markdown-preview-view') || null;
	}

	attachScrollHandler() {
		this.detachScrollHandler();
		const scroller = this.getActiveScroller();
		if (!scroller) return;
		this.currentScroller = scroller;
		this.scrollHandler   = () => this.updateMaskVisibility();
		scroller.addEventListener('scroll', this.scrollHandler, { passive: true });
		requestAnimationFrame(() => this.updateMaskVisibility());
	}

	detachScrollHandler() {
		if (this.currentScroller && this.scrollHandler) {
			this.currentScroller.removeEventListener('scroll', this.scrollHandler);
		}
		this.currentScroller = this.scrollHandler = null;
	}

	updateMaskVisibility() {
		const s = this.currentScroller || this.getActiveScroller();
		if (!s) return;
		const { scrollTop, scrollHeight, clientHeight } = s;
		if (this.arrowsTopEl)    this.arrowsTopEl.classList.toggle('is-visible',    scrollTop > 2);
		if (this.arrowsBottomEl) this.arrowsBottomEl.classList.toggle('is-visible', scrollTop + clientHeight < scrollHeight - 2);
	}

	attachResizeHandler() {
		if (this.windowResizeHandler) return;
		this.windowResizeHandler = () => this.scheduleMaskPosition();
		window.addEventListener('resize', this.windowResizeHandler);
	}

	detachResizeHandler() {
		if (!this.windowResizeHandler) return;
		window.removeEventListener('resize', this.windowResizeHandler);
		this.windowResizeHandler = null;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Typewriter scroll
	// ─────────────────────────────────────────────────────────────────────────

	typewriterScroll() {
		if (!this.settings.pluginEnabled || !this.settings.enableTypewriter) return;
		if (!this.isActiveFileInScope()) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const scroller = view.contentEl.querySelector('.cm-scroller');
		if (!scroller) return;
		let lineTop, lineHeight;
		const activeLine = view.contentEl.querySelector('.cm-active-line');
		if (activeLine) {
			const sr = scroller.getBoundingClientRect();
			const lr = activeLine.getBoundingClientRect();
			lineTop = lr.top - sr.top + scroller.scrollTop;
			lineHeight = lr.height;
		} else {
			const cm = view.editor && view.editor.cm;
			if (!cm) return;
			try {
				const coords = cm.coordsAtPos(cm.state.selection.main.head);
				if (!coords) return;
				const sr = scroller.getBoundingClientRect();
				lineTop = coords.top - sr.top + scroller.scrollTop;
				lineHeight = coords.bottom - coords.top;
			} catch (_) { return; }
		}
		// Cursor's vertical anchor within the scroller, expressed as a ratio
		// derived from "keep N lines above / M lines below" — defaults of 8/8
		// reproduce the previous fixed dead-center (0.5) behaviour.
		const linesAbove = Math.max(0, this.settings.typewriterLinesAbove != null ? this.settings.typewriterLinesAbove : 8);
		const linesBelow = Math.max(0, this.settings.typewriterLinesBelow != null ? this.settings.typewriterLinesBelow : 8);
		const totalLines = linesAbove + linesBelow;
		const ratioAbove  = totalLines > 0 ? linesAbove / totalLines : 0.5;
		const target = lineTop + lineHeight / 2 - scroller.clientHeight * ratioAbove;
		if (Math.abs(scroller.scrollTop - target) < 1) return;
		scroller.scrollTop = target;
	}

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

	setupEditorExtensions() {
		if (!CM) return; // @codemirror modules unavailable — features off
		// A mutable array is registered ONCE; reconfigureEditors() then swaps
		// its contents and calls workspace.updateOptions(), which is the
		// standard Obsidian pattern for dynamic editor extensions.
		this.editorExtensions = [];
		this.editorExtensions.push(...this.buildEditorExtensions());
		this.registerEditorExtension(this.editorExtensions);
	}

	// Factory that creates FRESH ViewPlugin values each call. This matters:
	// workspace.updateOptions() with unchanged extension values is a no-op —
	// CM6 keeps the existing plugin instances and never re-runs their
	// constructors — so settings toggles silently did nothing until some
	// unrelated edit/scroll happened to trigger an update(). Recreating the
	// plugins forces real reconfiguration and an immediate rebuild.
	buildEditorExtensions() {
		if (!CM || !this.settings.pluginEnabled) return [];
		const plugin = this;
		const { ViewPlugin, Decoration, WidgetType, RangeSetBuilder } = CM;

		class InvisibleWidget extends WidgetType {
			constructor(text) { super(); this.text = text; }
			eq(other) { return other.text === this.text; }
			toDOM() {
				const s = document.createElement('span');
				s.className = 'zg-invisible';
				s.textContent = this.text;
				return s;
			}
			ignoreEvent() { return true; }
		}
		const PILCROW  = Decoration.widget({ widget: new InvisibleWidget('¶'), side: 1 });
		const NEWLINE  = Decoration.widget({ widget: new InvisibleWidget('↵'), side: 1 });
		const dimDeco   = Decoration.line({ class: 'zg-dim-line' });
		const dimText   = Decoration.mark({ class: 'zg-dim-text' });
		const spaceDeco = Decoration.mark({ class: 'zg-ws-space' });
		const tabDeco   = Decoration.mark({ class: 'zg-ws-tab' });

		// ── Focus dimming ─────────────────────────────────────────────────────
		const dimPlugin = ViewPlugin.fromClass(class {
			constructor(view) { this.decorations = this.build(view); }
			update(u) {
				if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) {
					this.decorations = this.build(u.view);
				}
			}
			build(view) {
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
				const b = new RangeSetBuilder();
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
			constructor(view) { this.decorations = this.build(view); }
			update(u) {
				if (u.docChanged || u.viewportChanged) {
					this.decorations = this.build(u.view);
				}
			}
			build(view) {
				const s = plugin.settings;
				if (!s.pluginEnabled || !s.showHiddenMarkers) return Decoration.none;
				if (!plugin.isEditorInScope(view)) return Decoration.none;
				const showSp  = s.markSpaces, showTab = s.markTabs;
				const showPar = s.markParagraphs, showEol = s.markEndOfLines;
				if (!showSp && !showTab && !showPar && !showEol) return Decoration.none;
				const doc  = view.state.doc;
				const b    = new RangeSetBuilder();
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
		const posMark = {
			noun: Decoration.mark({ class: 'zg-pos-noun' }),
			verb: Decoration.mark({ class: 'zg-pos-verb' }),
			adj:  Decoration.mark({ class: 'zg-pos-adj'  }),
			adv:  Decoration.mark({ class: 'zg-pos-adv'  }),
			conj: Decoration.mark({ class: 'zg-pos-conj' })
		};

		const syntaxPlugin = ViewPlugin.fromClass(class {
			constructor(view) { this.decorations = this.build(view); }
			update(u) {
				if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
			}
			build(view) {
				const s = plugin.settings;
				if (!s.pluginEnabled || !s.posEnabled) return Decoration.none;
				const posOn = {
					noun: s.posNoun, verb: s.posVerb, adj: s.posAdjective,
					adv:  s.posAdverb, conj: s.posConjunction
				};
				if (!Object.keys(posOn).some(k => posOn[k])) return Decoration.none;
				if (!plugin.isEditorInScope(view)) return Decoration.none;

				const doc  = view.state.doc;
				const skip = s.syntaxSkipCode ? plugin.getNonProseLines(doc) : null;
				const out  = [];

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
						for (const t of tokens) {
							const bucket = posBucket(t.tag);
							if (bucket && posOn[bucket]) {
								out.push(posMark[bucket].range(base + t.from, base + t.to));
							}
						}
					}
				}
				return Decoration.set(out, true);
			}
		}, { decorations: v => v.decorations });

		// ── Paragraph indent ──────────────────────────────────────────────────
		// Previously a MutationObserver stamped .zg-para-first onto rendered
		// .cm-line nodes based only on blank-line adjacency, so bullets, tasks,
		// headings, quotes and table rows all got indented alongside prose.
		// As a decoration it works from the document instead of the DOM, which
		// also means it sees lines CodeMirror has scrolled out of existence.
		const paraFirstDeco = Decoration.line({ class: 'zg-para-first' });
		const paraBodyDeco  = Decoration.line({ class: 'zg-para-line'  });

		const paraPlugin = ViewPlugin.fromClass(class {
			constructor(view) { this.decorations = this.build(view); }
			update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
			build(view) {
				const s = plugin.settings;
				if (!s.pluginEnabled || !s.enableParagraphIndent) return Decoration.none;
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
		return [dimPlugin, markerPlugin, syntaxPlugin, paraPlugin]
			.concat(this.buildHemingwayExtensions())
			.concat(this.buildTypographyExtension())
			.concat(this.buildTypographyRevertKeymap());
	}

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

	buildTypographyExtension() {
		if (!CM || !CM.EditorView || !this.settings.typographyEnabled) return [];
		const plugin = this;

		// Prec.highest matters here. Obsidian's own "auto pair brackets" is an
		// input handler too, and it claims the quote keys — at default
		// precedence it ran first and inserted a straight pair, so curly
		// quotes never fired.
		const handler = CM.EditorView.inputHandler.of((view, from, to, text) => {
			if (text.length !== 1) return false;                 // paste, IME, multi-char
			const s = plugin.settings;
			if (!s.pluginEnabled || !plugin.isEditorInScope(view)) return false;

			const doc  = view.state.doc;
			const line = doc.lineAt(from);
			// Never rewrite inside code, math or frontmatter. The line scan
			// handles blocks; the backtick parity handles inline spans.
			if (plugin.getNonProseLines(doc).has(line.number)) return false;
			const before = doc.sliceString(line.from, from);
			if ((before.match(/`/g) || []).length % 2 === 1) return false;
			if ((before.match(/\$/g) || []).length % 2 === 1) return false;

			const groupOn = {
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
				plugin.applyTypography(view, from, to, text, rule.text, rule.insert);
				return true;
			}

			if (s.typoSmartQuotes && (text === '"' || text === "'")) {
				const prev  = lookback.charAt(lookback.length - 1);
				const opens = prev === '' || TYPO_OPENS_AFTER.test(prev);
				const glyph = text === '"'
					? (opens ? '\u201c' : '\u201d')
					: (opens ? '\u2018' : '\u2019');
				plugin.applyTypography(view, from, to, text, text, glyph);
				return true;
			}
			return false;
		});
		return [CM.Prec ? CM.Prec.highest(handler) : handler];
	}

	// Two transactions, not one. A single transaction that swapped "--" for an
	// en dash undid straight *past* the literal characters, because the state
	// it restored never contained the second dash — the input handler had
	// suppressed it. So the sequence is: insert exactly what was typed, then
	// replace it as a separate, history-isolated step. One undo now lands on
	// the characters, which is what "undo" is expected to mean here.
	applyTypography(view, from, to, typed, matched, glyph) {
		view.dispatch({
			changes: { from, to, insert: typed },
			selection: { anchor: from + typed.length },
			userEvent: 'input.type'
		});

		const end   = from + typed.length;
		const start = end - matched.length;
		const spec  = {
			changes: { from: start, to: end, insert: glyph },
			// Setting the cursor explicitly keeps it off the end of a glyph
			// that is shorter than the text it replaced.
			selection: { anchor: start + glyph.length },
			userEvent: 'input.typography'
		};
		if (CM.isolateHistory) spec.annotations = CM.isolateHistory.of('before');
		view.dispatch(spec);

		// Remembered so Backspace can undo it too — that is the key people
		// actually reach for, and it is what the reference plugin does.
		this._lastTypo = {
			from: start,
			to: start + glyph.length,
			glyph,
			original: matched,
			time: Date.now()
		};
	}

	// Backspace immediately after a substitution puts the typed characters
	// back rather than deleting the glyph. Guarded on the text still being
	// exactly what was inserted, the cursor still sitting after it, and the
	// substitution being recent — otherwise Backspace behaves normally.
	buildTypographyRevertKeymap() {
		if (!CM || !CM.keymap || !this.settings.typographyEnabled) return [];
		const plugin = this;
		const km = CM.keymap.of([{ key: 'Backspace', run: (view) => {
			const t = plugin._lastTypo;
			if (!t || Date.now() - t.time > 5000) return false;
			if (!plugin.isEditorInScope(view)) return false;
			const sel = view.state.selection.main;
			if (!sel.empty || sel.from !== t.to) return false;
			if (view.state.doc.sliceString(t.from, t.to) !== t.glyph) return false;
			view.dispatch({
				changes: { from: t.from, to: t.to, insert: t.original },
				selection: { anchor: t.from + t.original.length },
				userEvent: 'delete.typography'
			});
			plugin._lastTypo = null;
			return true;
		} }]);
		return [CM.Prec ? CM.Prec.highest(km) : km];
	}

	// ════════════════════════════════════════════════════════════════════════
	// HEMINGWAY LOCK
	// ════════════════════════════════════════════════════════════════════════

	buildHemingwayExtensions() {
		if (!CM || !CM.keymap || !this.settings.hemingwayEnabled) return [];
		const plugin = this;
		const s = () => plugin.settings;
		const { keymap, EditorView, Prec } = CM;

		// Returning false means "not handled", so the keystroke falls through
		// to normal editing — which is exactly what an out-of-scope note wants.
		const blocked = (view) => {
			if (view && !plugin.isEditorInScope(view)) return false;
			plugin.flashHemingway();
			return true;   // handled → CodeMirror calls preventDefault for us
		};
		const locked = (view) => plugin.isEditorInScope(view);

		// Collected in a Set because several keys belong to more than one lock
		// (Shift-Delete is both a delete and the legacy cut), and a duplicate
		// binding would just make CodeMirror try the same blocker twice.
		const keys = new Set();
		const addKeys = (...ks) => ks.forEach(k => keys.add(k));
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

		const binds = [];
		keys.forEach(key => binds.push({ key, run: blocked, preventDefault: true }));

		const handlers = EditorView ? EditorView.domEventHandlers({
			// inputType is the honest signal: it names the *edit* rather than
			// the keystroke, so it catches menu actions, IME and mobile alike.
			beforeinput(e, view) {
				if (!locked(view)) return false;
				const t = (e && e.inputType) || '';
				const k = plugin.settings;
				if (k.hemBlockBackspace && /^delete(ContentBackward|WordBackward|SoftLineBackward|HardLineBackward)$/.test(t)) return blocked(view);
				if (k.hemBlockDelete    && /^delete(ContentForward|WordForward|SoftLineForward|HardLineForward)$/.test(t))   return blocked(view);
				if (k.hemBlockBackspace && t === 'deleteContent') return blocked(view);
				if (k.hemBlockUndo      && (t === 'historyUndo' || t === 'historyRedo')) return blocked(view);
				if (k.hemBlockCut       && t === 'deleteByCut')   return blocked(view);
				if (k.hemBlockPaste     && /^insertFromPaste/.test(t)) return blocked(view);
				if (k.hemBlockMouse     && t === 'deleteByDrag')  return blocked(view);
				// Typing over a selection is a deletion wearing a different
				// inputType. Without this, select-all-then-type still wipes the
				// note even with every delete key locked.
				if (k.hemBlockBackspace && /^insert/.test(t)) {
					try {
						if (view && !view.state.selection.main.empty) return blocked(view);
					} catch (_) { /* older CM state shape — fall through */ }
				}
				return false;
			},
			cut(e, view)   { return plugin.settings.hemBlockCut   ? blocked(view) : false; },
			paste(e, view) { return plugin.settings.hemBlockPaste ? blocked(view) : false; },
			mousedown(e, view) {
				if (!plugin.settings.hemBlockMouse || !locked(view)) return false;
				// Swallowing mousedown outright would also swallow the click
				// that focuses the editor, leaving no way back in after
				// visiting another pane. Focus explicitly instead — CodeMirror
				// restores the existing selection rather than moving the caret.
				if (!view.hasFocus) { view.focus(); return true; }
				return blocked(view);
			},
			contextmenu(e, view) { return plugin.settings.hemBlockMouse ? blocked(view) : false; },
			dragstart(e, view)   { return plugin.settings.hemBlockMouse ? blocked(view) : false; },
			drop(e, view)        { return plugin.settings.hemBlockMouse ? blocked(view) : false; }
		}) : null;

		const exts = [];
		const km = keymap.of(binds);
		exts.push(Prec ? Prec.highest(km) : km);
		if (handlers) exts.push(Prec ? Prec.highest(handlers) : handlers);
		return exts;
	}

	// Feedback for a blocked key. A screen flash has to sit above the
	// letterbox masks or it simply does not appear in the one mode most
	// likely to be running alongside Hemingway.
	flashHemingway() {
		const target = this.settings.hemFlashTarget || 'screen';
		if (target === 'none') return;
		if (target === 'screen' || target === 'both') this.flashHemingwayScreen();
		if (target === 'retrobar' || target === 'both') this.flashHemingwayBar();
	}

	flashHemingwayScreen() {
		let el = this._hemScreenEl;
		if (!el || !el.isConnected) {
			el = document.createElement('div');
			el.className = 'zg-hem-screen';
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
	}

	flashHemingwayBar() {
		const el = this.retroStatusBarEl;
		if (!el) return;
		el.classList.remove('zg-hem-blocked');
		void el.offsetWidth;
		el.classList.add('zg-hem-blocked');
		if (this._hemFlashTimer) window.clearTimeout(this._hemFlashTimer);
		this._hemFlashTimer = window.setTimeout(() => {
			if (this.retroStatusBarEl) this.retroStatusBarEl.classList.remove('zg-hem-blocked');
			this._hemFlashTimer = null;
		}, 500);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Word count: file tree + outline
	// ─────────────────────────────────────────────────────────────────────────

	// ════════════════════════════════════════════════════════════════════════
	// SIDEBAR WORD COUNTS
	// ════════════════════════════════════════════════════════════════════════

	attachExplorerObserver() {
		// Observe only the file-explorer and outline leaf containers — the
		// old body-wide observer scheduled a full explorer re-scan on any DOM
		// change anywhere (typing repaints, tooltips, …). Re-bound from the
		// layout-change handler since these leaves can be recreated.
		this.detachExplorerObserver();
		this.scheduleExplorerPatch();
		this.explorerObserver = new MutationObserver(() => this.scheduleExplorerPatch());
		const targets = document.querySelectorAll(
			'.workspace-leaf-content[data-type="file-explorer"], .workspace-leaf-content[data-type="outline"]');
		targets.forEach(t => this.explorerObserver.observe(t, { childList: true, subtree: true }));
	}

	detachExplorerObserver() {
		if (this.explorerObserver) { this.explorerObserver.disconnect(); this.explorerObserver = null; }
	}

	scheduleExplorerPatch() {
		if (this._patchScheduled) return;
		this._patchScheduled = true;
		requestAnimationFrame(() => { this._patchScheduled = false; this.patchExplorerDOM(); });
	}

	async patchExplorerDOM() {
		// Covers scheduleExplorerPatch() calls from active-leaf-change, vault
		// modify, and the mutation observer while the plugin is toggled off.
		if (!this.settings.pluginEnabled) return;
		if (this.settings.enableFileTreeCounts) {
			const roots = document.querySelectorAll('.workspace-leaf-content[data-type="file-explorer"]');
			for (let ri = 0; ri < roots.length; ri++) {
				const root  = roots[ri];
				const tiles = root.querySelectorAll('.nav-file-title');
				const jobs  = [];
				for (let i = 0; i < tiles.length; i++) {
					const path = tiles[i].dataset && tiles[i].dataset.path;
					if (path && path.endsWith('.md')) jobs.push(this.applyFileWordCount(tiles[i], path));
				}
				await Promise.all(jobs); // parallel reads, not one await per file
				this.applyFolderSums(root);
			}
		} else {
			document.querySelectorAll('.nav-file-title .zg-count, .nav-folder-title .zg-count').forEach(el => el.remove());
		}
		if (this.settings.enableOutlineCounts) {
			const oroots = document.querySelectorAll('.workspace-leaf-content[data-type="outline"]');
			await Promise.all(Array.from(oroots, r => this.applyOutlineWordCounts(r)));
		} else {
			document.querySelectorAll('.tree-item-self .zg-count').forEach(el => el.remove());
		}
	}

	async applyFileWordCount(el, path) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return;
		const hit = this.wordCountCache.get(path);
		if (hit && hit.mtime === file.stat.mtime) { this.setCountBadge(el, hit.count); return; }
		try {
			const text = await this.app.vault.cachedRead(file);
			const count = this.countWords(text); // frontmatter excluded, matching the status bar
			this.wordCountCache.set(path, { mtime: file.stat.mtime, count });
			this.setCountBadge(el, count);
		} catch (_) {}
	}

	applyFolderSums(root) {
		const folders = root.querySelectorAll('.nav-folder-title');
		for (let i = folders.length - 1; i >= 0; i--) {
			const fEl = folders[i].closest('.nav-folder');
			if (!fEl) continue;
			const children = fEl.querySelector('.nav-folder-children');
			if (!children) continue;
			let total = 0;
			children.querySelectorAll('.zg-count[data-wc]').forEach(b => total += parseInt(b.dataset.wc, 10) || 0);
			this.setCountBadge(folders[i], total);
		}
	}

	async applyOutlineWordCounts(outlineRoot) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;
		const cache = this.app.metadataCache.getFileCache(activeFile);
		if (!cache || !cache.headings) return;
		let text;
		try { text = await this.app.vault.cachedRead(activeFile); } catch (_) { return; }
		const counts = new Map();
		cache.headings.forEach((h, i) => {
			const start = h.position.end.offset;
			const end   = (i + 1 < cache.headings.length) ? cache.headings[i + 1].position.start.offset : text.length;
			const slice = text.slice(start, end).trim();
			counts.set('plain:' + h.heading, slice === '' ? 0 : slice.split(/\s+/).length);
		});
		outlineRoot.querySelectorAll('.tree-item-self').forEach(node => {
			const inner = node.querySelector('.tree-item-inner');
			if (!inner) return;
			const count = counts.get('plain:' + inner.textContent.trim());
			if (count != null) this.setCountBadge(node, count);
		});
	}

	setCountBadge(parentEl, count) {
		parentEl.style.display = 'flex'; parentEl.style.alignItems = 'center'; parentEl.style.justifyContent = 'space-between';
		const inner = parentEl.querySelector('.nav-file-title-content, .nav-folder-title-content, .tree-item-inner');
		if (inner) { inner.style.flex = '1'; inner.style.overflow = 'hidden'; inner.style.textOverflow = 'ellipsis'; inner.style.whiteSpace = 'nowrap'; }
		let badge = parentEl.querySelector('.zg-count');
		if (!badge) { badge = document.createElement('span'); badge.className = 'zg-count'; parentEl.appendChild(badge); }
		badge.dataset.wc = String(count);
		if (badge.textContent !== count.toLocaleString()) badge.textContent = count.toLocaleString();
	}

	removeWordCounts() {
		document.querySelectorAll('.zg-count').forEach(el => el.remove());
		if (this.wordCountCache) this.wordCountCache.clear();
	}
};

// =============================================================================
// Settings tab
// =============================================================================

class WordSmithSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
		// Transient UI memory (last non-zero arrow count, active tab) lives here
		// — on the tab instance — so it never gets persisted into data.json.
		this._lastArrowCount = null;
		this._activeTab = 'zen';
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('Word-Smith').setHeading();

		// ── Master on/off ──────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName('Enable Word-Smith')
			.setDesc('Master switch — turns the entire plugin on or off without uninstalling it.')
			.addToggle(t => t.setValue(this.plugin.settings.pluginEnabled)
				.onChange(async v => {
					this.plugin.settings.pluginEnabled = v;
					await this.plugin.saveSettings(true); // master switch lands immediately, not debounced
					this.display();
				}));

		if (!this.plugin.settings.pluginEnabled) return;

		this.toggle(containerEl, 'Restore cursor position',
			'Reopen notes where you left the caret.',
			'restoreCursorPosition');

		this.renderScopeSection(containerEl);

		containerEl.createEl('hr', { cls: 'ws-settings-hr' });

		// ── Tab bar ──────────────────────────────────────────────────────────────
		const TABS = [
			{ id: 'zen',        label: 'Zen',          render: this.displayZenTab },
			{ id: 'typewriter', label: 'Typewriter',   render: this.displayTypewriterTab },
			{ id: 'hemingway',  label: 'Hemingway',    render: this.displayHemingwayTab },
			{ id: 'retrobar',   label: 'Retro Bar',    render: this.displayRetroBarTab },
			{ id: 'syntax',     label: 'Syntax',       render: this.displaySyntaxTab },
			{ id: 'text',       label: 'Text Options', render: this.displayTextTab },
			{ id: 'misc',       label: 'Misc',         render: this.displayMiscTab }
		];
		if (!this._activeTab || !TABS.some(t => t.id === this._activeTab)) this._activeTab = TABS[0].id;

		const navEl = containerEl.createEl('div', { cls: 'ws-tab-nav' });
		TABS.forEach(tab => {
			const btn = navEl.createEl('button', {
				text: tab.label,
				cls: 'ws-tab-btn' + (this._activeTab === tab.id ? ' is-active' : '')
			});
			btn.addEventListener('click', () => {
				if (this._activeTab === tab.id) return;
				this._activeTab = tab.id;
				this.display();
			});
		});

		const bodyEl = containerEl.createEl('div', { cls: 'ws-tab-body' });
		const active = TABS.find(t => t.id === this._activeTab);
		active.render.call(this, bodyEl);
	}

	// ── Scope picker (sits directly under the master switch) ──────────────────
	renderScopeSection(containerEl) {
		const s = this.plugin.settings;
		if (!Array.isArray(s.scopePaths)) s.scopePaths = [];
		const paths   = s.scopePaths;
		const exclude = s.scopeMode === 'exclude';

		const desc = paths.length === 0
			? 'Empty — Word-Smith applies to every note. Add folders or notes to narrow it.'
			: (exclude
				? 'Applies everywhere except the paths below.'
				: 'Applies only to the paths below.');

		const setting = new Setting(containerEl)
			.setName('Where Word-Smith applies')
			.setDesc(desc)
			.addDropdown(d => d
				.addOption('include', 'Only these')
				.addOption('exclude', 'Everywhere except')
				.setValue(s.scopeMode || 'include')
				.onChange(async v => {
					s.scopeMode = v;
					await this.plugin.saveSettings(true);
					this.display();
				}));

		if (WsPathSuggestModal) {
			setting
				.addButton(b => b.setButtonText('Add folder').onClick(() => this.pickScopePath('folder')))
				.addButton(b => b.setButtonText('Add note').onClick(() => this.pickScopePath('file')));
		}

		const help = containerEl.createEl('div', { cls: 'ws-fm-help' });
		help.createEl('p', {
			text: 'Frontmatter overrides the list above for a single note:',
			cls: 'ws-settings-note'
		});
		help.createEl('pre', {
			cls: 'ws-fm-sample',
			text: [
				'---',
				'wordsmith: off        # ignore this note entirely',
				'ws-zen: true          # or override one mode at a time',
				'ws-typewriter: false',
				'ws-hemingway: true',
				'ws-syntax: true',
				'ws-markers: false',
				'ws-typography: false',
				'ws-goal: 2000        # word target for this note',
				'ws-font: Literata    # font for this note only',
				'---'
			].join('\n')
		});

		if (!paths.length) return;

		const list = containerEl.createEl('div', { cls: 'ws-scope-list' });
		paths.forEach((path, i) => {
			const row = list.createEl('div', { cls: 'ws-scope-row' });
			row.createEl('span', {
				cls: 'ws-scope-path' + (path.endsWith('.md') ? '' : ' is-folder'),
				text: path === '/' ? 'Entire vault' : path
			});
			const btn = row.createEl('button', { cls: 'ws-scope-remove', text: '\u00d7' });
			btn.setAttribute('aria-label', 'Remove ' + path);
			btn.addEventListener('click', async () => {
				s.scopePaths.splice(i, 1);
				await this.plugin.saveSettings(true);
				this.display();
			});
		});
	}

	pickScopePath(kind) {
		if (!WsPathSuggestModal) return;
		const s = this.plugin.settings;
		const have = new Set(s.scopePaths || []);
		let items;
		if (kind === 'folder') {
			// TFolder is not on every API version; the children property is
			// the reliable way to tell a folder from a file either way.
			items = this.app.vault.getAllLoadedFiles()
				.filter(f => f && (TFolder ? f instanceof TFolder : f.children !== undefined))
				.map(f => f.path)
				.filter(path => path && path !== '/' && !have.has(path));
			if (!have.has('/')) items.unshift('/');
		} else {
			items = this.app.vault.getMarkdownFiles()
				.map(f => f.path)
				.filter(path => !have.has(path));
		}
		if (!items.length) return;
		new WsPathSuggestModal(
			this.app,
			items,
			kind === 'folder' ? 'Choose a folder\u2026' : 'Choose a note\u2026',
			async (picked) => {
				if (!Array.isArray(s.scopePaths)) s.scopePaths = [];
				if (!s.scopePaths.includes(picked)) s.scopePaths.push(picked);
				await this.plugin.saveSettings(true);
				this.display();
			}
		).open();
	}

	// ── Zen tab ────────────────────────────────────────────────────────────────
	displayZenTab(containerEl) {
		// One master switch over both halves, so there is a single thing
		// called "Zen" rather than two features that happen to be filed
		// together. The Z badge in the bar toggles this.
		new Setting(containerEl)
			.setName('Zen')
			.setDesc('Master switch for focus mode and letterbox.')
			.addToggle(t => t.setValue(this.plugin.settings.zenEnabled)
				.onChange(async v => {
					this.plugin.settings.zenEnabled = v;
					await this.plugin.saveSettings(true);
					this.display();
				}));

		if (!this.plugin.settings.zenEnabled) return;

		containerEl.createEl('hr', { cls: 'ws-settings-hr' });

		new Setting(containerEl)
			.setName('Focus mode')
			.setDesc('Hide UI chrome and collapse sidebars for distraction-free writing.')
			.addToggle(t => t.setValue(this.plugin.settings.zenMode)
				.onChange(async () => { await this.plugin.toggleZenMode(); this.display(); }));

		if (this.plugin.settings.zenMode) {
			const z = this.sub(containerEl);

			this.toggle(z, 'Full screen', 'Enter fullscreen when enabling zen mode.', 'fullscreen');

			this.toggle(z, 'Focused file mode', 'Only show the active file — hide all other panes.', 'focusedFileMode');

			this.label(z, 'Hide in zen mode');
			const hide = this.sub(z);
			this.toggle(hide, 'Properties',       'Hide note properties / frontmatter.',   'hideProperties');
			this.toggle(hide, 'Inline title',      'Hide the inline note title.',            'hideInlineTitle');
			this.toggle(hide, 'Native status bar', 'Hide Obsidian\'s built-in status bar in zen mode. (The retro bar always hides it while active, regardless of this setting.)', 'hideStatusBar');
			this.toggle(hide, 'Linked mentions',   'Hide linked mentions panel.',            'hideLinkedMentions');
			this.toggle(hide, 'Scroll bar',        'Hide the editor scroll bar.',            'hideScrollBar');
			this.toggle(hide, 'Ribbon',            'Hide the left ribbon bar.',               'hideRibbon');

			this.label(z, 'Padding');
			const pad = this.sub(z);
			this.slider(pad, 'Top',    'Extra space above editor content (0–100 px).', 'topPadding',    0, 100, 1);
			this.slider(pad, 'Bottom', 'Extra space below editor content (0–100 px).', 'bottomPadding', 0, 100, 1);
		}

		// Letterbox lives here rather than in a tab of its own: it is the
		// other half of the same idea — one hides the app around the text,
		// the other hides the text around the line you are writing.
		containerEl.createEl('hr', { cls: 'ws-settings-hr' });
		this.displayLetterboxSection(containerEl);
	}
	// ── Typewriter tab ─────────────────────────────────────────────────────────
	displayTypewriterTab(containerEl) {
		new Setting(containerEl)
			.setName('Typewriter mode')
			.setDesc('Keep the cursor line vertically centred as you type.')
			.addToggle(t => t.setValue(this.plugin.settings.enableTypewriter)
				.onChange(async v => {
					this.plugin.settings.enableTypewriter = v;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.enableTypewriter) {
			containerEl.createEl('p', { text: 'Letterbox masks and arrows have their own settings on the Mask tab. Horizontal text padding now lives on the Text Options tab.', cls: 'ws-settings-note' });

			const tw = this.sub(containerEl);

			// ── Current line highlight ─────────────────────────────────────────
			this.label(tw, 'Current line highlight');
			this.toggle(tw, 'Highlight current line', 'Tint the background of the line the cursor is on.', 'highlightCurrentLine', () => this.display());
			if (this.plugin.settings.highlightCurrentLine) {
				const hl = this.sub(tw);
				new Setting(hl).setName('Dark theme color').addColorPicker(cp => cp.setValue(this.plugin.settings.lineHighlightDarkColor).onChange(async v => { this.plugin.settings.lineHighlightDarkColor = v; await this.plugin.saveSettings(); }));
				new Setting(hl).setName('Light theme color').addColorPicker(cp => cp.setValue(this.plugin.settings.lineHighlightLightColor).onChange(async v => { this.plugin.settings.lineHighlightLightColor = v; await this.plugin.saveSettings(); }));
				this.slider(hl, 'Opacity', 'How strong the tint is.', 'lineHighlightOpacity', 0.05, 1, 0.05);
			}

			// ── Cursor position ─────────────────────────────────────────────────
			this.label(tw, 'Cursor position');
			tw.createEl('p', { text: 'How many lines of context to keep above/below the cursor. Equal values keep it dead-centre (the default).', cls: 'ws-settings-note' });
			const pos = this.sub(tw);
			this.numInput(pos, 'Lines above cursor', '', 'typewriterLinesAbove', 0, 40);
			this.numInput(pos, 'Lines below cursor', '', 'typewriterLinesBelow', 0, 40);

			// ── Focus dimming ────────────────────────────────────────────────────
			this.label(tw, 'Focus dimming');
			this.toggle(tw, 'Dim unfocused text', 'Fade everything outside the focus area while you write.', 'dimUnfocusedEnabled', () => this.display());
			if (this.plugin.settings.dimUnfocusedEnabled) {
				const dim = this.sub(tw);
				new Setting(dim).setName('Focus area')
					.addDropdown(d => d
						.addOption('paragraph', 'Paragraph')
						.addOption('sentence',  'Sentence')
						.setValue(this.plugin.settings.dimFocusMode || 'paragraph')
						.onChange(async v => { this.plugin.settings.dimFocusMode = v; await this.plugin.saveSettings(); }));
				this.slider(dim, 'Opacity', 'Opacity of the dimmed, unfocused text.', 'dimOpacity', 0.05, 1, 0.05);
			}
		} else {
			containerEl.createEl('p', {
				text: 'Turn this on to also use the letterbox masks on the Mask tab — they require typewriter mode to be active.',
				cls: 'ws-settings-note'
			});
		}
	}

	// ── Mask (arrows) tab ──────────────────────────────────────────────────────
	displayLetterboxSection(containerEl) {
		if (!this.plugin.settings.enableTypewriter) {
			containerEl.createEl('p', {
				text: 'Typewriter mode is off, so masks won\'t be visible yet. Enable it from the Typewriter tab.',
				cls: 'ws-settings-note'
			});
		}

		new Setting(containerEl)
			.setName('Letterbox')
			.setDesc('Top and bottom masks framing the writing area.')
			.addToggle(t => t.setValue(this.plugin.settings.enableLetterbox)
				.onChange(async v => {
					this.plugin.settings.enableLetterbox = v;
					await this.plugin.saveSettings(true);
					this.display();
				}));

		if (this.plugin.settings.enableLetterbox) {
			const ls = this.sub(containerEl);

			new Setting(ls).setName('Mask height (px)').setDesc('Drag the separator line in zen mode to adjust live.')
				.addSlider(s => s.setLimits(0, 400, 4)
					.setValue(this.plugin.settings.letterboxPx != null
						? Math.round(this.plugin.settings.letterboxPx)
						: (this.plugin.settings.letterboxLines || 8) * 26)
					.setDynamicTooltip()
					.onChange(async v => { this.plugin.settings.letterboxPx = v; await this.plugin.saveSettings(); }));

			this.slider(ls, 'Horizontal inset', 'Insets the arrow/line layer. Drag the arrow row to adjust live.', 'maskPaddingH', 0, 400, 10);

			new Setting(ls).setName('Show arrows').setDesc('Arrow characters along the mask edges.')
				.addToggle(t => t.setValue(this.plugin.settings.arrowCount > 0)
					.onChange(async v => {
						if (!v) this._lastArrowCount = this.plugin.settings.arrowCount || 5;
						this.plugin.settings.arrowCount = v ? (this._lastArrowCount || 5) : 0;
						await this.plugin.saveSettings(); this.display();
					}));

			if (this.plugin.settings.arrowCount > 0) {
				const as = this.sub(ls);
				new Setting(as).setName('Arrow style')
					.addDropdown(d => d
						.addOption('solid-triangle',   '▲ / ▼  Solid triangles')
						.addOption('outline-triangle', '△ / ▽  Outline triangles')
						.addOption('standard-arrow',   '↑ / ↓  Standard arrows')
						.addOption('chevron',          '∧ / ∨  Chevrons')
						.addOption('double-chevron',   '⇑ / ⇓  Double chevrons')
						.addOption('custom',           'Custom characters')
						.setValue(this.plugin.settings.arrowStyle)
						.onChange(async v => { this.plugin.settings.arrowStyle = v; await this.plugin.saveSettings(); this.display(); }));
				if (this.plugin.settings.arrowStyle === 'custom') {
					new Setting(as).setName('Top char').addText(t => t.setValue(this.plugin.settings.customArrowTop).onChange(async v => { this.plugin.settings.customArrowTop = v || '^'; await this.plugin.saveSettings(); }));
					new Setting(as).setName('Bottom char').addText(t => t.setValue(this.plugin.settings.customArrowBottom).onChange(async v => { this.plugin.settings.customArrowBottom = v || 'v'; await this.plugin.saveSettings(); }));
				}
				this.numInput(as, 'Arrow count', 'Number per row (1–10).', 'arrowCount', 1, 10);
				this.slider(as, 'Arrow scale', 'Size multiplier.', 'arrowScale', 0.5, 3, 0.1);
			}

			this.label(ls, 'Separator line');
			new Setting(ls).setName('Line style')
				.addDropdown(d => d
					.addOption('none',   'None (hidden)')
					.addOption('solid',  'Solid ——')
					.addOption('dashed', 'Dashed - - -')
					.addOption('dotted', 'Dotted · · ·')
					.addOption('double', 'Double ═══')
					.setValue(this.plugin.settings.separatorStyle)
					.onChange(async v => { this.plugin.settings.separatorStyle = v; await this.plugin.saveSettings(); }));
			this.slider(ls, 'Line weight', 'Thickness (1–8 px).', 'separatorWeight', 1, 8, 1);

			this.label(ls, 'Colors');
			ls.createEl('p', { text: 'Dark and light variants switch automatically with your theme.', cls: 'ws-settings-note' });
			this.label(ls, 'Dark theme');
			const cdk = this.sub(ls);
			new Setting(cdk).setName('Arrows color').addColorPicker(cp => cp.setValue(this.plugin.settings.arrowDarkColor).onChange(async v => { this.plugin.settings.arrowDarkColor = v; await this.plugin.saveSettings(); }));
			new Setting(cdk).setName('Separator line color').addColorPicker(cp => cp.setValue(this.plugin.settings.lineDarkColor).onChange(async v => { this.plugin.settings.lineDarkColor = v; await this.plugin.saveSettings(); }));
			this.label(ls, 'Light theme');
			const clt = this.sub(ls);
			new Setting(clt).setName('Arrows color').addColorPicker(cp => cp.setValue(this.plugin.settings.arrowLightColor).onChange(async v => { this.plugin.settings.arrowLightColor = v; await this.plugin.saveSettings(); }));
			new Setting(clt).setName('Separator line color').addColorPicker(cp => cp.setValue(this.plugin.settings.lineLightColor).onChange(async v => { this.plugin.settings.lineLightColor = v; await this.plugin.saveSettings(); }));
		}
	}

	// ── Retro Bar tab ──────────────────────────────────────────────────────────
	displayRetroBarTab(containerEl) {
		new Setting(containerEl)
			.setName('Retro status bar')
			.setDesc('Fixed retro-styled bar at the bottom. Auto-hides the native status bar while active.')
			.addToggle(t => t.setValue(this.plugin.settings.enableRetroStatus)
				.onChange(async v => {
					this.plugin.settings.enableRetroStatus = v;
					this.plugin.updateStatusBar();
					this.plugin.updateRetroStatusBar();
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.enableRetroStatus) {
			const rb = this.sub(containerEl);

			this.label(rb, 'Format');
			rb.createEl('p', {
				text: 'Tokens: {file} {words} {chars} {paragraph} {goal} {mode} {readtime} {time} {date} {battery} {caps} {num} {vim} {lock}\n'
					+ 'Buttons: {syntax} {markers} {font}',
				cls: 'ws-settings-note'
			});
			new Setting(rb).setName('Rows').setDesc('Stacked lines, each with left, center and right slots.')
				.addSlider(sl => sl.setLimits(1, 3, 1)
					.setValue(Math.max(1, Math.min(3, this.plugin.settings.statusBarRows || 1)))
					.setDynamicTooltip()
					.onChange(async v => {
						this.plugin.settings.statusBarRows = v;
						await this.plugin.saveSettings();
						this.display();
					}));

			const rows = this.plugin.getStatusRows();
			const SLOTS = [
				['left',   'Left',   'Aligned to the left edge.'],
				['center', 'Center', 'Centered in the row.'],
				['right',  'Right',  'Aligned to the right edge.']
			];
			rows.forEach((row, i) => {
				if (rows.length > 1) this.label(rb, 'Row ' + (i + 1));
				const fmt = this.sub(rb);
				SLOTS.forEach(slot => {
					new Setting(fmt).setName(slot[1]).setDesc(slot[2])
						.addText(t => t.setPlaceholder('e.g. {file}')
							.setValue(row[slot[0]])
							.onChange(async v => {
								this.plugin.settings.statusRows[i][slot[0]] = v;
								await this.plugin.saveSettings();
							}));
				});
			});
			// Its own container: the per-row `fmt` sub-panels are scoped to the
			// loop above, and this setting applies across all rows.
			const tokenOpts = this.sub(rb);
			new Setting(tokenOpts).setName('{file} format').setDesc('What the {file} token shows.')
				.addDropdown(d => d
					.addOption('path', 'Full path  ~/folder/note')
					.addOption('name', 'File name only  note')
					.setValue(this.plugin.settings.fileTokenFormat || 'path')
					.onChange(async v => { this.plugin.settings.fileTokenFormat = v; await this.plugin.saveSettings(); this.plugin.updateRetroStatusBar(); }));
			this.slider(rb, 'Font size', 'Font size (8–24 px).', 'statusBarFontSize', 8, 24, 1);
			this.slider(rb, 'Row height', 'Height of a single row (20–60 px). The bar is this tall per row.', 'statusBarHeight', 20, 60, 1);
			this.label(rb, 'Top border');
			const bd = this.sub(rb);
			new Setting(bd).setName('Line style')
				.addDropdown(d => d
					.addOption('none',   'None')
					.addOption('solid',  'Solid')
					.addOption('dashed', 'Dashed')
					.addOption('dotted', 'Dotted')
					.addOption('double', 'Double')
					.addOption('groove', 'Groove')
					.addOption('ridge',  'Ridge')
					.setValue(this.plugin.settings.statusBarBorderStyle || 'solid')
					.onChange(async v => {
						this.plugin.settings.statusBarBorderStyle = v;
						await this.plugin.saveSettings();
						this.display();
					}));
			if ((this.plugin.settings.statusBarBorderStyle || 'solid') !== 'none') {
				this.slider(bd, 'Line weight', 'Thickness (1\u20138 px).', 'statusBarBorderWidth', 1, 8, 1);
			}

			this.label(rb, 'Reading time');
			const sp = this.sub(rb);
			this.numInput(sp, 'Reading speed',
				'Words per minute used by {readtime}.',
				'readTimeWpm', 50, 1000);

			this.label(rb, 'Writing goal');
			const gs = this.sub(rb);
			new Setting(gs).setName('Word target').setDesc('Target word count. Click the bar to reset the baseline.')
				.addText(t => {
					t.inputEl.type = 'number'; t.inputEl.min = '1'; t.inputEl.addClass('ws-num-input');
					t.setValue(String(this.plugin.settings.goalTarget));
					t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n) && n > 0) { this.plugin.settings.goalTarget = n; await this.plugin.saveSettings(); } });
				});
			new Setting(gs).setName('Display style')
				.addDropdown(d => d
					.addOption('ring',     'Ring')
					.addOption('fraction', 'Fraction only  847/1,000')
					.setValue(this.plugin.settings.goalDisplay)
					.onChange(async v => { this.plugin.settings.goalDisplay = v; await this.plugin.saveSettings(); this.display(); }));
			if (this.plugin.settings.goalDisplay !== 'fraction') {
				this.toggle(gs, 'Percentage in the ring',
					'Show the completed percentage inside the ring.', 'goalRingPercent');
				this.slider(gs, 'Ring weight', 'Thickness of the ring (1\u20138).', 'goalRingWeight', 1, 8, 1);
			}

			this.label(rb, 'Date format');
			const df = this.sub(rb);
			const preview = df.createEl('code');
			const refreshPreview = () => preview.setText(this.plugin.formatDate(new Date()));
			new Setting(df).setName('Format string').setDesc('Tokens: dd  mm  yy  yyyy')
				.addText(t => {
					t.setPlaceholder('dd/mm/yyyy').setValue(this.plugin.settings.dateFormat);
					t.onChange(async v => { this.plugin.settings.dateFormat = v || 'dd/mm/yyyy'; await this.plugin.saveSettings(); refreshPreview(); });
				});
			const fmtRow = df.createEl('div', { cls: 'ws-fmt-row' });
			for (const fmt of ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'dd.mm.yy', 'dd-mm-yyyy', 'yyyy/mm/dd']) {
				const btn = fmtRow.createEl('button', { text: fmt });
				btn.addEventListener('click', async () => { this.plugin.settings.dateFormat = fmt; await this.plugin.saveSettings(); this.display(); });
			}
			df.createEl('small', { text: 'Preview: ' }).appendChild(preview);
			refreshPreview();

			// ── Colors (inside retro bar) ─────────────────────────────────────────
			this.label(rb, 'Colors');
			rb.createEl('p', { text: 'Dark and light variants switch automatically with your theme.', cls: 'ws-settings-note' });

			this.toggle(rb, 'Custom colours',
				'Off, the bar follows your theme.',
				'retroCustomColors', () => this.display());
			if (!this.plugin.settings.retroCustomColors) return;

			this.label(rb, 'Dark theme');
			const dk = this.sub(rb);
			new Setting(dk).setName('Bar background').addColorPicker(cp => cp.setValue(this.plugin.settings.retroDarkBgColor).onChange(async v => { this.plugin.settings.retroDarkBgColor = v; await this.plugin.saveSettings(); }));
			new Setting(dk).setName('Bar text / accent').addColorPicker(cp => cp.setValue(this.plugin.settings.retroDarkTextColor).onChange(async v => { this.plugin.settings.retroDarkTextColor = v; await this.plugin.saveSettings(); }));

			this.label(rb, 'Light theme');
			const lt = this.sub(rb);
			new Setting(lt).setName('Bar background').addColorPicker(cp => cp.setValue(this.plugin.settings.retroLightBgColor).onChange(async v => { this.plugin.settings.retroLightBgColor = v; await this.plugin.saveSettings(); }));
			new Setting(lt).setName('Bar text / accent').addColorPicker(cp => cp.setValue(this.plugin.settings.retroLightTextColor).onChange(async v => { this.plugin.settings.retroLightTextColor = v; await this.plugin.saveSettings(); }));
		}
	}

	// ── Syntax tab ────────────────────────────────────────────────────────────
	displaySyntaxTab(containerEl) {
		const s = this.plugin.settings;

		containerEl.createEl('p', {
			text: 'Colour words by grammatical class. The tagger is a heuristic, so treat a colour as a prompt, not a verdict.',
			cls: 'ws-settings-note'
		});

		new Setting(containerEl)
			.setName('Syntax highlight')
			.setDesc('Turn the colouring on.')
			.addToggle(t => t.setValue(s.posEnabled)
				.onChange(async v => {
					s.posEnabled = v;
					await this.plugin.saveSettings(true);
					this.display();
				}));

		if (!s.posEnabled) return;

		const ps = this.sub(containerEl);
		ps.createEl('p', {
			text: 'One class at a time reads best. Everything at once is a rainbow.',
			cls: 'ws-settings-note'
		});

		this.catRow(ps, 'Nouns',        'Nouns and pronouns.',                  'posNoun',        'posNounColor');
		this.catRow(ps, 'Verbs',        'Verbs, auxiliaries and modals.',       'posVerb',        'posVerbColor');
		this.catRow(ps, 'Adjectives',   'Adjectives. Articles are excluded.',   'posAdjective',   'posAdjectiveColor');
		this.catRow(ps, 'Adverbs',      'All adverbs, including not and very.', 'posAdverb',      'posAdverbColor');
		this.catRow(ps, 'Conjunctions', 'Conjunctions and prepositions.',       'posConjunction', 'posConjunctionColor');

		this.toggle(ps, 'Mute everything else',
			'Fade everything outside the selected classes.',
			'posDimOthers');
		this.toggle(ps, 'Skip code and math',
			'Leave code, frontmatter and math uncoloured.',
			'syntaxSkipCode');

		ps.createEl('p', {
			text: 'Add {syntax} to the retro bar for a one-click picker.',
			cls: 'ws-settings-note'
		});
	}

	// ── Hemingway tab (write-forward lock) ────────────────────────────────────
	displayHemingwayTab(containerEl) {
		const s = this.plugin.settings;

		containerEl.createEl('p', {
			text: 'Blocks the keys you use to go back and revise, so a draft can only move forward. '
				+ 'Nothing is permanent — switch it off here or with the "Hemingway mode" command at any time.',
			cls: 'ws-settings-note'
		});

		new Setting(containerEl)
			.setName('Hemingway mode')
			.setDesc('Lock the editor to typing forward.')
			.addToggle(t => t.setValue(s.hemingwayEnabled)
				.onChange(async v => {
					s.hemingwayEnabled = v;
					await this.plugin.saveSettings(true);   // a lock should land now, not in 120ms
					this.display();
				}));

		if (!s.hemingwayEnabled) return;

		const h = this.sub(containerEl);

		this.label(h, 'Removing text');
		this.toggle(h, 'Block backspace',     'And the word- and line-delete variants.', 'hemBlockBackspace');
		this.toggle(h, 'Block delete',        'Forward delete.',                                    'hemBlockDelete');
		this.toggle(h, 'Block undo and redo', 'Including from the Edit menu.',       'hemBlockUndo');
		this.toggle(h, 'Block cut',           'Keyboard, menu and right-click.',               'hemBlockCut');
		this.toggle(h, 'Block paste',         'Off by default — pasting a quote or a note is not self-editing.', 'hemBlockPaste');

		this.label(h, 'Moving the cursor');
		this.toggle(h, 'Block arrow keys',    'All four, including shift-selection.',    'hemBlockArrows');
		this.toggle(h, 'Block jump keys',     'Home, End, Page Up, Page Down.',                  'hemBlockJumpKeys');
		this.toggle(h, 'Block select all',    'A selection is one keystroke from a rewrite.',  'hemBlockSelectAll');
		this.toggle(h, 'Block mouse',         'Caret clicks, right-click and text dragging. Clicking into an unfocused editor still works.', 'hemBlockMouse');

		this.label(h, 'Feedback');
		new Setting(h).setName('Flash when blocked')
			.setDesc('Where to show that a key was refused.')
			.addDropdown(d => d
				.addOption('none',     'None')
				.addOption('screen',   'Screen')
				.addOption('retrobar', 'Retro bar')
				.addOption('both',     'Both')
				.setValue(this.plugin.settings.hemFlashTarget || 'screen')
				.onChange(async v => { this.plugin.settings.hemFlashTarget = v; await this.plugin.saveSettings(); }));

		h.createEl('p', {
			text: 'Add {lock} to the retro bar for a lock indicator.',
			cls: 'ws-settings-note'
		});
	}

	// ── Text Options tab (text options + typography + word counts) ────────────
	displayTextTab(containerEl) {
		this.renderTypographySection(containerEl);
		containerEl.createEl('hr', { cls: 'ws-settings-hr' });
		new Setting(containerEl)
			.setName('Text options')
			.setDesc('Paragraph indent, line spacing, justification, and sidebar word counts.')
			.addToggle(t => t.setValue(this.plugin.settings.miscEnabled)
				.onChange(async v => { this.plugin.settings.miscEnabled = v; await this.plugin.saveSettings(); this.display(); }));

		if (this.plugin.settings.miscEnabled) {
			const mc = this.sub(containerEl);

			this.slider(mc, 'Horizontal padding', 'Left/right text padding inside the editor. Applies everywhere — not just zen mode.', 'editorPaddingH', 0, 400, 10);

			this.toggle(mc, 'Paragraph indent', 'Indent the first line of paragraphs.', 'enableParagraphIndent', () => this.display());
			if (this.plugin.settings.enableParagraphIndent) {
				const pi = this.sub(mc);
				new Setting(pi).setName('Indent trigger')
					.addDropdown(d => d
						.addOption('double', 'Blank line (double Enter)')
						.addOption('single', 'Every line (single Enter)')
						.setValue(this.plugin.settings.paragraphIndentMode || 'double')
						.onChange(async v => { this.plugin.settings.paragraphIndentMode = v; await this.plugin.saveSettings(); }));
				this.slider(pi, 'Indent size (em)', 'Width of the indent.', 'paragraphIndentEm', 0.5, 8, 0.5);
			}
			this.toggle(mc, 'Limit line length',
				'Fix the text column width regardless of window size.',
				'limitLineLength', () => this.display());
			if (this.plugin.settings.limitLineLength) {
				this.numInput(this.sub(mc), 'Characters per line',
					'Character widths (20\u2013200). 64 suits prose.',
					'maxLineChars', 20, 200);
			}

			new Setting(mc).setName('Line spacing').setDesc('Line height multiplier (e.g. 1, 1.5, 2).')
				.addText(t => {
					t.inputEl.type = 'number'; t.inputEl.min = '0.8'; t.inputEl.max = '4'; t.inputEl.step = '0.1'; t.inputEl.addClass('ws-num-input');
					t.setValue(String(this.plugin.settings.lineSpacing != null ? this.plugin.settings.lineSpacing : 1.5));
					t.onChange(async v => { const n = parseFloat(v); if (!isNaN(n) && n >= 0.8 && n <= 4) { this.plugin.settings.lineSpacing = n; await this.plugin.saveSettings(); } });
				});
			this.toggle(mc, 'Justify text', 'Full-justify paragraph text in both editing and reading views.', 'justifyText');

			this.label(mc, 'Hidden markers');
			this.toggle(mc, 'Show hidden markers', 'Reveal invisible whitespace and line breaks in the editor.', 'showHiddenMarkers', () => this.display());
			if (this.plugin.settings.showHiddenMarkers) {
				const hm = this.sub(mc);
				this.toggle(hm, 'Spaces', 'Mark every space with a middle dot (·).', 'markSpaces');
				this.toggle(hm, 'Tabs', 'Mark every tab with an arrow (→).', 'markTabs');
				this.toggle(hm, 'Paragraphs', 'Mark blank (paragraph-break) lines with a pilcrow (¶).', 'markParagraphs');
				this.toggle(hm, 'End of lines', 'Mark the end of every line with a return arrow (↵).', 'markEndOfLines');
			}

		}
	}

	// ── Misc tab ──────────────────────────────────────────────────────────────
	displayMiscTab(containerEl) {
		this.label(containerEl, 'Word counts');
		this.toggle(containerEl, 'File tree counts',
			'Word count per note in the file explorer, summed into folders.',
			'enableFileTreeCounts', () => this.display());
		this.toggle(containerEl, 'Outline counts',
			'Word count per heading in the outline panel.',
			'enableOutlineCounts', () => this.display());
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	sub(root) {
		return root.createEl('div', { cls: 'ws-settings-sub' });
	}

	label(root, text) {
		root.createEl('p', { text, cls: 'ws-settings-label' });
	}

	renderTypographySection(containerEl) {
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName('Typography')
			.setDesc('Replace typed shorthand with real characters. Undo restores what you typed.')
			.addToggle(t => t.setValue(s.typographyEnabled)
				.onChange(async v => {
					s.typographyEnabled = v;
					await this.plugin.saveSettings(true);
					this.display();
				}));

		if (!s.typographyEnabled) return;

		const ty = this.sub(containerEl);
		ty.createEl('p', {
			text: 'Never applies inside code, math or frontmatter.',
			cls: 'ws-settings-note'
		});

		this.toggle(ty, 'Curly quotes',  'Straight quotes become curly. Apostrophes too: don\u2019t.', 'typoSmartQuotes');
		this.toggle(ty, 'Ellipsis',      '... becomes \u2026', 'typoEllipsis');
		this.toggle(ty, 'Dashes',        '-- \u2192 \u2013, --- \u2192 \u2014, ---- backs out to literal.', 'typoDashes');
		this.toggle(ty, 'Arrows',        '-> \u2192, <- \u2190, => \u21d2', 'typoArrows');
		this.toggle(ty, 'Comparisons',   '<= \u2264, >= \u2265, /= \u2260. Collides with <= in code.', 'typoComparisons');
		this.toggle(ty, 'Guillemets',    '<< \u00ab and >> \u00bb', 'typoGuillemets');
		this.toggle(ty, 'Fractions',     '1/2 \u00bd, 3/4 \u00be, and the rest.', 'typoFractions');
	}

	// One row carrying both a colour picker and an on/off toggle — used by the
	// prose tab, where every category needs both and a row each would double
	// the tab's height.
	catRow(c, name, desc, onKey, colorKey) {
		return new Setting(c).setName(name).setDesc(desc || '')
			.addColorPicker(cp => cp.setValue(this.plugin.settings[colorKey])
				.onChange(async v => { this.plugin.settings[colorKey] = v; await this.plugin.saveSettings(); }))
			.addToggle(t => t.setValue(this.plugin.settings[onKey])
				.onChange(async v => { this.plugin.settings[onKey] = v; await this.plugin.saveSettings(); }));
	}

	toggle(c, name, desc, key, cb) {
		return new Setting(c).setName(name).setDesc(desc || '')
			.addToggle(t => t.setValue(this.plugin.settings[key]).onChange(async v => {
				this.plugin.settings[key] = v;
				await this.plugin.saveSettings();
				if (cb) cb.call(this, v);
			}));
	}

	slider(c, name, desc, key, min, max, step) {
		return new Setting(c).setName(name).setDesc(desc || '')
			.addSlider(s => s.setLimits(min, max, step || 1).setValue(this.plugin.settings[key]).setDynamicTooltip()
				.onChange(async v => { this.plugin.settings[key] = v; await this.plugin.saveSettings(); }));
	}

	numInput(c, name, desc, key, min, max) {
		return new Setting(c).setName(name).setDesc(desc || '')
			.addText(t => {
				t.inputEl.type = 'number'; t.inputEl.min = String(min); t.inputEl.max = String(max); t.inputEl.addClass('ws-num-input');
				t.setValue(String(this.plugin.settings[key]));
				t.onChange(async v => { const n = parseInt(v, 10); if (!isNaN(n) && n >= min && n <= max) { this.plugin.settings[key] = n; await this.plugin.saveSettings(); } });
			});
	}
}
/* nosourcemap */