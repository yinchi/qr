/**
 * The eight data mask patterns (ISO/IEC 18004, Table 10), indexed by their 3-bit reference. A module in row i and
 * column j of the encoding region is flipped where the condition holds.
 */
export const MASK_CONDITIONS: readonly ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

/** The same conditions in LaTeX, as written in Table 10 (with "div" shown as rounding down). */
export const MASK_FORMULAS: readonly string[] = [
  '(i + j) \\bmod 2 = 0',
  'i \\bmod 2 = 0',
  'j \\bmod 3 = 0',
  '(i + j) \\bmod 3 = 0',
  '(\\lfloor i / 2 \\rfloor + \\lfloor j / 3 \\rfloor) \\bmod 2 = 0',
  '(ij \\bmod 2) + (ij \\bmod 3) = 0',
  '\\big((ij \\bmod 2) + (ij \\bmod 3)\\big) \\bmod 2 = 0',
  '\\big(((i + j) \\bmod 2) + (ij \\bmod 3)\\big) \\bmod 2 = 0',
];
