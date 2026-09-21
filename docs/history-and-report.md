# History and the writing report

[← Back to the README](../README.md)

## Writing history

<table>
  <tr>
    <td width="50%"><img alt="History, day view" src="https://github.com/user-attachments/assets/5a751b82-0882-4d7b-95b8-7cf6dc35e8d0" /></td>
    <td width="50%"><img alt="History, calendar view" src="https://github.com/user-attachments/assets/a8c415e5-0768-4289-984b-54ab9bf4951c" /></td>
  </tr>
</table>

Off until you switch it on, under **Settings → Word-Smith → Manuscript → History**, or with the **Start counting** button in the History pane.

Then it counts how much you write each day and draws it at four zooms: day, month, year, and a calendar. Words you added rise from the center line, words you cut fall below it. A hard day of editing shows as work, not a gap. Above the chart: total, daily average, best day, active days, streak.

Type a note or folder name and the whole pane scopes to it. `ch3scene` finds `My Book/Part One/Ch 03/Scene 2.md`.

Two kindnesses in the numbers. A day counts if you wrote or cut, so cutting won't break your streak. And the average divides by the days you actually wrote, so days off don't drag it down.

## Your history is an ordinary note

A table, one row per day:

```markdown
| Date | Added | Deleted | Net |
| --- | ---: | ---: | ---: |
| 2026-08-01 | 912 | 142 | 770 |
```

A new vault gets it at `Word-Smith/ws-history.md`. Move it, rename it, keep it next to the manuscript. Word-Smith finds it by the markers inside it and leaves anything you write outside them alone. It's the only copy, so back it up with your vault.

Nothing before the day you switch it on can be reconstructed. A file only knows when it was touched, not how much went into it.

## Never counted

One list of notes and folders is left out of your totals. An outline, a research folder, a scratch file. Word-Smith still works in them. They just don't count.

## What counts as a word

Prose only. Frontmatter, `%%` and HTML comments, code blocks, maths, link targets, URLs and markup are stripped first. Headings, lists, quotes and footnotes count. The bar, the report, the Organizer and the history all use this one counter, so the numbers agree everywhere.

## The writing report

<img width="570" alt="The writing report" src="https://github.com/user-attachments/assets/809fc7a8-1d85-4a8e-9ea4-a03e6bff0cfd" />

`{report}` on the bar, the menu, or right-click a row in the Organizer. Words against the target, with a gauge, then characters, syllables, sentences, paragraphs, pages, read time and a reading grade. Hover a figure and it explains itself.

The path under the title is a breadcrumb of every folder above the note. Click one to total that level. How long is this chapter and will the book land are one click apart. A report on an Organizer selection totals just those rows.

Under the figures, **Words frequency**: every word in the note, how often it appears, and its share as a bar in the same colors the Organizer's target cells use. Common words (the, and, of) stay out until you tick **Include common words**. A share too small for two decimals shows as many as it needs, so a word that is there never reads as 0.00%.
