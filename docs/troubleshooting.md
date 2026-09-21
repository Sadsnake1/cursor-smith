# If something looks wrong

[← Back to the README](../README.md)

**Start here: your installer version.** Settings → General shows two numbers, the app version and the installer version. Obsidian updates the app in place but never the installer, and an old installer is an old Electron. Most reports of the plugin not loading, lagging or freezing were fixed by uninstalling Obsidian and reinstalling from [obsidian.md](https://obsidian.md). Your vault is untouched by that.

**"No appropriate version found" when installing.** That message is Obsidian's. Word-Smith needs Obsidian 1.13.7 or newer (the app version, the first of the two numbers). Update Obsidian and install again.

**"Word-Smith did not start: your Obsidian installer is…"** The plugin refuses to start in installers before 1.9, because Obsidian froze on enable in every one reported. It is built and tested on the 1.13.7 installer. The fix is the paragraph above.

**"The last start did not finish, so everything is off this time."** The plugin marks the moment it starts and clears the mark two seconds after its first paint. If the mark is still there next time, the previous start never got that far, so it comes up with everything off rather than freeze again. Settings → Word-Smith has a **Try again** button. Closing Obsidian within two seconds of opening it trips this too, once.

**"styles.css is out of date."** `main.js` was updated and `styles.css` wasn't. A stale stylesheet looks like a broken feature. Copy all three files (`main.js`, `styles.css`, `manifest.json`) and reload.

**A row prints `{sometoken}` instead of a number.** That token doesn't exist. Unknown tokens stay visible on purpose, so a typo shows itself.

**A segment vanished.** A segment whose tokens all come to nothing is dropped, dividers and all. `{vim}` outside Vim mode, `{caps}` with caps lock off.

**A theme changed nothing.** Check the master switch at the top of the Themes page. Off, a scheme is remembered but never painted.

**A community theme still shows through.** Word-Smith writes Obsidian's own variables, so anything a theme paints with a hard-coded color stays its own. Open an issue with the theme's name.

**The custom file-tree order didn't apply.** Make sure the file explorer is open in the sidebar. Obsidian doesn't build a hidden panel until it's shown. Toggling the switch under **File tree** re-applies it.

**The Organizer feels slow.** Under **Settings → Word-Smith → Manuscript → File tree**, switch off word counts, flags, tasks and goal percentage, then reopen it. If that fixes it, open an issue and say so, with your OS and Obsidian version.

**Keys that won't work, a red flash.** That's Hemingway mode doing its job. Turn it off from the menu, the bar's Modes button, or the Focus page.

**You want Obsidian's status bar back.** The Powerline page, switch it off. While one of Word-Smith's own panes is the active view, Obsidian's status bar shows there anyway.

**Undo did nothing in the Organizer.** Undo and Redo listen while the Organizer pane has the focus and no text field does. Click a row first, or use the two buttons beside Collapse all.

Still stuck? [Open an issue](https://github.com/Sadsnake1/word-smith/issues) with your OS, Obsidian version, installer version, and the console (`Ctrl+Shift+I`) at the moment it went wrong. Disabling other plugins one at a time is the fastest way to find a clash.
