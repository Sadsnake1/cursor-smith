import {
  DEFAULT_SETTINGS,
  LOOK_KEYS,
  VIM_MODE_KEYS,
  migrateLegacyKeys,
  pickLook,
  vimModeSnapshot,
} from "./settings";
import type { Look } from "./types";

// ---------------------------------------------------------------------------
// Preset share-code codec
//
// The recipient already has LOOK_KEYS, in the same order, and DEFAULT_SETTINGS.
// So a share code doesn't need to carry key NAMES or unchanged VALUES at all -
// only the name, plus the fields that actually differ from the defaults, each
// as a position in LOOK_KEYS. That is the whole reason these codes shrank from
// ~2.3k characters to a line or two: the old format spelled out all 77 keys and
// their values as JSON, then base64'd the lot.
//
// Format (version "1"):
//   1|<name>|<i><type><value>~<i><type><value>~...
//   • name is percent-encoded so a "|" or "~" in it can't split the code.
//   • each field is an index into LOOK_KEYS, a one-char type tag, then the value:
//       b0 / b1   boolean            (bracketTether at index 40 off/on)
//       n<num>    number             ("n0.35", "n180")
//       c<hex>    colour, # dropped  ("c39ff14")
//       s<enc>    string, %-encoded  (cursorStyle, overlayFollowMode)
//   • only fields differing from DEFAULT_SETTINGS are emitted; on decode,
//     everything else falls back to the default via presetWithDefaults.
//
// This is the only accepted format. A pre-v1 decoder (raw base64url JSON) used
// to run as a fallback for anything without the "1|" prefix; it has been
// removed. Note this is unrelated to migrateLegacyKeys, which maps renamed
// SETTING KEYS and is still very much load-bearing - a v1 code written before
// a key was renamed still decodes into the old key names and needs it.
// ---------------------------------------------------------------------------
export const SHARE_VERSION = "1";

export function shareEncodeValue(v: string | number | boolean) {
  if (typeof v === "boolean") return "b" + (v ? "1" : "0");
  if (typeof v === "number") return "n" + shareNum(v);
  if (typeof v === "string") {
    // A colour is "#" followed by 3/6 hex digits; store it tag-free without the
    // "#" since that's the common case and by far the bulkiest.
    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) return "c" + v.slice(1);
    return "s" + encodeURIComponent(v);
  }
  // Anything exotic (shouldn't occur for look keys) round-trips as JSON.
  return "j" + encodeURIComponent(JSON.stringify(v));
}

// Trim a number to its shortest exact decimal string: integers lose the ".0",
// and float noise like 0.35000000000000003 is rounded to a sane precision
// before being stringified so it doesn't bloat the code.
export function shareNum(n: number) {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

export function shareDecodeValue(tag: string, raw: string) {
  switch (tag) {
    case "b": return raw === "1";
    case "n": return Number(raw);
    case "c": return "#" + raw;
    case "s": return decodeURIComponent(raw);
    case "j": try { return JSON.parse(decodeURIComponent(raw)) as unknown; } catch { return undefined; /* a malformed field is dropped, not fatal */ }
    default:  return undefined;
  }
}

// One look snapshot's worth of fields: every LOOK_KEY that differs from the
// defaults, as "<index><tag><value>", joined by "~". Split out of
// presetToCode so the Vim format below can reuse it per mode rather than
// reimplementing the delta rules and drifting from them.
export function shareFields(look: Partial<Look>, defaults: Partial<Look>) {
  const fields = [];
  for (let i = 0; i < LOOK_KEYS.length; i++) {
    const k = LOOK_KEYS[i];
    if (!(k in look)) continue;
    const v = look[k];
    if (v === undefined) continue;
    // Skip anything equal to the default - the recipient fills it back in.
    // Numbers compared loosely so 0.5 and "0.5" (from an old code round-trip)
    // don't both get emitted; everything else by strict identity.
    if (v === defaults[k]) continue;
    if (typeof v === "number" && typeof defaults[k] === "number" &&
        shareNum(v) === shareNum(defaults[k])) continue;
    fields.push(i + shareEncodeValue(v));
  }
  return fields.join("~");
}

// Inverse of shareFields. Always returns an object, never null: an empty body
// legitimately means "identical to the defaults", which is not the same thing
// as a body being absent (see codeToVimPreset).
export function shareParseFields(body: string) {
  const snap: Partial<Look> = {};
  if (!body) return snap;
  for (const field of body.split("~")) {
    if (!field) continue;
    // Leading digits are the LOOK_KEYS index; the next char is the type tag.
    const m = /^(\d+)(.)([\s\S]*)$/.exec(field);
    if (!m) continue;
    const key = LOOK_KEYS[Number(m[1])];
    if (!key) continue; // index from a newer version we don't know: skip it
    const val = shareDecodeValue(m[2], m[3]);
    if (val !== undefined) (snap as unknown as Record<string, unknown>)[key] = val;
  }
  return snap;
}

export function presetToCode(name: string, snap: Partial<Look>) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  const body = shareFields(pickLook(snap), defaults);
  return [SHARE_VERSION, encodeURIComponent(name || ""), body].join("|");
}

export function codeToPreset(code: string) {
  const trimmed = (code || "").trim();
  // Anything that isn't the versioned format is rejected outright. That
  // includes a Vim code ("2|..."), which is five look snapshots and has no
  // meaning as a single cursor look - the import button reads the prefix
  // itself and says so, rather than leaving the user with a flat "invalid".
  if (trimmed.slice(0, 2) !== SHARE_VERSION + "|") return null;
  try {
    const parts = trimmed.split("|");
    // parts[0] is the version, already matched. Extra "|" only appears if the
    // name field held a literal one, which encodeURIComponent prevents - so a
    // fixed 3-way split is safe.
    const name = decodeURIComponent(parts[1] || "") || "Imported preset";
    return { name, snap: shareParseFields(parts.slice(2).join("|")) };
  } catch {
    // A malformed code (bad percent-encoding, a broken JSON field) is "not a
    // code"; the importer shows "Invalid code".
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vim share codes.
//
// A Vim preset is FIVE look snapshots, one per mode, so it cannot go through
// presetToCode: that encodes the LOOK_KEYS found at the top level of the
// object it's handed, and the top level of a Vim preset holds mode names, not
// look keys. Handing one over produced a code with an empty body - every Vim
// preset encoded to "1|<name>|", carrying nothing but its name, and importing
// one silently rebuilt the built-in starter looks (cloneVimModes falls back to
// VIM_MODE_STARTERS for any mode the snapshot doesn't describe, and it didn't
// describe any of them). That's what this format exists to fix.
//
// Layout: version "2", the name, then one field-body per mode in
// VIM_MODE_KEYS order, all "|"-separated:
//
//   2|<name>|<normal>|<insert>|<visual>|<replace>|<command>
//
// Each body is exactly what shareFields emits for a regular preset, so a mode
// costs nothing for every key it leaves at the default. "|" is safe as the
// separator because the name is %-encoded and a field body only ever contains
// digits, a tag char, "~", and %-encoded values.
//
// An EMPTY body and a MISSING one mean different things, deliberately: empty
// says "this mode is exactly the defaults", missing (a shorter code, e.g. one
// written before a mode existed) leaves that mode to fall back to its starter
// look. Conflating the two is how a mode that was deliberately left at the
// defaults would come back wearing the starter's colours.
// ---------------------------------------------------------------------------
export const SHARE_VERSION_VIM = "2";

export function vimPresetToCode(name: string, modes: Record<string, Partial<Look>> | null) {
  const defaults = pickLook(DEFAULT_SETTINGS);
  // Expand through vimModeSnapshot first so a partial or hand-edited preset
  // encodes what it would actually LOAD as, rather than emitting a mode's
  // absence and leaving the recipient to resolve it differently.
  const bodies = VIM_MODE_KEYS.map((m) =>
    shareFields(pickLook(vimModeSnapshot(m, modes && modes[m])), defaults));
  return [SHARE_VERSION_VIM, encodeURIComponent(name || ""), ...bodies].join("|");
}

// Returns { name, modes } - modes being a sparse map of mode key to look
// overrides, ready for cloneVimModes - or null if this isn't a Vim code.
export function codeToVimPreset(code: string) {
  const trimmed = (code || "").trim();
  if (trimmed.slice(0, 2) !== SHARE_VERSION_VIM + "|") return null;
  try {
    const parts = trimmed.split("|");
    const name = decodeURIComponent(parts[1] || "") || "Imported Vim preset";
    const modes: Record<string, Partial<Look>> = {};
    VIM_MODE_KEYS.forEach((m, i) => {
      const body = parts[2 + i];
      if (body === undefined) return; // absent: let the starter fill it in
      modes[m] = migrateLegacyKeys(shareParseFields(body));
    });
    return { name, modes };
  } catch {
    // Same as codeToPreset: malformed means "not a Vim code".
    return null;
  }
}
