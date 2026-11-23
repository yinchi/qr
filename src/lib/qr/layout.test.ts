import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { versionInfoBits } from './version-info';
import {
  alignmentCentres,
  countRoles,
  dataModules,
  fixedLayout,
  MAX_VERSION,
  MIN_VERSION,
  symbolSize,
  type Role,
} from './layout';

const VERSIONS = Array.from({ length: MAX_VERSION - MIN_VERSION + 1 }, (_, i) => i + MIN_VERSION);

/** Total codewords (data + error correction) per version: ISO/IEC 18004, Table 1, column E. */
const TOTAL_CODEWORDS = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085, 1156, 1258, 1364,
  1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

/** Modules left over after the last codeword: ISO/IEC 18004, Table 1, last column. */
function remainderBits(version: number): number {
  if (version === 1) return 0;
  if (version <= 6) return 7;
  if (version <= 13) return 0;
  if (version <= 20) return 3;
  if (version <= 27) return 4;
  if (version <= 34) return 3;
  return 0;
}

/** Version information bit strings for versions 7–40: ISO/IEC 18004, Annex D, Table D.1. */
const VERSION_INFO = [
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d, 0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532,
  0x149a6, 0x15683, 0x168c9, 0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75, 0x1f250, 0x209d5,
  0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64, 0x27541, 0x28c69,
];

/** Function pattern modules (finder, separator, timing, alignment) per version: ISO/IEC 18004, Table 1, column B. */
const FUNCTION_PATTERN_MODULES = [
  202, 235, 243, 251, 259, 267, 390, 398, 406, 414, 422, 430, 438, 611, 619, 627, 635, 643, 651, 659, 882, 890, 898,
  906, 914, 922, 930, 1203, 1211, 1219, 1227, 1235, 1243, 1251, 1574, 1582, 1590, 1598, 1606, 1614,
];

/** Format and version information modules, which the standard counts with the dark module: Table 1, column C. */
const FORMAT_AND_VERSION_MODULES = (version: number) => (version < 7 ? 31 : 67);

describe('fixedLayout', () => {
  it.each(VERSIONS)('version %i has the module counts in Table 1 of the standard', (version) => {
    const counts = countRoles(fixedLayout(version));
    expect(counts.finder + counts.separator + counts.timing + counts.alignment).toBe(
      FUNCTION_PATTERN_MODULES[version - 1],
    );
    expect(counts.format + counts.version + counts.darkModule).toBe(FORMAT_AND_VERSION_MODULES(version));
  });

  it.each(VERSIONS)('version %i matches the qrcode library module by module', (version) => {
    const layout = fixedLayout(version);
    const reference = QRCode.create('1', { version, errorCorrectionLevel: 'L', maskPattern: 0 }).modules;
    expect(reference.size).toBe(layout.size);

    const mismatches: string[] = [];
    for (let row = 0; row < layout.size; row++) {
      for (let col = 0; col < layout.size; col++) {
        const i = row * layout.size + col;
        const role = layout.roles[i];
        const reserved = reference.reservedBit[i] === 1;
        if (reserved !== (role !== 'data')) {
          mismatches.push(`(${row}, ${col}) is ${role} here but ${reserved ? 'reserved' : 'data'} in the reference`);
        }
        // Format modules depend on the error correction level and mask, and data modules on the data.
        if (role !== 'format' && role !== 'data' && layout.dark[i] !== (reference.data[i] === 1)) {
          mismatches.push(`(${row}, ${col}) ${role} is ${layout.dark[i] ? 'dark' : 'light'} here`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(VERSIONS)('version %i has room for exactly its codewords and remainder bits', (version) => {
    const { data } = countRoles(fixedLayout(version));
    expect(data).toBe(8 * TOTAL_CODEWORDS[version - 1] + remainderBits(version));
    expect(dataModules(version)).toBe(data);
  });

  it('has the expected size and fixed-module counts', () => {
    expect(symbolSize(1)).toBe(21);
    expect(symbolSize(40)).toBe(177);
    const counts = countRoles(fixedLayout(7));
    const expected: Partial<Record<Role, number>> = {
      finder: 3 * 49,
      separator: 3 * 15,
      alignment: 6 * 25,
      format: 30,
      version: 36,
      darkModule: 1,
    };
    expect(counts).toMatchObject(expected);
  });

  it('puts the dark module at row 4V + 9, column 8', () => {
    for (const version of VERSIONS) {
      const layout = fixedLayout(version);
      const i = (4 * version + 9) * layout.size + 8;
      expect(layout.roles[i]).toBe('darkModule');
      expect(layout.dark[i]).toBe(true);
    }
  });

  it('rejects versions outside 1–40', () => {
    expect(() => fixedLayout(0)).toThrow(RangeError);
    expect(() => fixedLayout(41)).toThrow(RangeError);
    expect(() => fixedLayout(2.5)).toThrow(RangeError);
  });
});

describe('alignmentCentres', () => {
  it('has 0, 1, 6, 13, 22, 33 and 46 patterns as the version grows', () => {
    const expected = (v: number) =>
      v === 1 ? 0 : v <= 6 ? 1 : v <= 13 ? 6 : v <= 20 ? 13 : v <= 27 ? 22 : v <= 34 ? 33 : 46;
    expect(VERSIONS.map((v) => alignmentCentres(v).length)).toEqual(VERSIONS.map(expected));
  });

  it('skips the three corners taken by finder patterns', () => {
    expect(alignmentCentres(7)).toEqual([
      [6, 22],
      [22, 6],
      [22, 22],
      [22, 38],
      [38, 22],
      [38, 38],
    ]);
  });
});

describe('versionInfoBits', () => {
  it('matches the standard for versions 7–40', () => {
    expect(VERSIONS.filter((v) => v >= 7).map(versionInfoBits)).toEqual(VERSION_INFO);
  });

  it('encodes version 7 as 000111 110010010100', () => {
    expect(versionInfoBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });
});
