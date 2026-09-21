# Writing modes

[← Back to the README](../README.md)

Each one is its own switch. Turn on one, or all of them.

## Zen

Zen is a list of things to hide, not one big switch. Properties, the inline title, Obsidian's status bar, linked mentions, the scroll bar, the ribbon, the powerline bar. Each has its own toggle. Plus full screen, focused file mode (close every other pane), and a title bar painted to match the editor. Zen means whatever you decide it means.

`Escape` leaves it. In Vim's insert, visual and replace modes, escape means back to normal first, so it costs one extra press.

Hide the bar and it comes back on hover. Move the pointer to the bottom of the window and it slides up for a moment. Set the linger to 0 and it stays gone.

## Letter box

Two masks in the note's own background color, so it reads as a narrowing page, not a black bar. Drag the line to resize, drag the arrows to change the inset. On desktop the top band moves the window like a title bar. The arrows have a few built-in looks, or use your own characters at any size, with separate colors for dark and light. It switches itself off in reading view, where there's no caret to frame.

## Typewriter

Keeps the line you're writing in the middle of the screen. It can tint that line, and dim everything outside the paragraph or sentence you're in.

## Hemingway

Locks the keys you'd use to go back and fiddle, so a first draft can only go forward. Each lock is separate: backspace, delete, undo, cut, paste, arrows, jump keys, select all, mouse clicks. A blocked key can flash the screen, the bar, a badge, or nothing. Horrible. It works.

## Typography

Turns what you type into the proper characters as you go: curly quotes, ellipses, dashes, arrows, fractions, guillemets. Never inside code, maths or frontmatter. Undo gives back exactly what you typed.

## Text options and markers

Text options cap the line length, indent paragraphs, set spacing, justify. Markers draw the spaces, tabs and line breaks you normally can't see.

## Fonts

Word-Smith reads the font list under **Obsidian → Appearance → Text font**. Add as many as you like there, then switch between them from `{font}` on the bar or the menu. A serif for drafting, a monospace for editing, a bitmap face for the MS-DOS look.

## Where it applies

Limit Word-Smith to certain folders: only these, or everywhere except these. Any note can override it from its frontmatter:

```yaml
---
wordsmith: off        # ignore this note entirely
ws-zen: true          # or override one thing at a time
ws-typewriter: false
ws-hemingway: true
ws-syntax: true       # the word classes
ws-checks: false      # the prose checks
ws-typography: false
---
```

Open a canvas, a PDF or an empty tab and everything stands down. It comes back the moment you're on a note.

## Vim

If Obsidian's Vim mode is on, Word-Smith stays out of its way and fills a few gaps. `j` and `k` can follow wrapped lines, so a long paragraph is one keystroke instead of twenty. The `:` command line gets its own row under the bar, so opening it doesn't shove things around. `H` `J` `K` `L` work in the sidebars if quick cycle is on.

`{vim}` puts the mode on the bar. `:vim` and `;vim` recolor a segment as the mode changes. See [Themes](themes.md) for coloring the caret by mode.

## Right-to-left

If Obsidian or the note is right-to-left, indents, padding and markers mirror. Word counting handles Hebrew, Arabic and Persian. Syntax coloring and prose checks are English only, and in another script they mark nothing rather than marking it wrongly.
