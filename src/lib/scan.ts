import { CODE128_PATTERNS } from "./code128";

// Code 128 decoder for camera frames, used where the browser has no built-in
// BarcodeDetector (for example iPhone Safari). It reads one horizontal line
// of pixels at a time, so the label should be held roughly level.

const PATTERN_VALUES = new Map(CODE128_PATTERNS.slice(0, 106).map((pattern, value) => [pattern, value]));
const START_A = 103, START_B = 104, START_C = 105, STOP = 106;

/** Light/dark runs along a line of brightness values (0 = black, 255 = white). */
export function runsOf(row: ArrayLike<number>): { dark: boolean; width: number }[] {
  let min = 255, max = 0;
  for (let i = 0; i < row.length; i += 1) { if (row[i] < min) min = row[i]; if (row[i] > max) max = row[i]; }
  if (max - min < 40) return [];
  const threshold = (min + max) / 2;
  const runs: { dark: boolean; width: number }[] = [];
  for (let i = 0; i < row.length; i += 1) {
    const dark = row[i] < threshold;
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) last.width += 1; else runs.push({ dark, width: 1 });
  }
  return runs;
}

/** Widths of 6 runs → their module counts as a pattern string like "212222", or null if they do not add up. */
function pattern(widths: number[], modules: number): string | null {
  const total = widths.reduce((a, b) => a + b, 0);
  const unit = total / modules;
  const counts = widths.map((w) => Math.max(1, Math.min(4, Math.round(w / unit))));
  if (counts.reduce((a, b) => a + b, 0) !== modules) {
    // Nudge the run that is furthest from a whole module so the symbol sums correctly.
    const errors = widths.map((w, i) => w / unit - counts[i]);
    const diff = modules - counts.reduce((a, b) => a + b, 0);
    if (Math.abs(diff) !== 1) return null;
    let best = -1;
    for (let i = 0; i < counts.length; i += 1) {
      const next = counts[i] + diff;
      if (next < 1 || next > 4) continue;
      if (best < 0 || errors[i] * diff > errors[best] * diff) best = i;
    }
    if (best < 0) return null;
    counts[best] += diff;
  }
  return counts.join("");
}

function decodeValues(values: number[]): string | null {
  if (values.length < 3) return null;
  const checksum = values[values.length - 1];
  const sum = values.slice(0, -1).reduce((acc, value, index) => acc + (index === 0 ? value : value * index), 0);
  if (sum % 103 !== checksum) return null;
  let set = values[0] === START_A ? "A" : values[0] === START_C ? "C" : "B";
  let out = "";
  let shift = false;
  for (const value of values.slice(1, -1)) {
    const current = shift ? (set === "A" ? "B" : "A") : set;
    shift = false;
    if (current === "C") {
      if (value < 100) { out += String(value).padStart(2, "0"); continue; }
      if (value === 100) set = "B"; else if (value === 101) set = "A";
      continue;
    }
    if (value === 99) { set = "C"; continue; }
    if (value === 98) { shift = true; continue; }
    if (value === 100 && current === "A") { set = "B"; continue; }
    if (value === 101 && current === "B") { set = "A"; continue; }
    if (value >= 96) continue; // function codes
    out += current === "B" ? String.fromCharCode(value + 32) : value < 64 ? String.fromCharCode(value + 32) : String.fromCharCode(value - 64);
  }
  return out || null;
}

function decodeRuns(runs: { dark: boolean; width: number }[]): string | null {
  for (let start = 0; start + 6 < runs.length; start += 1) {
    if (!runs[start].dark) continue;
    const first = pattern(runs.slice(start, start + 6).map((r) => r.width), 11);
    if (!first) continue;
    const startValue = PATTERN_VALUES.get(first);
    if (startValue !== START_A && startValue !== START_B && startValue !== START_C) continue;
    // The quiet zone before the start must be wide (at least ~5 modules).
    const unit = runs.slice(start, start + 6).reduce((a, r) => a + r.width, 0) / 11;
    if (start > 0 && runs[start - 1].width < unit * 4) continue;
    const values = [startValue];
    let i = start + 6;
    while (i + 6 <= runs.length) {
      const widths = runs.slice(i, i + 6).map((r) => r.width);
      // Stop pattern 2331112: its first six runs (11 modules) read as "233111", which no data symbol uses.
      if (i + 7 <= runs.length && pattern(widths, 11) === "233111") {
        const text = decodeValues(values);
        if (text) return text;
        break;
      }
      const symbol = pattern(widths, 11);
      const value = symbol ? PATTERN_VALUES.get(symbol) : undefined;
      if (value === undefined) break;
      values.push(value);
      i += 6;
    }
  }
  return null;
}

/** Stretches a line 4× with linear interpolation, so bar edges fall between pixels instead of on them. */
function upsample(row: ArrayLike<number>): Float32Array {
  const out = new Float32Array(row.length * 4);
  for (let i = 0; i < out.length; i += 1) {
    const x = i / 4;
    const left = Math.floor(x);
    const right = Math.min(row.length - 1, left + 1);
    out[i] = row[left] + (row[right] - row[left]) * (x - left);
  }
  return out;
}

/** Tries a line of pixels in both directions (the label may be upside down). */
export function decodeCode128Row(row: ArrayLike<number>): string | null {
  const runs = runsOf(upsample(row));
  if (runs.length < 25) return null;
  return decodeRuns(runs) ?? decodeRuns([...runs].reverse());
}

/** Tries several lines across an RGBA image (as from canvas getImageData). */
export function decodeCode128Image(data: Uint8ClampedArray, width: number, height: number): string | null {
  const row = new Uint8Array(width);
  for (let step = 0; step < 15; step += 1) {
    // From the middle outwards.
    const y = Math.round(height / 2 + ((step % 2 ? 1 : -1) * Math.ceil(step / 2) * height) / 32);
    if (y < 0 || y >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      row[x] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    const text = decodeCode128Row(row);
    if (text) return text;
  }
  return null;
}
