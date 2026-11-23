import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { dataCodewords, EC_LEVELS, ecInfo, smallestVersion, totalCodewords, type EcLevel } from './ec';

const require = createRequire(import.meta.url);
const reference = require('qrcode/lib/core/error-correction-code') as {
  getBlocksCount(version: number, level: unknown): number;
  getTotalCodewordsCount(version: number, level: unknown): number;
};
const referenceLevels = require('qrcode/lib/core/error-correction-level') as Record<EcLevel, unknown>;

const VERSIONS = Array.from({ length: 40 }, (_, i) => i + 1);

// ISO/IEC 18004, Table 9: number of error correction codewords, and number of blocks, per version (L, M, Q, H).
// prettier-ignore
const EC_CODEWORDS = [
  [7, 10, 13, 17], [10, 16, 22, 28], [15, 26, 36, 44], [20, 36, 52, 64], [26, 48, 72, 88], [36, 64, 96, 112],
  [40, 72, 108, 130], [48, 88, 132, 156], [60, 110, 160, 192], [72, 130, 192, 224], [80, 150, 224, 264],
  [96, 176, 260, 308], [104, 198, 288, 352], [120, 216, 320, 384], [132, 240, 360, 432], [144, 280, 408, 480],
  [168, 308, 448, 532], [180, 338, 504, 588], [196, 364, 546, 650], [224, 416, 600, 700], [224, 442, 644, 750],
  [252, 476, 690, 816], [270, 504, 750, 900], [300, 560, 810, 960], [312, 588, 870, 1050], [336, 644, 952, 1110],
  [360, 700, 1020, 1200], [390, 728, 1050, 1260], [420, 784, 1140, 1350], [450, 812, 1200, 1440],
  [480, 868, 1290, 1530], [510, 924, 1350, 1620], [540, 980, 1440, 1710], [570, 1036, 1530, 1800],
  [570, 1064, 1590, 1890], [600, 1120, 1680, 1980], [630, 1204, 1770, 2100], [660, 1260, 1860, 2220],
  [720, 1316, 1950, 2310], [750, 1372, 2040, 2430],
];
// prettier-ignore
const BLOCK_COUNTS = [
  [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 2, 2], [1, 2, 2, 4], [1, 2, 4, 4], [2, 4, 4, 4], [2, 4, 6, 5], [2, 4, 6, 6],
  [2, 5, 8, 8], [4, 5, 8, 8], [4, 5, 8, 11], [4, 8, 10, 11], [4, 9, 12, 16], [4, 9, 16, 16], [6, 10, 12, 18],
  [6, 10, 17, 16], [6, 11, 16, 19], [6, 13, 18, 21], [7, 14, 21, 25], [8, 16, 20, 25], [8, 17, 23, 25],
  [9, 17, 23, 34], [9, 18, 25, 30], [10, 20, 27, 32], [12, 21, 29, 35], [12, 23, 34, 37], [12, 25, 34, 40],
  [13, 26, 35, 42], [14, 28, 38, 45], [15, 29, 40, 48], [16, 31, 43, 51], [17, 33, 45, 54], [18, 35, 48, 57],
  [19, 37, 51, 60], [19, 38, 53, 63], [20, 40, 56, 66], [21, 43, 59, 70], [22, 45, 62, 74], [24, 47, 65, 77],
  [25, 49, 68, 81],
];

describe('ecInfo', () => {
  it.each(VERSIONS)('version %i matches Table 9 and the qrcode library', (version) => {
    EC_LEVELS.forEach((level, l) => {
      const info = ecInfo(version, level);
      expect(info.ecCodewords, `${version}-${level} error correction codewords`).toBe(EC_CODEWORDS[version - 1][l]);
      expect(info.blocks.reduce((n, g) => n + g.count, 0), `${version}-${level} blocks`).toBe(
        BLOCK_COUNTS[version - 1][l],
      );
      expect(info.blocks.reduce((n, g) => n + g.count * g.total, 0)).toBe(info.totalCodewords);
      expect(info.dataCodewords).toBe(info.totalCodewords - info.ecCodewords);
      expect(info.ecCodewords).toBe(reference.getTotalCodewordsCount(version, referenceLevels[level]));
      expect(info.blocks.reduce((n, g) => n + g.count, 0)).toBe(
        reference.getBlocksCount(version, referenceLevels[level]),
      );
    });
  });

  it('splits uneven codewords into short and long blocks as Table 9 does', () => {
    // Version 5-Q: 2 × (33, 15, 9) and 2 × (34, 16, 9).
    expect(ecInfo(5, 'Q').blocks).toEqual([
      { count: 2, total: 33, data: 15, correctable: 9 },
      { count: 2, total: 34, data: 16, correctable: 9 },
    ]);
    // Version 40-H: 20 × (45, 15, 15) and 61 × (46, 16, 15).
    expect(ecInfo(40, 'H').blocks).toEqual([
      { count: 20, total: 45, data: 15, correctable: 15 },
      { count: 61, total: 46, data: 16, correctable: 15 },
    ]);
  });

  it('reserves misdecode protection codewords in the smallest symbols (7.5.1)', () => {
    // Table 9: 1-L is (26, 19, 2) with p = 3, 2-L is (44, 34, 4) with p = 2, 3-L is (70, 55, 7) with p = 1.
    expect(ecInfo(1, 'L').correctableCodewords).toBe(2);
    expect(ecInfo(2, 'L').correctableCodewords).toBe(4);
    expect(ecInfo(3, 'L').correctableCodewords).toBe(7);
    // 7.5.1: version 6-H's 112 error correction codewords can correct 56 codewords, 32.6% of 172.
    expect(ecInfo(6, 'H').correctableCodewords).toBe(56);
  });

  it('counts total codewords as in Table 1', () => {
    expect([1, 7, 14, 40].map(totalCodewords)).toEqual([26, 196, 581, 3706]);
  });
});

describe('smallestVersion', () => {
  it('finds the first version with enough data codewords', () => {
    expect(smallestVersion(19, 'L')).toBe(1);
    expect(smallestVersion(20, 'L')).toBe(2);
    expect(smallestVersion(dataCodewords(40, 'H'), 'H')).toBe(40);
    expect(smallestVersion(dataCodewords(40, 'H') + 1, 'H')).toBeNull();
  });
});
