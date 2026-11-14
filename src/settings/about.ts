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
- **Fixed:** in a very long note, jumping from the start to the end (Ctrl+Home, then Ctrl+End) no longer slows Obsidian to a crawl. The cursor's canvas stays about a screen tall instead of growing to the whole note (#61).
- **Fixed:** selecting with Shift or Ctrl+Shift and the arrows, Home or End no longer drags a smear or a glide across the text you are selecting. The cursor goes straight to the end of the selection; everything else moves as before (#62).
- **Changed:** the version shows on the About entry only; the line under the settings pages is gone.

Thanks to rotane and connor-cihula for the reports.
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
