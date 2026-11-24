import type { EcLevel } from './ec';
import { formatInfoBits } from './format';
import { fixedLayout, formatInfoPositions, type FixedLayout, type Position, type Role } from './layout';
import { MASK_CONDITIONS } from './masks';
import { buildBitstream, detectMode, smallestVersionFor, type Mode } from './modes';
import { penalty, type Penalty } from './penalty';
import { encodeBlocks, interleave, type Block } from './rs';

/**
 * The data modules in the order the bits fill them (7.7.3): two-module columns from the bottom right, going up and down
 * in turn, the right module before the left, skipping every module that isn't data. The vertical timing pattern in
 * column 6 is skipped whole, so the columns to its left pair up as 5–4, 3–2 and 1–0 (Figures 19 and 20).
 */
export function dataPath(layout: FixedLayout): Position[] {
  const { size, roles } = layout;
  const path: Position[] = [];
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upwards ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (roles[row * size + col] === 'data') path.push([row, col]);
      }
    }
    upwards = !upwards;
  }
  return path;
}

/** A QR code's modules, row by row. */
export interface QrSymbol {
  version: number;
  size: number;
  roles: Role[];
  dark: boolean[];
}

/**
 * The code before masking: the fixed parts, then the codewords' bits along the data path, most significant bit first,
 * then remainder bits of 0 in any modules left over. The format information is left light.
 */
export function placeCodewords(version: number, codewords: readonly number[]): QrSymbol {
  const layout = fixedLayout(version);
  const dark = [...layout.dark];
  dataPath(layout).forEach(([row, col], k) => {
    const byte = codewords[k >> 3] ?? 0;
    dark[row * layout.size + col] = ((byte >> (7 - (k & 7))) & 1) === 1;
  });
  return { version, size: layout.size, roles: layout.roles, dark };
}

/** Flip the data modules where the mask pattern is dark (7.8.2), and fill in the format information for it (7.9). */
export function applyMask(symbol: QrSymbol, level: EcLevel, mask: number): QrSymbol {
  const { size, roles } = symbol;
  const condition = MASK_CONDITIONS[mask];
  const dark = symbol.dark.map((d, k) => (roles[k] === 'data' && condition(Math.floor(k / size), k % size) ? !d : d));
  const bits = formatInfoBits(level, mask);
  const { first, second } = formatInfoPositions(symbol.version);
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    for (const [row, col] of [first[i], second[i]]) dark[row * size + col] = bit;
  }
  return { ...symbol, dark };
}

/** Each mask's penalty (7.8.3), and the mask with the lowest total, the first of them if several tie. */
export function chooseMask(unmasked: QrSymbol, level: EcLevel): { mask: number; penalties: Penalty[] } {
  const penalties = MASK_CONDITIONS.map((_, mask) => penalty(applyMask(unmasked, level, mask).dark, unmasked.size));
  const totals = penalties.map((p) => p.points.total);
  return { mask: totals.indexOf(Math.min(...totals)), penalties };
}

/** Everything that goes into a QR code for some text, at the smallest version that holds it. */
export interface EncodedText {
  text: string;
  mode: Mode;
  version: number;
  level: EcLevel;
  /** The data codewords, from the bitstream of chapter 3. */
  data: number[];
  blocks: Block[];
  /** The final sequence of codewords, interleaved (7.6). */
  codewords: number[];
}

/** Encode `text` in one segment of its mode at the smallest version that holds it, or null if none does. */
export function encodeText(text: string, level: EcLevel): EncodedText | null {
  const mode = detectMode(text);
  const version = smallestVersionFor(mode, text, level);
  if (version === null) return null;
  const data = buildBitstream(mode, text, version, level).codewords;
  const blocks = encodeBlocks(data, version, level);
  return { text, mode, version, level, data, blocks, codewords: interleave(blocks) };
}
