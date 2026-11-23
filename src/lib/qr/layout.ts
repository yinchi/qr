import { versionInfoBits } from './version-info';

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;
/** Width of the light margin required around the symbol, in modules. */
export const QUIET_ZONE = 4;

/** What a module is used for. Everything that isn't data is fixed by the version alone, except the format information. */
export type Role =
  | 'finder'
  | 'separator'
  | 'timing'
  | 'alignment'
  | 'darkModule'
  | 'format'
  | 'version'
  | 'data';

export function symbolSize(version: number): number {
  return 4 * version + 17;
}

/**
 * Row/column coordinates of the alignment pattern centres for versions 1–40
 * (ISO/IEC 18004, Annex E, Table E.1). The same list is used for rows and for columns.
 */
const ALIGNMENT_COORDINATES: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

function checkVersion(version: number): void {
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`QR version must be an integer from ${MIN_VERSION} to ${MAX_VERSION}, got ${version}`);
  }
}

/**
 * Modules in the data area, without building the grid: the whole symbol minus the finder patterns and separators,
 * timing patterns, alignment patterns (less the timing modules they cover), format information, dark module and
 * version information. Equals Table 1's "data modules except (C)".
 */
export function dataModules(version: number): number {
  checkVersion(version);
  const size = symbolSize(version);
  const n = alignmentCoordinates(version).length;
  const alignment = n === 0 ? 0 : n * n - 3;
  // Alignment patterns on row 6 or column 6 each cover 5 timing modules, which shouldn't be subtracted twice.
  const onTiming = n === 0 ? 0 : 2 * (n - 2);
  const timing = 2 * (size - 16) - 5 * onTiming;
  const versionInfo = version >= 7 ? 36 : 0;
  return size * size - 3 * 64 - timing - 25 * alignment - 31 - versionInfo;
}

export function alignmentCoordinates(version: number): readonly number[] {
  checkVersion(version);
  return ALIGNMENT_COORDINATES[version - 1];
}

/** Centres of the alignment patterns: every pair of coordinates, except the three corners taken by finder patterns. */
export function alignmentCentres(version: number): [row: number, col: number][] {
  const coords = alignmentCoordinates(version);
  const first = coords[0];
  const last = coords[coords.length - 1];
  const centres: [number, number][] = [];
  for (const row of coords) {
    for (const col of coords) {
      const overlapsFinder =
        (row === first && col === first) || (row === first && col === last) || (row === last && col === first);
      if (!overlapsFinder) centres.push([row, col]);
    }
  }
  return centres;
}

/**
 * The modules of a symbol that don't depend on the data: everything except the
 * data area. Format information modules are reserved but left light, because
 * their values depend on the error correction level and mask.
 *
 * This is wider than the standard's "function patterns" (finder, separator,
 * timing and alignment patterns): it also includes the format and version
 * information and the dark module, which the standard counts as part of the
 * encoding region.
 */
export interface FixedLayout {
  version: number;
  size: number;
  /** Role of each module, row by row. */
  roles: Role[];
  /** Whether each module is dark, row by row. Always false for format and data modules. */
  dark: boolean[];
  alignmentCentres: [row: number, col: number][];
  /** The 18-bit version information, or null below version 7. */
  versionInfo: number | null;
}

export function fixedLayout(version: number): FixedLayout {
  checkVersion(version);
  const size = symbolSize(version);
  const roles: Role[] = new Array(size * size).fill('data');
  const dark: boolean[] = new Array(size * size).fill(false);
  const set = (row: number, col: number, role: Role, isDark: boolean) => {
    roles[row * size + col] = role;
    dark[row * size + col] = isDark;
  };

  // Finder patterns in three corners, each with a light separator on the sides facing into the symbol.
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          set(row, col, 'separator', false);
        } else {
          // Rings: dark 7×7 border, light 5×5 border, dark 3×3 centre.
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          set(row, col, 'finder', ring !== 2);
        }
      }
    }
  }

  // Timing patterns in row 6 and column 6, between the separators, dark on even coordinates.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, 'timing', i % 2 === 0);
    set(i, 6, 'timing', i % 2 === 0);
  }

  // Alignment patterns. Some lie on a timing pattern and agree with it, since their centres are on even coordinates.
  const centres = alignmentCentres(version);
  for (const [row, col] of centres) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        set(row + r, col + c, 'alignment', Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }
  }

  // Version information (version 7 and up), in two blocks.
  let versionInfo: number | null = null;
  if (version >= 7) {
    versionInfo = versionInfoBits(version);
    const { topRight, bottomLeft } = versionInfoPositions(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((versionInfo >> i) & 1) === 1;
      set(...topRight[i], 'version', bit);
      set(...bottomLeft[i], 'version', bit);
    }
  }

  // Format information: reserved here, since its bits depend on the error correction level and mask.
  const { first, second } = formatInfoPositions(version);
  for (let i = 0; i < 15; i++) {
    set(...first[i], 'format', false);
    set(...second[i], 'format', false);
  }

  // The dark module, always dark, just above the second copy of the format information.
  set(size - 8, 8, 'darkModule', true);

  return { version, size, roles, dark, alignmentCentres: centres, versionInfo };
}

type Position = [row: number, col: number];

/**
 * Where each of the 15 format information bits goes, for both copies, indexed by bit number (0 is the least
 * significant, the last bit of the string). ISO/IEC 18004, Figure 25.
 */
export function formatInfoPositions(version: number): { first: Position[]; second: Position[] } {
  const size = symbolSize(version);
  const first: Position[] = [];
  const second: Position[] = [];
  for (let i = 0; i < 15; i++) {
    // Around the top-left finder: down column 8 (bits 0–7, stepping over the timing pattern in row 6), then leftwards
    // along row 8 (bits 8–14, stepping over the timing pattern in column 6).
    first.push(i <= 5 ? [i, 8] : i === 6 ? [7, 8] : i === 7 ? [8, 8] : i === 8 ? [8, 7] : [8, 14 - i]);
    // Leftwards along row 8 from the right edge (bits 0–7), then down column 8 to the bottom edge (bits 8–14).
    second.push(i < 8 ? [8, size - 1 - i] : [size - 15 + i, 8]);
  }
  return { first, second };
}

/**
 * Where each of the 18 version information bits goes, in both blocks, indexed by bit number (0 is the least
 * significant). Figure 28: the top-right block fills row by row, three bits to a row; the bottom-left block is its
 * mirror image across the diagonal, filling column by column. Empty below version 7.
 */
export function versionInfoPositions(version: number): { topRight: Position[]; bottomLeft: Position[] } {
  if (version < 7) return { topRight: [], bottomLeft: [] };
  const size = symbolSize(version);
  const topRight: Position[] = [];
  const bottomLeft: Position[] = [];
  for (let i = 0; i < 18; i++) {
    topRight.push([Math.floor(i / 3), size - 11 + (i % 3)]);
    bottomLeft.push([size - 11 + (i % 3), Math.floor(i / 3)]);
  }
  return { topRight, bottomLeft };
}

/** How many modules of each role a layout has. */
export function countRoles(layout: FixedLayout): Record<Role, number> {
  const counts: Record<Role, number> = {
    finder: 0,
    separator: 0,
    timing: 0,
    alignment: 0,
    darkModule: 0,
    format: 0,
    version: 0,
    data: 0,
  };
  for (const role of layout.roles) counts[role]++;
  return counts;
}
