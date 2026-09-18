// Just enough of the Obsidian API for the plugin to load outside Obsidian.
// `Setting` is a mutable binding so the panel tests can swap in a recording
// stub and put the real one back (renderLookSettings closes over it).
export class Plugin { constructor(..._args: any[]) {} }
export class View { constructor(..._args: any[]) {} }
export class PluginSettingTab { updates?: number; refreshes?: number; constructor(..._args: any[]) {} update() { this.updates = (this.updates || 0) + 1; } refreshDomState() { this.refreshes = (this.refreshes || 0) + 1; } }
export let Setting: any = class {
  constructor(..._args: any[]) {}
  setName() { return this; }
  setDesc() { return this; }
  addToggle() { return this; }
  addSlider() { return this; }
};
const RealSetting = Setting;
// Icons are SVGs Obsidian inlines; here the name is recorded on the element.
export function setIcon(el: any, icon: string) { if (el) el.icon = icon; }
export const addedIcons: Record<string, string> = {};
export function addIcon(id: string, svg: string) { addedIcons[id] = svg; }
// Just enough Modal for the preset prompt to construct: elements from the
// harness's createEl global, open/close recorded.
export class Modal {
  app: any; titleEl: any; contentEl: any; opened = false; title = "";
  constructor(app: any) { this.app = app; this.titleEl = (globalThis as any).createDiv ? (globalThis as any).createDiv() : {}; this.contentEl = (globalThis as any).createDiv ? (globalThis as any).createDiv() : {}; }
  setTitle(t: string) { this.title = t; return this; }
  open() { this.opened = true; (Modal as any).last = this; this.onOpen(); }
  close() { this.opened = false; this.onClose(); }
  onOpen() {}
  onClose() {}
}
export class Notice {
  static messages: any[] = [];
  constructor(message: any) { Notice.messages.push(message); }
}
export function setSettingClass(C: any) { Setting = C; }
export function restoreSettingClass() { Setting = RealSetting; }
