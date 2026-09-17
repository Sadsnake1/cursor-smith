// Generated from the plugin's working bundle by tools/gen-ts.js - the
// module split, the imports and the type annotations are the script's; the
// code and its comments are the bundle's.

// Bracket Tether: the pairs it will follow, and how far it will scan for a
// match. The cap keeps a runaway scan (an unmatched brace in a large note)
// bounded; 20k characters is far past anything a tether is readable across.
// Angle brackets are included so HTML tags, autolinks <https://…> and literal
// <> pair up too. They are depth-matched like the others, so a `<` used as a
// less-than sign (or a `>` blockquote marker) can occasionally pair with a
// stray partner; that's an accepted cost of a decorative guide.
export const BRACKET_OPEN = { "(": ")", "[": "]", "{": "}", "<": ">" };
export const BRACKET_CLOSE = { ")": "(", "]": "[", "}": "{", ">": "<" };
export const BRACKET_SCAN_LIMIT = 20000;

// A structural block cuts the tether: a pair with one end inside a code block,
// blockquote or callout and the other outside it isn't a pair, it's two
// unrelated characters that happen to match. A `<` in a ```` ```html ```` block
// and a stray `>` in the prose below it was the case that started this.
//
// The two kinds of block are marked completely differently, and the difference
// decides how each is detected:
//
//   • A CODE FENCE is a delimiter LINE. You cross it. So the question is
//     "is there a fence line between the two ends", answered by scanning the
//     span. Asking instead "is this offset inside a code block" would need
//     fence PARITY counted from the top of the document - an O(document) scan
//     on every keystroke, since the tether's cache key includes doc length.
//
//   • A BLOCKQUOTE (and therefore a CALLOUT, which is just a blockquote whose
//     first line carries a [!type] marker) has no delimiter lines at all. It
//     is a per-line PREFIX: every line carries ">", and the block ends at the
//     first line that doesn't. So membership is a purely LOCAL property of a
//     line, needing no scan beyond the line itself - and the question is
//     "do both ends sit at the same quote depth, unbroken".
//
// Both come out of one walk over the lines the span touches: cut on any fence
// line beginning inside the span, or on any line whose quote depth differs
// from the depth of the line the span starts on. A blank line between two
// quoted passages reads as depth 0 and correctly separates them.
export const CODE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
// Longest prefix CODE_FENCE_RE can need: 3 spaces of indent + 3 fence chars.
// Used to read a few characters past the end of a span so a fence opening the
// span's final line is still matchable when the span stops mid-fence.
export const CODE_FENCE_PREFIX = 8;
// How far back a ">" will look for the start of its line before giving up on
// deciding whether it's a blockquote marker. A real prefix is "> " per level;
// this is many levels deeper than anything legible.
export const BLOCK_PREFIX_MAX = 64;
// Enough of a line to read its quote depth and then test it for a fence.
export const BLOCK_HEAD_MAX = BLOCK_PREFIX_MAX + CODE_FENCE_PREFIX;
// How far back to reach for the start of the line a span BEGINS on, whose
// depth is the baseline every later line is compared against. Overrunning a
// longer line than this misreads that baseline as depth 0, which can only
// produce a spurious cut, never a spurious tether.
export const BLOCK_LINE_LOOKBACK = 1024;

// The blockquote depth of one line, and whether what remains after stripping
// that prefix opens a code fence. Callouts need no special case: "> [!note]"
// is a blockquote line like any other, and its body lines carry the same ">".
export function blockLineInfo(line) {
  let i = 0;
  let depth = 0;
  for (;;) {
    // Up to 3 spaces of indent are allowed before each ">" marker; a 4th would
    // make the line an indented code block instead.
    let j = i;
    let spaces = 0;
    while (j < line.length && (line[j] === " " || line[j] === "\t") && spaces < 3) { j++; spaces++; }
    if (line[j] !== ">") break;
    depth++;
    i = j + 1;
    if (line[i] === " ") i++; // the single optional space after a marker
  }
  return { depth, fence: CODE_FENCE_RE.test(line.slice(i, i + CODE_FENCE_PREFIX)) };
}

// Is text[i] a blockquote marker rather than a closing angle bracket? True
// when nothing but prefix characters sit between it and the start of its line.
//
// This is what stops the tether joining a "<" in one line to the ">" that
// merely OPENS the next one - by far the most visible way a decorative guide
// gets Markdown wrong, since in a callout every single line starts with one.
//
// `textStart` is the document offset of text[0], so a slice that begins
// mid-document isn't mistaken for the start of a line.
export function isBlockquoteMarker(text, i, textStart) {
  const floor = Math.max(0, i - BLOCK_PREFIX_MAX);
  for (let j = i - 1; j >= floor; j--) {
    const c = text[j];
    if (c === "\n") return true;
    if (c !== ">" && c !== " " && c !== "\t") return false;
  }
  // Ran out of look-back without finding a line start: only genuinely one if
  // we reached the top of the document.
  return floor === 0 && textStart === 0;
}

// Quote-ish delimiters the tether will also pair up. Backtick is in here
// because inline code spans are everywhere in Markdown and behave exactly like
// a quoted run; drop it from this list if that's not wanted.
export const QUOTE_CHARS = ['"', "'", "`"];
// Quotes, unlike brackets, aren't directional - the same character opens and
// closes - so they're paired left-to-right across a single line rather than by
// depth counting. That's also why they're line-scoped: pairing across lines
// would join a stray apostrophe to one three paragraphs away.
//
// Curly (typographic) quotes are the exception: “ ‘ open and ” ’ close, like
// brackets do, so they are matched directionally instead of by left-to-right
// pairing (see quoteSpanAt). They still get the apostrophe guard, because ’ is
// also the correct character for a typographic apostrophe - "don’t" - and must
// not be read as a closing quote when it sits between two letters.
export const CURLY_QUOTE_OPEN = { "\u201C": "\u201D", "\u2018": "\u2019" };  // “ → ”, ‘ → ’
export const QUOTE_LINE_SCAN = 4000;
export const WORD_CHAR = /[\p{L}\p{N}_]/u;
// A quote wedged between two word characters is an apostrophe, not a
// delimiter - "don't", "it's", "rock'n'roll", "don’t". Skipping those is what
// stops the tether pairing the apostrophe in "don't" with the one in "it's" and
// drawing a line across the sentence between them.
export function isQuoteDelimiter(text, i) {
  return !(WORD_CHAR.test(text[i - 1] || "") && WORD_CHAR.test(text[i + 1] || ""));
}
