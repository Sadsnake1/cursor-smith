# Cursor-Smith

## Intro
Most people never give their cursor a second thought, but I decided to change that. Cursor-Smith is more than just a tweaky-toy — it is the *MOST* advanced cursor engine ever created (maybe).
It is designed for writers, users who need high-visibility accessibility options, and anyone who loves to customize theengs.
Forge your cursor of choice!

## Showcase
https://github.com/user-attachments/assets/30b013b3-d4f4-4ed7-8f34-b20b3525e12b

## Features
- **Cursor styles** — Box, Line, Underline, each with their own shape controls (serifs, hollow, outline width, letter-inside-the-block).
- **Smooth movement** — the cursor eases and glides between positions instead of jumping, with adjustable glide, catch-up speed, movement delay, and an optional adaptive boost while typing fast.
- **Customizable blinking** — control both how fast the cursor blinks and how the on/off time is balanced within each cycle, fade smoothness, a don't-blink-while-typing mode, or a breathing cursor that swells and shrinks instead of fading. Or turn blinking off entirely.
- **Appearance controls** — separate colors for dark/light themes, multi-stop gradients, adjustable thickness and opacity, glow, translucency, and MORE, MUCH-MUCH MORE.
- **Effects** — a dozen of them, from subtle to absurd. See the table below.
- **Torch spotlight** — darkens the page around a pool of warm light that follows your cursor, with a candle flicker.
- **Accessibility** — respects your system's reduced-motion preference out of the box, and every effect can be switched off individually.
- **Presets** — save any cursor configuration as a named preset, load or edit it later, and cycle through all your presets with a single command.
- **Preset sharing** — every preset gets a compact share code. Copy it, send it to a friend, and they can paste it straight into their own vault.
- **Vim mode** — per-mode cursors for Normal, Insert, Visual, Replace, and Command, each fully configurable. The live mode indicator sits in the status bar vim-style (`-- NORMAL --`), tinted to match the active cursor color.

## Installation
1. Download `main.js`, `styles.css`, and `manifest.json` (or clone this repo).
2. Create a folder named `cursor-smith` inside your vault's `.obsidian/plugins/` directory.
3. Copy the files into that folder.
4. Reload Obsidian (or restart it), then enable **Cursor-Smith** under **Settings → Community plugins**.

## Usage
Once enabled, the plugin activates automatically. You can:
- Toggle it on/off anytime with the **Toggle Cursor-Smith on/off** command in the Command Palette (`Ctrl/Cmd + P`).
- Cycle through all your saved presets with the **Cycle preset** command — assign it a hotkey in **Settings → Hotkeys** for quick switching. In CUA mode it cycles CUA presets; in Vim mode it cycles Vim presets.
- Adjust every visual detail from **Settings → Cursor-Smith**.

## Settings
The settings panel is organized into collapsible sections. Collapse the ones you don't use — Cursor-Smith remembers which sections you closed and where you were scrolled to, so the panel stays how you left it.

| Section | What it controls |
|---|---|
| **Core Configuration** | Enable the plugin, hide the real cursor, hide the cursor when Obsidian isn't focused, and respect reduced motion. |
| **Presets** | Save, load, edit, delete, and share cursor configurations. |
| **Appearance** | Cursor style and thickness, colors and gradients, glow, opacity, translucency, and (Box style only) showing the letter inside the cursor. |
| **Blinking** | Blink speed, the on/off balance of each blink, fade smoothness, blink delay, and breathing. |
| **Smooth Movement** | Enable gliding motion and tune its speed, catch-up behavior, movement delay, and typing-adaptive boost. |
| **Effects** | Everything the cursor does beyond sitting there. See below. |

### Effects

| Effect | What it does |
|---|---|
| **Pop Effects** | Popping letters, backspace disintegration, thunderstrike on Enter, and fireworks on Space/Enter. Rainbow sweeps all of them around the color wheel together. |
| **Pixel Trail** | A fading trail of pixels behind the cursor, with lifetime, size, gravity and jump-streak controls. |
| **Stardust** | A slow stream of floating motes, either drifting upward or orbiting the cursor like fireflies. |
| **Bracket Tether** | Underlines the span between matching brackets or quotes. |
| **Motion Smear** | The cursor's corners lag on springs, stretching as it moves and snapping back when it arrives. Optional comet-tail taper. |
| **Energy Beam** | Bands of light that slide or ripple through the cursor body, with an aurora mode. |
| **CRT Effect** | Old-monitor phosphor ghosts trailing the cursor, with neon-tube and gradient variants, plus Signal Glitch on long jumps. |
| **Speed Demon** | The cursor heats from grey to white-hot as you type, throwing sparks. Bring your own heat gradient if you like. |
| **Hot-head** | The cursor sets the text on fire. The fire spreads, lingers, and burns out when you stop. |
| **Torch Spotlight** | See below. |

### Torch Spotlight
Darkens the page except for a pool of light around the cursor, so only the part of the note you're working on stays lit.

It's built as two layers: a darkness layer that dims everything outside the pool, and a separate warm glow that *adds* light inside it. **Glow Strength** controls the warm core — slide it to 0 for a pure, colorless spotlight. **Flicker** makes the light gutter like a candle, and **Flicker Depth** sets how far it swings.

The light can follow the caret, the mouse, or whichever moved last, and it can pulse in time with your cursor's blink. On desktop, **Keep Sidebars Lit** dims only the editor and leaves the sidebars, tabs and ribbon at normal brightness.

## Accessibility
Cursor-Smith is animation-heavy by design, so it takes reduced motion seriously.

**Respect Reduced Motion** is on by default. When your system asks for reduced motion, the moving effects switch themselves off — smooth movement, motion smear, pop effects, pixel trail, stardust, fire, sparks, glitch, energy beam, and the torch's pulse and flicker. Your cursor keeps the style, color, size and glow you chose; only the movement stops.

Blinking is deliberately left alone. It's the standard behavior of every text caret, it's well under the flash thresholds, and it has its own switch if you want it gone.

If you'd rather run the effects anyway, turn the setting off.

## Presets
Cursor-Smith ships with six starter presets so you have something to work from right away.

| Preset | Style | Vibe |
|---|---|---|
| **Jell-O** | Box | Smooth smear and glide with a mint-green glow |
| **Torch-Crt** | Line | Warm amber line with CRT trail and torch spotlight |
| **mr.Blue** | Line | Clean blinking blue line with smooth movement |
| **FairyDust** | Underline | Pale yellow underline with pixel trail and energy beam |
| **DarkMatter** | Box | Blue-purple box with CRT trail and Speed Demon sparks |
| **old_Joe** | Box | Understated grey box, no frills |

**Saving a preset** — dial in your cursor exactly how you want it, type a name in the *Save current settings as preset* field, and click **Save**. The name field stays filled while you tweak, so changing the cursor style or any other setting mid-way won't erase what you typed.

**Editing a preset** — click **Edit** on any preset row. This loads its settings and pre-fills its name in the save field. Adjust whatever you like, then hit **Save** to overwrite it.

**Sharing a preset** — each preset row shows a short share code next to its name. Click **Copy** to copy it, then send it to anyone. They paste it into the **Import preset** field and click **Import** — done.

**Cycling presets** — run **Cursor-Smith: Cycle preset** from the Command Palette (or bind it to a hotkey) to step through all your presets one by one. A small toast notification shows the name of the preset that just loaded.

## Vim Mode
Switch to **Vim** using the CUA / Vim toggle at the top of the settings panel. Each of the five Vim modes gets its own fully independent cursor — style, color, blinking, motion effects, everything.

| Mode | When it applies |
|---|---|
| **Normal** | The default editing mode |
| **Insert** | After pressing `i`, `a`, `o`, etc. |
| **Visual** | After pressing `v`, `V`, or `Ctrl-v` |
| **Replace** | After pressing `R` |
| **Command** | The `:` / `/` prompt, plus the Command Palette, Quick Switcher, search boxes, and other interface fields |

Use the **tab row** in *Per-Mode Cursors* to switch between modes — each inactive tab is tinted with that mode's own cursor color as a live preview of your setup.

**Vim presets** work the same as CUA presets: save your full five-mode setup under a name, load it later, share it with a code. The **Cycle preset** command automatically cycles Vim presets when you are in Vim mode.

### Status bar
When Vim mode is active a `-- MODE --` indicator appears on the **left side** of the status bar, styled after Vim's own `showmode`. Enable coloring in settings to tint the text with the active mode's cursor color.

### Keybindings
Turn on **Control Obsidian's Vim key bindings** to let the plugin own that setting: switching to Vim mode forces Obsidian's native vim keybindings on, and switching to CUA forces them off. Turn it off if you manage that setting yourself.

## Feedback
Found a bug or have an idea for a new effect? Open an issue!

## Pricing
Cursor-Smith is 100% free.
If you'd like to support the project and help me keep the updates coming, you're more than welcome to buy me a coffee. Your support means the world. Cheers!

<div align="center">
  <a href="https://www.buymeacoffee.com/sadsnake1" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="200">
  </a>
</div>

## License
MIT
