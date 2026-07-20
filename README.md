#  Cursor-Smith
## Intro
Most people never give their cursor a second thought, but I decided to change that. Cursor-Smith is more than just a tweaky-toy, it is the *MOST* advanced cursor engine ever created (maybe).
It is designed for writers, users who need high-visibility accessibility options, and anyone who loves to customize theengs.
Forge your cursor of choice!

## Showcase
https://github.com/user-attachments/assets/30b013b3-d4f4-4ed7-8f34-b20b3525e12b

## Features
- **Cursor styles** — Box, Line, Underline.
- **Smooth movement** — the cursor eases and glides between positions instead of jumping, with adjustable glide, catch-up speed, and an optional adaptive boost while typing fast.
- **Customizable blinking** — control both how fast the cursor blinks and how the on/off time is balanced within each cycle, or turn blinking off entirely.
- **After effects** — popping letters, a fading pixel trail, and motion smear for a more expressive, retro feel.
- **Appearance controls** — separate colors for dark/light themes, adjustable thickness and opacity, glow, and MORE, MUCH-MUCH MORE.
- **Presets** — save any cursor configuration as a named preset, load or edit it later, and cycle through all your presets with a single command.
- **Preset sharing** — every preset gets a compact share code. Copy it, send it to a friend, and they can paste it straight into their own vault.

## Installation
1. Download `main.js`, `styles.css`, and `manifest.json` (or clone this repo).
2. Create a folder named `cursor-smith` inside your vault's `.obsidian/plugins/` directory.
3. Copy the files into that folder.
4. Reload Obsidian (or restart it), then enable **Cursor-Smith** under **Settings → Community plugins**.

## Usage
Once enabled, the plugin activates automatically. You can:
- Toggle it on/off anytime with the **Toggle custom cursor** command in the Command Palette (`Ctrl/Cmd + P`).
- Cycle through all your saved presets with the **Cycle preset** command — assign it a hotkey in **Settings → Hotkeys** for quick switching.
- Adjust every visual detail from **Settings → Cursor-Smith**.

## Settings
The settings panel is organized into the following sections:

| Section | What it controls |
|---|---|
| **Presets** | Save, load, edit, delete, and share cursor configurations. |
| **Core Configuration** | Enable the plugin and pick a cursor style. |
| **Appearance** | Thickness, colors, glow, opacity, and (Box style only) showing the letter inside the cursor. |
| **Blinking** | Blink speed, the on/off balance of each blink, and hiding the browser's native caret. |
| **Smooth Movement** | Enable gliding motion and tune its speed, catch-up behavior, and typing-adaptive boost. |
| **After Effects** | Popping letters, pixel trail, and motion smear. |
| **Torch** | Spotlight follow mode, size, color, and speed; environment darkness, glow, and flicker. |

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

## Compatibility notes
- Built for CodeMirror 6, the editor used in current versions of Obsidian.
- If you use Vim keybindings, the native block cursor is hidden along with the regular caret.

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
