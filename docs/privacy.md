# Privacy and your files

[← Back to the README](../README.md)

## Privacy

Word-Smith is local. No network calls of any kind: no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no `requestUrl`. No telemetry. No dependencies.

**What it reads:** your note's text, in memory, while it's open, for counts and coloring. The report reads a folder's notes when you open it. An export reads the notes you ticked.

**What it stores:**

- `data.json` in the plugin folder: your settings and saved bars. With history on, also each note's last word count, so a save can be turned into a difference. That cache rebuilds itself and can be deleted.
- Your history file, if history is on: one row per day, the date and how many words you added, cut and netted. Counts only, never a word of what you wrote.
- Your targets, flags, order and export ticks: note and folder names and numbers, no prose.

An exported manuscript is the obvious exception. You asked for your words in a file, so the file has your words in it.

**One thing the community plugin review flags, so you know what it is.** The clipboard is touched only when you press a button that says copy or paste: settings, diagnostics, a share code. There is no file access outside Obsidian's vault API. (Earlier versions read the battery level from a system folder on Linux; that read is gone, and `{battery}` uses the browser's own battery API everywhere.)

Don't take my word for it:

```bash
grep -nE "fetch\(|XMLHttpRequest|WebSocket|requestUrl|sendBeacon" main.js
```

That returns nothing.

## The three notes Word-Smith keeps

Plain notes, all in `Word-Smith/` on a new vault, yours to read, edit, move or delete:

| | |
|---|---|
| `ws-history.md` | One row per day: added, deleted, net |
| `ws-structure.md` | Your book's order, targets, flags, folder colors, which properties are columns, what's ticked for export, and the properties of files that have no frontmatter of their own (PDFs, spreadsheets, images) |
| `ws-settings.md` | A readable mirror of your settings, so a new machine can be handed the lot |

Each is found by the markers inside it, not by its name, so moving or renaming is safe. Their locations show under **Misc**. If you already have these in your vault root, they stay put.

`ws-structure.md` is one path per line, so a sync engine or git can merge it line by line. A conflict is one scene misplaced, not a broken book. The reader repairs rather than rejects: duplicate lines dropped, unknown paths ignored, missing notes appended.

Your history file is the only copy. Back it up with your vault.
