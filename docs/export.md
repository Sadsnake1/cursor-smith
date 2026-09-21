# Export

[← Back to the README](../README.md)

Pick a folder, or several, or one note, and Word-Smith compiles it into one manuscript: **PDF**, **Word (.docx)**, **web page (.html)** or **Markdown**.

It's a pane of its own. Open it from the command palette (**Export a manuscript…**), the menu, `{export}` on the bar, or select folders in Obsidian's explorer, right-click, **Export these**.

<img width="1570" alt="The Export tab with a paged preview" src="https://github.com/user-attachments/assets/99bc31c9-8781-469a-8446-22f89105dec7" />

## What goes in

While the Export pane is open, every note and folder in Obsidian's explorer gets a tick box. Tick what goes in, from anywhere in the vault: a note in another folder joins the manuscript, a folder ticked from outside comes in whole, and a folder with only some of its notes in shows a half tick. The count keeps up. Order is the file tree's order, so drag a file to move it, drag a folder to move the whole chapter. Ticks and order are saved in `ws-structure.md`, so they survive closing the pane.

Several folders can be one book. Select Part One and Part Three, right-click, Export these, and they compile together in the order you picked them.

It remembers your last export: how many files, what format, where to. One click sets it up again.

## The submission standard

It opens on it. Title page, `Surname / Title / page` running header, each file on a new page, a `#` between scenes, 12pt serif, double spaced, indented paragraphs, no widows or orphans.

Everything else is a switch:

- **Front matter**: title page (with the word count, rounded if you like), running header, table of contents with working links.
- **Structure**: each file starts a new page, follows a divider, or runs straight on. Insert the file's name, the note's own heading, or nothing. Folder names as headings.
- **Typesetting**: paper, font, size (10 to 14pt), spacing, indents, curly quotes.
- **Also include**: properties, `%%` comments, `==highlights==`, image placeholders, footnotes as endnotes. All off by default.

Nine paper sizes: Letter, A4, Legal, Executive, B5, A5, plus the trim sizes a novel is actually printed at: trade paperback, digest and mass market. Margins scale with the paper.

**Font** searches the fonts on your machine, each shown in its own face. Type one you don't have and it's still accepted, because a manuscript set for someone else's computer is a real thing to want.

## The preview

The manuscript as pages, at the paper size you chose, before a single file is written. Page through it, zoom, **Fit** the whole sheet or **100%** for print size. Flip the paper dark for reading at night. Print still comes out ink on paper. **Refresh** redraws it after you edit and keeps your place.

Press **Expand** and the preview takes the whole pane as one reading column. Click a paragraph and the note opens beside the reader with the caret on it. A drop-down at the foot jumps to any note in the manuscript, and `[` and `]` step through them. That's the fastest way to read your book back.

## The formats

Word, web page and Markdown work on phones too. For a PDF on a phone, export the web page and print it from the browser; the pane says so where the format would be.

- **PDF** is printed by Obsidian's own engine from the same document the preview draws, so it matches what you saw.
- **Word** is a real `.docx` with styles.
- **Web page** is the same document with its page rules built in. Print it from any browser and you get the PDF again.
- **Markdown** is the plain compile. Also the way to glue a few notes into one file.

## Where it stops

It does the submission standard and the handful of choices around it. It doesn't try to be a compile engine with a hundred switches. Once the draft is out, it's Word time with your editor. Comments come back in `.docx` or PDF, and there's no point round-tripping them into Obsidian.

Two nice things fall out of that. The `.docx` lands in your vault, one click from Word. And export is versioning: export today, write for a week, export again, and Word's Compare shows exactly what changed.
