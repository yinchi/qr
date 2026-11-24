import { createRequire } from 'node:module';
import QRCode, { type QRCodeErrorCorrectionLevel, type QRCodeMaskPattern, type QRCodeSegment } from 'qrcode';
import { describe, expect, it } from 'vitest';
import { EC_LEVELS, totalCodewords, type EcLevel } from './ec';
import { dataModules, fixedLayout, MAX_VERSION, MIN_VERSION } from './layout';
import { penalty } from './penalty';
import { applyMask, chooseMask, dataPath, encodeText, placeCodewords, type QrSymbol } from './symbol';

const require = createRequire(import.meta.url);
const BitMatrix = require('qrcode/lib/core/bit-matrix') as new (size: number) => {
  data: Uint8Array;
  set(row: number, col: number, value: boolean, reserved: boolean): void;
};
const referencePenalty = require('qrcode/lib/core/mask-pattern') as Record<
  'getPenaltyN1' | 'getPenaltyN2' | 'getPenaltyN3',
  (matrix: unknown) => number
>;

const VERSIONS = Array.from({ length: MAX_VERSION - MIN_VERSION + 1 }, (_, i) => i + MIN_VERSION);

/** Rows of modules as text, # for dark. */
const picture = (symbol: QrSymbol) =>
  Array.from({ length: symbol.size }, (_, row) =>
    symbol.dark
      .slice(row * symbol.size, (row + 1) * symbol.size)
      .map((d) => (d ? '#' : '.'))
      .join(''),
  );

// ISO/IEC 18004, Annex I: 01234567 in a version 1-M code, before masking (Figure I.1) and finished, with mask 010
// (Figure I.2). The format information is blank in the first.
const FIGURE_I1 = [
  '#######....#..#######',
  '#.....#...##..#.....#',
  '#.###.#..#..#.#.###.#',
  '#.###.#.....#.#.###.#',
  '#.###.#..###..#.###.#',
  '#.....#..#....#.....#',
  '#######.#.#.#.#######',
  '.........#.#.........',
  '......#..............',
  '#....#.####......#...',
  '#.##..##...###.###.##',
  '#..##.......#...##...',
  '#...######.###.##.#..',
  '........####.###.#...',
  '#######...#...#...#..',
  '#.....#..###.###....#',
  '#.###.#..#.......#...',
  '#.###.#...........#..',
  '#.###.#..#####.##....',
  '#.....#..#..#...#..#.',
  '#######...####.##....',
];
const FIGURE_I2 = [
  '#######..#.##.#######',
  '#.....#..####.#.....#',
  '#.###.#.#.....#.###.#',
  '#.###.#.##....#.###.#',
  '#.###.#.#.###.#.###.#',
  '#.....#.#...#.#.....#',
  '#######.#.#.#.#######',
  '........#..##........',
  '#.#####..#..#.#####..',
  '...#.#.##.#.#..#.##..',
  '..#...##.#.#.#..#####',
  '....#....#.....####..',
  '...######..#.#..#....',
  '........#.#####..##..',
  '#######..##.#.##.....',
  '#.....#.#.#####...#.#',
  '#.###.#.#...#..#.##..',
  '#.###.#.##..#..#.....',
  '#.###.#.#.##.#..#.#..',
  '#.....#........##.##.',
  '#######.####.#..#.#..',
];

describe('data path', () => {
  it.each(VERSIONS)('version %i visits every data module once, leaving Table 1’s remainder bits', (version) => {
    const layout = fixedLayout(version);
    const path = dataPath(layout);
    expect(path).toHaveLength(dataModules(version));
    expect(new Set(path.map(([r, c]) => r * layout.size + c)).size).toBe(path.length);
    expect(path.every(([r, c]) => layout.roles[r * layout.size + c] === 'data')).toBe(true);
    const remainder = path.length - 8 * totalCodewords(version);
    expect([0, 3, 4, 7]).toContain(remainder);
  });

  it('starts at the bottom right, going up, right module first', () => {
    expect(dataPath(fixedLayout(1)).slice(0, 4)).toEqual([
      [20, 20],
      [20, 19],
      [19, 20],
      [19, 19],
    ]);
  });

  it('never uses column 6, and ends in columns 1 and 0', () => {
    const path = dataPath(fixedLayout(2));
    expect(path.some(([, c]) => c === 6)).toBe(false);
    expect(path.at(-1)![1]).toBeLessThanOrEqual(1);
  });
});

describe('Annex I', () => {
  const encoded = encodeText('01234567', 'M')!;
  const unmasked = placeCodewords(encoded.version, encoded.codewords);

  it('places the codewords as in Figure I.1', () => {
    expect(encoded.version).toBe(1);
    expect(picture(unmasked)).toEqual(FIGURE_I1);
  });

  it('with mask 010, gives the code in Figure I.2', () => {
    expect(picture(applyMask(unmasked, 'M', 0b010))).toEqual(FIGURE_I2);
  });

  it('scores mask 000 lowest as the rules are written, and 010 if the quiet zone counts as light', () => {
    const { mask, penalties } = chooseMask(unmasked, 'M');
    expect(mask).toBe(0b000);
    expect(penalties.map((p) => p.points.total)).toEqual([297, 533, 397, 452, 570, 637, 419, 406]);
    const withQuietZone = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (m) => penalty(applyMask(unmasked, 'M', m).dark, unmasked.size, { quietZone: true }).points.total,
    );
    expect(withQuietZone.indexOf(Math.min(...withQuietZone))).toBe(0b010);
  });
});

/** Texts in each of the modes that both this code and the qrcode library encode the same way, long enough for many versions. */
const SAMPLES: { text: string; mode: 'numeric' | 'alphanumeric' | 'byte' }[] = [
  { text: '01234567', mode: 'numeric' },
  { text: 'HELLO WORLD', mode: 'alphanumeric' },
  { text: 'Hello, world!', mode: 'byte' },
  { text: '3141592653589793238462643383279502884197169399375105820974944592'.repeat(4), mode: 'numeric' },
  { text: 'HTTPS://EXAMPLE.COM/QR/PLACEMENT/'.repeat(6), mode: 'alphanumeric' },
  { text: 'The quick brown fox jumps over the lazy dog. '.repeat(12), mode: 'byte' },
  { text: 'Pack my box with five dozen liquor jugs! '.repeat(30), mode: 'byte' },
];

function reference(text: string, mode: QRCodeSegment['mode'], level: EcLevel, mask?: number) {
  return QRCode.create([{ data: text, mode } as QRCodeSegment], {
    errorCorrectionLevel: level as QRCodeErrorCorrectionLevel,
    maskPattern: mask as QRCodeMaskPattern | undefined,
  });
}

describe('finished codes', () => {
  const cases = SAMPLES.flatMap((s) => EC_LEVELS.map((level) => ({ ...s, level })));

  it.each(cases)('$mode text of $text.length characters at level $level matches the qrcode library for every mask', ({ text, mode, level }) => {
    const encoded = encodeText(text, level)!;
    expect(encoded.mode).toBe(mode);
    const unmasked = placeCodewords(encoded.version, encoded.codewords);
    for (let mask = 0; mask < 8; mask++) {
      const expected = reference(text, mode, level, mask);
      expect(encoded.version).toBe(expected.version);
      const ours = applyMask(unmasked, level, mask).dark;
      expect(ours.map(Number)).toEqual([...expected.modules.data]);
    }
  });

  it('covers versions from 1 to 40', () => {
    const versions = cases.map(({ text, level }) => encodeText(text, level)!.version);
    expect(Math.min(...versions)).toBe(1);
    expect(Math.max(...versions)).toBeGreaterThanOrEqual(36);
  });
});

describe('penalty rules', () => {
  // The qrcode library scores rules 1 to 3 the same way, except that it counts a finder-like sequence twice when both
  // sides are light. Its rule 4 differs from Table 11 (it charges 10 points from just over 50 % dark), so it isn't compared.
  const encoded = encodeText('Pack my box with five dozen liquor jugs!', 'L')!;
  const unmasked = placeCodewords(encoded.version, encoded.codewords);

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('rules 1 to 3 agree with the qrcode library for mask %i', (mask) => {
    const symbol = applyMask(unmasked, 'L', mask);
    const matrix = new BitMatrix(symbol.size);
    symbol.dark.forEach((d, k) => matrix.set(Math.floor(k / symbol.size), k % symbol.size, d, false));
    const ours = penalty(symbol.dark, symbol.size);
    expect(ours.points.runs).toBe(referencePenalty.getPenaltyN1(matrix));
    expect(ours.points.squares).toBe(referencePenalty.getPenaltyN2(matrix));
    const perSide = ours.finders.reduce((n, f) => n + Number(f.lightBefore) + Number(f.lightAfter), 0);
    expect(40 * perSide).toBe(referencePenalty.getPenaltyN3(matrix));
  });

  it('charges for runs, squares, finder-like sequences and balance as Table 11 describes', () => {
    // An 11 × 11 grid, all light except a dark run in row 0 and a finder-like sequence in column 10.
    const size = 11;
    const dark = new Array<boolean>(size * size).fill(false);
    for (let col = 0; col < 7; col++) dark[0 * size + col] = true; // a run of 7 dark: 3 + 2 points
    [1, 0, 1, 1, 1, 0, 1].forEach((d, k) => (dark[(k + 4) * size + 10] = d === 1)); // column 10, rows 4–10, light above
    const p = penalty(dark, size);
    expect(p.runs.find((r) => r.dark && !r.vertical)?.points).toBe(5);
    expect(p.finders).toEqual([{ vertical: true, index: 10, start: 4, lightBefore: true, lightAfter: false }]);
    // 12 dark modules of 121 is 9.9 %: 40 % from 50 %, so 8 steps of 5 %.
    expect(p.points.balance).toBe(80);
  });
});
