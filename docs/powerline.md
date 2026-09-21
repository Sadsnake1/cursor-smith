# The powerline bar

[← Back to the README](../README.md)

A status bar you write yourself. One to three rows, each with a left, center and right slot. You type a row as text, and the punctuation between tokens becomes shape and color.

<img width="1858" alt="A minimal powerline bar" src="https://github.com/user-attachments/assets/cadd2b38-a1f9-45f6-bad8-5a81ec4292a7" />
<img width="1862" alt="A full powerline bar with fades and dividers" src="https://github.com/user-attachments/assets/5e08b3eb-748d-482c-99e3-c418bbe07d39" />

Three bars ship with it, **Plain**, **Code** and **Fade**, as cards at the top of the Powerline page: tap one to use it, and the card shows a small sample of its colors. **Save** keeps the bar as it is under a name; the copy button on a card puts its share code on the clipboard, and **Import** takes one somebody sent you. The full reference is also in the plugin, under **How to write a row** on the Powerline page.

## Readouts

| | |
|---|---|
| `{file}` | The note's name. Click it to reveal the note in the explorer |
| `{words}` `{chars}` | The note, or your selection |
| `{ln:col}` `{paragraph}` | Where the cursor is |
| `{readtime}` | How long the note takes to read |
| `{tasks}` | Tasks ticked over tasks in the note, `[3/7]`, as the Organizer shows them. Nothing when there are none |
| `{properties}` | How many properties the note has. Click to open the Properties pane |
| `{backlinks}` | How many notes link here. Click to open the backlinks pane |
| `{time}` `{clock}` | The time, written or drawn as a dial |
| `{dd}` `{mm}` `{yyyy}` `{yy}` | Date parts, joined however you like |
| `{battery}` `{caps}` `{num}` | Battery; caps and num lock, only when on |
| `{vim}` | Which Vim mode you're in |
| `{mode}` | A Modes button: letter box, typewriter, Hemingway, right on the bar |
| `{flag}` | The flag of the note you're in. Click to change it |
| `{obsidian}` | A small Obsidian crystal |
| `{#>}` | The heading path: `Chapter 3 › The Ferry › Beat 2` |

## Buttons

`{syntax}` `{prose}` `{markers}` `{font}` `{theme}` are pickers. `{report}`, `{history}`, `{export}` and `{organizer}` open those panes; `{powermenu}` opens the Powermenu, the menu of everything. Buttons are never dropped, however narrow the window gets.

Every token that has an icon can be shown as the icon, the word, or both, one drop-down each under **Powerline → Token formats**: the pickers and the pane buttons, `{flag}`, `{properties}` and `{backlinks}`. The two counts always show their number; the drop-down picks what follows it. A clickable token takes your accent color under the pointer.

## Dividers

The character you type is the shape you get.

| | |
|---|---|
| `>` `<` | arrow |
| `\|` | straight |
| `)` `(` | curve |
| `~` | wave |
| `/` `\` | slanted cuts |

`{s}` is a quarter-space. `::` is a short thin line, `>>` and `<<` are the same line bent to a point. Dividers are drawn as SVG, so no patched font needed.

## Color

Seven colors, a dark set and a light set. `:N` paints the background, `;N` paints the text. A token with no color lies flush with the bar.

| | |
|---|---|
| `{words}:3` | Palette color nr. 3 behind the segment |
| `{words}:3;1` | And text color nr. 1 |
| `{words};vim` | Text follows your Vim mode |
| `{file}:b1` to `:b4` | Your theme's own surfaces |
| `{file}:bs` | The status line's own color |
| `{file}:bc` | The caret's color, live |
| `{file};t1` `;t2` `;t3` | Your theme's normal, muted and faint text |

Leave the `;` off and the text picks itself, light or dark, so it stays readable.

`{g}` is a fade, one color stepping into the next. `{g}{g}{g}` is three narrow steps, `{ggg}` one wide one. Fades are the first thing dropped when the window gets narrow.

Put a color at the very start of row 1 and the whole bar takes it: a colon paints the whole bar's background, a semicolon all of its text, and a token with a color of its own keeps it.

```
:vim {vim} > {file} :: {ln:col}
:3;2 {file} :: {words} words
```

## Sizing

Row height, font size, padding and the top and bottom rules are yours to set, in a dark and a light pair. The bar's text can follow your note's zoom, and **Interface font** keeps the bar in Obsidian's own face whatever font the note is in. When the window narrows, the bar drops decoration first and the file name last, and everything comes back when it widens.
