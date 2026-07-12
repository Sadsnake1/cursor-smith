#  Cursor-Smith

Replace Obsidian's plain text cursor with a custom, animated one. Choose from a solid **Box**, a thin **Line**, an **Underline**, or a full-screen **Torch** spotlight that follows you as you write — each with its own blinking, smoothing, and trail effects.

## Features

- **Four cursor styles** — Box, Line, Underline, and Torch (a dimmed spotlight that follows your cursor or mouse).
- **Smooth movement** — the cursor eases and glides between positions instead of jumping, with adjustable glide, catch-up speed, and an optional adaptive boost while typing fast.
- **Customizable blinking** — control both how fast the cursor blinks and how the on/off time is balanced within each cycle, or turn blinking off entirely.
- **After effects** — popping letters, a fading pixel trail, and motion smear for a more expressive, retro feel.
- **Appearance controls** — separate colors for dark/light themes, adjustable thickness and opacity, glow, and (for the Box style) the option to show the letter under the cursor.
- **Hides the real cursor** — the browser's native caret is hidden so only your custom one is visible.

## Installation

1. Download `main.js`, `styles.css`, and `manifest.json` (or clone this repo).
2. Create a folder named `cursor-smith` inside your vault's `.obsidian/plugins/` directory.
3. Copy the files into that folder.
4. Reload Obsidian (or restart it), then enable **Cursor-Smith** under **Settings → Community plugins**.

## Usage

Once enabled, the plugin activates automatically. You can:

- Toggle it on/off anytime with the **Toggle custom cursor** command (open the Command Palette with `Ctrl/Cmd + P`).
- Adjust every visual detail from **Settings → Cursor-Smith**.

## Settings

The settings panel is organized into the following sections:

| Section | What it controls |
|---|---|
| **Core Configuration** | Enable the plugin and pick a cursor style. |
| **Appearance** | Thickness, colors, glow, opacity, and (Box style only) showing the letter inside the cursor. |
| **Blinking** | Blink speed, the on/off balance of each blink, and hiding the browser's native caret. |
| **Smooth Movement** | Enable gliding motion and tune its speed, catch-up behavior, and typing-adaptive boost. |
| **After Effects** | Popping letters, pixel trail, and motion smear. |
| **Torch** *(Torch style only)* | Spotlight follow mode, size, color, and speed; environment darkness, glow, and flicker; and an ember-styled caret. |

Every setting includes a short description in the panel itself, so you can tune things to taste without leaving Obsidian.

## Compatibility notes

- Built for CodeMirror 6, the editor used in current versions of Obsidian.
- If you use Vim keybindings, the native block cursor is hidden along with the regular caret.

## Feedback

Found a bug or have an idea for a new effect? Open an issue or use the thumbs-down/feedback option in Obsidian to let us know

[![Buy Me a Coffee](https://img.shields.io/badge/Donate-Buy%20Me%20a%20Coffee-yellow?style=for-the-badge&logo=buymeacoffee&logoColor=white)](https://www.buymeacoffee.com/sadsnake1)
