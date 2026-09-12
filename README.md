<div align="center">

  <a href="https://github.com/Sadsnake1/cursor-smith/stargazers"><img src="https://img.shields.io/github/stars/Sadsnake1/cursor-smith?style=flat-square&logo=github&logoColor=white&labelColor=1a1a1a&color=F5B301" alt="Stars"></a>
  <a href="https://github.com/Sadsnake1/cursor-smith/releases"><img src="https://img.shields.io/github/downloads/Sadsnake1/cursor-smith/total?style=flat-square&logo=github&logoColor=white&labelColor=1a1a1a&color=10B981" alt="Downloads"></a>
  <a href="https://github.com/Sadsnake1/cursor-smith/releases/latest"><img src="https://img.shields.io/github/v/release/Sadsnake1/cursor-smith?style=flat-square&logo=obsidian&logoColor=white&labelColor=1a1a1a&color=8B5CF6" alt="Version"></a>
  <a href="https://github.com/Sadsnake1/cursor-smith/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Sadsnake1/cursor-smith?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=1a1a1a&color=3B82F6" alt="License"></a>
  <a href="https://www.buymeacoffee.com/sadsnake1" target="_blank"><img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000000&labelColor=FFDD00" alt="Buy Me a Coffee"></a>

  <h1>Cursor-Smith</h1>

  <p><strong>Forge your own cursor!</strong><br>
  The most advanced cursor engine for Obsidian (maybe).</p>

</div>

Most people never give their cursor a second thought. Cursor-Smith is for the ones who do: writers who want a screen worth staring at, anyone who keeps losing the caret and needs it bigger and brighter, and people who just like to customize theengs.

Every effect has its own switch, reduced motion is respected out of the box, and it's free.





https://github.com/user-attachments/assets/30b013b3-d4f4-4ed7-8f34-b20b3525e12b

https://github.com/user-attachments/assets/49eb7297-97c8-4c0e-a255-bc8cff9c4bc7

## What do you get?

### The cursor itself

**Box, Line or Underline**, each with its own shape controls: serifs, hollow, outline width, the letter inside the block. **Smooth movement** so it glides between positions instead of jumping, with an adaptive boost when you're typing fast. **Blinking** you actually control: speed, on/off balance, fade, a don't-blink-while-typing mode, or a breathing cursor that swells and shrinks. Or no blink at all.

Separate colors for dark and light, multi-stop gradients, thickness, opacity, glow, translucency. And more. Much, much more.

### The effects

A dozen of them, from subtle to absurd.

| Effect | What it does |
|---|---|
| **Pop Effects** | Popping letters, backspace disintegration, thunderstrike on Enter, fireworks on Space. Rainbow sweeps them all around the color wheel together. |
| **Pixel Trail** | A fading trail of pixels behind the cursor, with lifetime, size, gravity and jump-streak controls. |
| **Stardust** | Floating motes, drifting upward or orbiting the cursor like fireflies. |
| **Bracket Tether** | Underlines the span between matching brackets or quotes. Nice for dialogue. |
| **Motion Smear** | The corners lag on springs, stretching as it moves and snapping back when it arrives. Optional comet tail. |
| **Energy Beam** | Bands of light sliding or rippling through the cursor body, with an aurora mode. |
| **CRT Effect** | Old-monitor phosphor ghosts, neon-tube and gradient variants, Signal Glitch on long jumps. |
| **Speed Demon** | Heats from grey to white-hot as you type, throwing sparks. Bring your own heat gradient. |
| **Hot-head** | Sets the text on fire. The fire spreads, lingers, and burns out when you stop. |
| **Torch Spotlight** | Darkens the page except for a pool of warm light around the cursor, with a candle flicker. |

Some effects unlock extra options when combined. Try Blinking with Torch and see what appears.

### Torch Spotlight

Two layers: a darkness that dims everything outside the pool, and a warm glow that adds light inside it. **Glow Strength** controls the warm core, and at 0 you get a pure colorless spotlight. **Flicker** makes it gutter like a candle. The light follows the caret, the mouse, or whichever moved last, and can pulse with your blink. On desktop, **Keep Sidebars Lit** leaves the sidebars, tabs and ribbon at normal brightness.

### Presets and sharing

Dial in a cursor, name it, save it. Load it, edit it, cycle through all of them with one command or a hotkey. Every preset gets a compact share code: copy it, send it to a friend, they paste it into **Import preset** and they've got your cursor.

Six ship with the plugin so you've got something to start from:

| Preset | Style | Vibe |
|---|---|---|
| **Jell-O** | Box | Smooth smear and glide with a mint-green glow |
| **Torch-Crt** | Line | Warm amber line with CRT trail and torch spotlight |
| **mr.Blue** | Line | Clean blinking blue line with smooth movement |
| **FairyDust** | Underline | Pale yellow underline with pixel trail and energy beam |
| **DarkMatter** | Box | Blue-purple box with CRT trail and Speed Demon sparks |
| **old_Joe** | Box | Understated grey box, no frills |

### Vim mode

Five modes, five cursors. Normal, Insert, Visual, Replace and Command each get their own style, color, blink and effects, fully independent. A `-- NORMAL --` indicator sits in the status bar, Vim-style, tinted to match. Vim presets save the whole five-mode setup under one name and share with one code. Turn on **Control Obsidian's Vim key bindings** and switching modes flips Obsidian's native Vim setting for you.

| Mode | When it applies |
|---|---|
| **Normal** | The default editing mode |
| **Insert** | After `i`, `a`, `o` and friends |
| **Visual** | After `v`, `V`, or `Ctrl-v` |
| **Replace** | After `R` |
| **Command** | The `:` / `/` prompt, plus the Command Palette, Quick Switcher, search boxes and other fields |

## Accessibility

Cursor-Smith is animation-heavy by design, so it takes reduced motion seriously. **Respect Reduced Motion** is on by default: when your system asks for it, every moving effect switches itself off and your cursor keeps its style, color, size and glow. Blinking is left alone, since it's the standard caret behaviour and well under flash thresholds, but it has its own switch.

For anyone who loses the caret: thickness, glow, high-contrast colors and a bigger box are all here, and they work with every effect off.

## Install

**Settings → Community plugins → Browse**, search **Cursor-Smith**, install, enable.

It activates as soon as it's on. Two commands worth a hotkey: **Toggle Cursor-Smith on/off** and **Cycle preset**.

## Settings

Collapsible sections, and the panel remembers which ones you closed and where you'd scrolled.

| Section | What it controls |
|---|---|
| **Core Configuration** | Enable, hide the real cursor, hide when Obsidian isn't focused, respect reduced motion |
| **Presets** | Save, load, edit, delete, share |
| **Appearance** | Style, thickness, colors and gradients, glow, opacity, translucency, letter-in-block |
| **Blinking** | Speed, balance, fade, delay, breathing |
| **Smooth Movement** | Glide, catch-up, delay, typing-adaptive boost |
| **Effects** | Everything the cursor does beyond sitting there |

## It pairs with Word-Smith

[Word-Smith](https://github.com/Sadsnake1/word-smith) is my other plugin, a writing suite for Obsidian. Its themes can colour your caret per Vim mode, and its status bar can wear the same colour back.

## Forged elsewhere

Cursor-Smith is MIT, and people have carried the engine to other editors. If you've ported it somewhere, open an issue and I'll add it here.

| Editor | Port | By |
|---|---|---|
| **Thymer** | [Cursor Tweaks](https://github.com/akaready/thymer-cursor-tweaks) | [akaready](https://github.com/akaready) |


## Questions, ideas, bugs

Found a bug, or have an idea for a new effect? [Write it here](https://github.com/Sadsnake1/cursor-smith/issues). I fix things fast, and most of the effects started as somebody's comment.

Free and MIT. If it's earned a coffee, thank you. Cheers!

<div align="center">
  <a href="https://www.buymeacoffee.com/sadsnake1" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="200">
  </a>
</div>
