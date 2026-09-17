// Just enough of the Obsidian API for the plugin to load outside Obsidian.
// `Setting` is a mutable binding so the panel tests can swap in a recording
// stub and put the real one back (renderLookSettings closes over it).
export class Plugin { constructor(..._args: any[]) {} }
export class View { constructor(..._args: any[]) {} }
export class PluginSettingTab { updates?: number; constructor(..._args: any[]) {} update() { this.updates = (this.updates || 0) + 1; } }
export let Setting: any = class {
  constructor(..._args: any[]) {}
  setName() { return this; }
  setDesc() { return this; }
  addToggle() { return this; }
  addSlider() { return this; }
};
const RealSetting = Setting;
export class Notice {
  static messages: any[] = [];
  constructor(message: any) { Notice.messages.push(message); }
}
export function setSettingClass(C: any) { Setting = C; }
export function restoreSettingClass() { Setting = RealSetting; }
