# The Organizer

[← Back to the README](../README.md)

The big boy. Obsidian's file explorer is the tree, the Organizer is the table. Click a folder in the explorer and every file under it becomes a row, with any property as a column.

<img width="1573" alt="The Organizer: a folder as a table of chapters" src="https://github.com/user-attachments/assets/d1fa8dc0-21cb-475b-81a2-11a012c086f0" />

Run **Open the Organizer** from the command palette or the menu. It's a pane, so dock it next to the note you're writing. It follows whatever note you open, and the arrow keys walk the table without changing the folder. If you'd rather it stayed put, press the pin at the end of the path line: the file explorer stops moving it until you press the pin again (the path line's own crumbs still do). On a phone, two fingers zoom the table.

No project file, no special folder. Your folders and files, as they are.

## Any file

Notes keep their properties in their own frontmatter, and the Organizer edits them there. Everything else (PDFs, spreadsheets, images, canvases, audio, epubs) gets its properties written to `ws-structure.md`, a plain note in your vault. Same table, same columns.

So a note tagged `#birds` and a PDF tagged `#birds` sit in one filtered list. A spreadsheet can carry a checkbox. A book cover can carry the editions of the book. You can run an e-book database with real epub files, or a contracts folder, or a research archive. Bases does this for notes. The Organizer does it for every file.

## The table

Readings the frontmatter can't give you: word count, target, flag, reading grade, paragraphs, tasks, tags, backlinks, outgoing links, footnotes, created, last modified. Turn on the ones you want. Then add any property in your vault as a column and edit it right there. Tags are Obsidian's own pills, so a theme that colors your tags colors them here too.

- Click a header to sort. Click again to flip. Again to go back to book order. The sort and the filter you leave on come back after a restart.
- **Filter** is a text search plus chips: pick a property, pick a value. Chips stack. No query language. The same button picks which kinds of file show up. The search box sits above the tabs, so it's there on Export and History too.
- Click a row to look at it, click again to open it. A new note from the row menu stays put so you can name it on the spot.
- Folder rows add up what's inside them, folded or not, and a **Total** row at the foot adds up everything you're looking at.
- **Row numbers**, at the foot of the Sort menu: 1, 2, 3 for the folder you opened, 1.1 and 1.2 inside a chapter.
- A cell you're editing never gets redrawn under you.

## Bulk edit and undo

Ctrl (or Cmd) click gathers note rows into a selection, Shift click takes the range, a plain click or Escape lets it go. The bar says how many you hold. A flag, a target or a property set on one of them lands on all of them, and a list edit is a difference: adding a tag adds it, removing a tag removes only that one, and nothing else in those notes moves. Bulk edit is desktop only.

Every act the Organizer writes is one step back: a flag, a target, a property, a rename, a bulk edit as one step. Ctrl+Z and Ctrl+Shift+Z while the pane has the focus, or the two buttons beside Collapse all. Undo says what it undid, right there beside the buttons.

## Properties

One button, **Properties**, one flat list. Tick to show, drag to reorder, search at the top. Add a new property by picking its type first: text, list, number, checkbox, date, or date and time. Editors come from Obsidian's own registry, so a list is chips with autocomplete and a checkbox is a toggle.

Edits go through Obsidian's frontmatter writer. Your other keys are safe. The first write might tidy the formatting of that note's frontmatter, but not the values.

## Targets and flags

Give a note a word count to aim for. A folder's target is the sum of its notes, so a book laid out as folders carries a target at every level for free.

Three flags to start: **Draft**, **Revise**, **Done**; raise the count and **Sketch** and **Blocked** join them. Each has a little shape beside the word, so they read at any size. Settings → Word-Smith → Manuscript sets how many you have, their names, one of thirteen shapes, and a color for dark and light. Click a flag to cycle it, or press space on the row. A folder's flag cell counts its notes' flags, shape by shape. Turn on **File tree → File tree flags** and the same flag shows in Obsidian's explorer.

Targets and flags follow your files when you rename or move them. They live in `ws-structure.md`. See [Privacy and your files](privacy.md).

## Export

Select several folders in the explorer, right-click, **Export these**. Or tick boxes in the explorer while the Export pane is open: any note, any folder, from anywhere in the vault. See [Export](export.md).

## Your own order

Obsidian sorts by name, which is why manuscripts end up as `01 - Opening`, `02 - The Ferry`. Turn on **File tree → Custom order in the file tree** and drag your chapters into the order the book reads in instead.

- Drag to the top or bottom edge of a row to put something above or below it. Drop on a folder and it still moves the file in, like always.
- New notes go to the end until you move them.
- The table draws that order. The manuscript compiles in it. One order, three places.
- It's kept in `ws-structure.md`, one path per line. Edit it by hand if you like.
- Switch it off and Obsidian's order comes back. Yours isn't thrown away.

## In Obsidian's explorer

Under **Settings → Word-Smith → Manuscript → File tree**: word counts (folders total what's inside), flags, tasks left, goal percentage, folder icons, file-kind icons. **Outline counts** put a word count beside each heading, so you can see which scene ran long.
