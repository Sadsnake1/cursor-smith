// The About page (settings-tab.ts, aboutPage), as Word-Smith has one: this
// release's notes, built in - nothing is fetched, the plugin makes no
// network calls - and the links, which open in the browser.
//
// WHATS_NEW is the release notes as they go on GitHub, word for word: a
// version bump writes them here first, and the notes for the release page
// are copied from here. English only, like the notes themselves.

export const REPO_URL = "https://github.com/Sadsnake1/cursor-smith";
export const README_URL = REPO_URL + "#readme";
export const ISSUES_URL = REPO_URL + "/issues/new";
export const VIDEO_URL = "https://www.youtube.com/watch?v=RQJtw-SdTc0";
export const WORD_SMITH_URL = "https://youtu.be/HLq91cDWx0s";
export const FUNDING_URL = "https://buymeacoffee.com/sadsnake1";

export const WHATS_NEW = `
- **New: About.** The last page of the settings: what's new in this version, the video, the docs, and a quick way to report a bug.
- **New:** Glide speed goes up to 1.00, for a cursor that snaps into place (#59).
- **Fixed:** after clicking back into a note, the cursor picked up its blink where it had left off and could come back invisible. It comes back lit now (#55).
- **Fixed:** with Ink stamp and Fresh ink both on, the stamped letter is in the ink's color from the first moment, not only once the stamp settles (#56).
- **Fixed:** on a line that mixes Arabic and English, typing a word in the other direction played no effects, and the effects on Arabic and Hebrew letters were drawn a letter to the right (#57).
- **Fixed:** with Keep up with typing on, a Glide speed set above Typing glide was slowed down to it.

Thanks to rotane, yeliaBdE, JAWredstoneguy and 01Zack for the reports.
`;

// The notes' own shape drawn as the page shows it: "### a heading" (a
// bold line - the settings build no HTML headings), "- a line" (a list),
// anything else a paragraph; **bold** inside a line. Text only - nothing in
// the notes is read as markup.
export function whatsNewInto(box: HTMLElement, md: string) {
  let list: HTMLElement | null = null;
  for (const raw of md.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const h = /^#{1,6} +(.*)$/.exec(line);
    if (h) { inline(box.createDiv({ cls: "cursor-smith-about-head" }), h[1]); list = null; continue; }
    const li = /^[-*] +(.*)$/.exec(line);
    if (li) { if (!list) list = box.createEl("ul"); inline(list.createEl("li"), li[1]); continue; }
    inline(box.createEl("p"), line);
    list = null;
  }
}

// A line's text, its **bold** parts in <strong>.
function inline(el: HTMLElement, text: string) {
  const parts = text.split("**");
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2) el.createEl("strong", { text: part });
    else el.appendText(part);
  });
}
