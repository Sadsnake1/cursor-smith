<div align="center">

  <a href="https://github.com/Sadsnake1/cursor-smith/stargazers"><img src="https://img.shields.io/github/stars/Sadsnake1/cursor-smith?style=flat-square&logo=github&logoColor=white&labelColor=1a1a1a&color=F5B301" alt="Stars"></a>
  <a href="https://github.com/Sadsnake1/cursor-smith/releases"><img src="https://img.shields.io/github/downloads/Sadsnake1/cursor-smith/total?style=flat-square&logo=github&logoColor=white&labelColor=1a1a1a&color=10B981" alt="Downloads"></a>
  <a href="https://github.com/Sadsnake1/cursor-smith/releases/latest"><img src="https://img.shields.io/github/v/release/Sadsnake1/cursor-smith?style=flat-square&logo=obsidian&logoColor=white&labelColor=1a1a1a&color=8B5CF6" alt="Version"></a>
  <a href="https://github.com/Sadsnake1/cursor-smith/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Sadsnake1/cursor-smith?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=1a1a1a&color=3B82F6" alt="License"></a>
  <a href="https://www.buymeacoffee.com/sadsnake1" target="_blank"><img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000000&labelColor=FFDD00" alt="Buy Me a Coffee"></a>

  <h1>Cursor-Smith</h1>

  <p><strong>Forge your own cursor!</strong><br>
  The most advanced cursor engine there is. Desktop and mobile.</p>

</div>

Most people never think about their cursor. This is for the ones who do: writers who want a screen worth looking at, anyone who keeps losing the caret, and people who just like to make things their own.

Every effect has its own switch. Reduced motion is respected out of the box. It's free.

https://github.com/user-attachments/assets/7eab19cc-b7ac-4476-bc40-514b4e75cf61

## Install

**Settings → Community plugins → Browse**, search **Cursor-Smith**, install, enable. It's on as soon as you enable it.

## The cursor

Box, Line or Underline. Your colors for dark and light themes, or a gradient. Thickness, opacity, glow, translucency, a letter showing through the box.

It can blink the way you like: speed, balance, fade, breathing, or not at all, or not while you type. It can glide to its new spot instead of jumping there, faster when you type fast.

Multiple cursors get all of it. Every caret you add is drawn, styled and animated like the first.

## The effects

Ten of them, from subtle to absurd. Each has its own switch and its own settings.

| Effect | What it does |
|---|---|
| **Pop effects** | Letters pop out as you type, deletions burst, Enter strikes lightning, Space sends fireworks. Rainbow sweeps them all through the color wheel. |
| **Pixel trail** | A puff of pixels wherever the cursor has just been. |
| **Stardust** | Motes drifting up from the cursor, or orbiting it like fireflies. |
| **Bracket tether** | A line under the span between matching brackets or quotes. |
| **Motion smear** | The cursor stretches as it moves and snaps back when it arrives. |
| **Energy beam** | A pulse of light along the cursor; an aurora with a gradient. |
| **CRT effects** | Phosphor ghosts behind the cursor, neon and glitch options. |
| **Speed demon** | Heats from gray to white-hot as you type, throwing sparks. |
| **Hot-head** | Sets the text you're working on alight, in pixel-art flames. |
| **Torch spotlight** | Darkens everything except a pool of warm light around the cursor. |

Some of them unlock extra options together. Try Blinking with the torch.

## Settings

<p align="center">
  <img width="49%" alt="cursor-smith-settings-1" src="https://github.com/user-attachments/assets/398fc2df-15f4-44d4-8d0a-9d4e42b25cad" />
  <img width="49%" alt="cursor-smith-settings-2" src="https://github.com/user-attachments/assets/5711e10c-e6f0-491c-aacc-0cd5fc381206" />
</p>


The top of the panel is short: enable the plugin, Vim mode on or off, your presets, and the mode you're editing when Vim is on. Everything else is a page:

| Page | What's in it |
|---|---|
| **Behavior** | Notes only, hide the real cursor, hide when Obsidian isn't focused, low power mode, respect reduced motion |
| **Vim** | Obsidian's Vim key bindings and the status bar indicator |
| **Appearance** | Shape, color, opacity |
| **Blinking** | If it blinks, how, and how fast |
| **Smooth movement** | Gliding instead of jumping |
| **Effects** | Pick an effect, see its settings. A tick marks the ones that are on |
## Presets

Dial in a cursor, save it under a name, and it's one tap away in the settings. Every preset has a share code: copy it, send it, the other person imports it and has your cursor. Six come with the plugin to start from.

## Vim mode

Five modes, five cursors. Normal, Insert, Visual, Replace and Command each get their own look and effects, and a `-- NORMAL --` indicator in the status bar. Vim presets save all five under one name. The plugin can turn Obsidian's Vim key bindings on and off along with the mode, if you let it.

## Commands

Four, all in the Command Palette, all take a hotkey.

| Command | What it does |
|---|---|
| **Toggle Cursor-Smith on/off** | The whole plugin off and back on, settings untouched. |
| **Cycle preset** | The next saved preset. Bind it to a key and flip through your cursors. |
| **Toggle Vim mode** | One cursor, or one per Vim mode. Flips Obsidian's Vim key bindings with it when you've let it. |
| **Performance report** | Measures ten seconds of typing and copies a short report. Paste it into an issue if Obsidian feels slower with the plugin on. |

## Good to know

**Reduced motion.** When your system asks for it, the moving effects pause and the cursor keeps its look. Blinking stays, since it's the normal caret behavior; it has its own switch. If you lose the caret easily: thickness, glow, high-contrast colors and a bigger box all work with every effect off.

**Performance.** The plugin only repaints a small area around the caret and idles when nothing moves. If Obsidian still feels slower with it on, or you're on battery, **Low power mode** halves every effect's frame rate.

**Mobile.** Works on phones and tablets. The settings are built for a thumb.

## Building from source

A TypeScript project: `src/` holds the modules, `npm run build` bundles them into `main.js`, `npm run check` type-checks, `npm test` runs the suite (1,400 assertions) against the built bundle. [BUILDING.md](BUILDING.md) has the layout.

## Pairs with Word-Smith

[Word-Smith](https://github.com/Sadsnake1/word-smith) is my other plugin, a writing suite for Obsidian. Its themes can color your caret per Vim mode, and its status bar can wear the same color back.

## Forged elsewhere

Cursor-Smith is MIT, and the engine has been carried to other editors. Ported it somewhere? Open an issue and I'll add it here.

| Editor | Port | By |
|---|---|---|
| **Thymer** | [Cursor Tweaks](https://github.com/akaready/thymer-cursor-tweaks) | [akaready](https://github.com/akaready) |

## Questions, ideas, bugs

Found a bug, or want a new effect? [Write it here](https://github.com/Sadsnake1/cursor-smith/issues).

Free and MIT. If it's made your writing better, a coffee helps me keep going. Cheers!

<div align="center">
  <a href="https://www.buymeacoffee.com/sadsnake1" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="200">
  </a>
</div>
