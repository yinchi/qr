import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { divide, hammingDistance, pairwiseDistances } from './cyclic';
import { EC_LEVELS, type EcLevel } from './ec';
import {
  decodeFormatInfo,
  FORMAT_CODEWORDS,
  FORMAT_INFO_GENERATOR,
  FORMAT_INFO_MASK,
  formatData,
  formatInfoBits,
} from './format';
import { decodeVersionInfo, VERSION_CODEWORDS, VERSION_INFO_GENERATOR } from './version-info';

const require = createRequire(import.meta.url);
const referenceFormat = require('qrcode/lib/core/format-info') as {
  getEncodedBits(level: unknown, mask: number): number;
};
const referenceLevels = require('qrcode/lib/core/error-correction-level') as Record<EcLevel, unknown>;

/** ISO/IEC 18004, Table C.1: the masked format information for data bits 00000 to 11111. */
// prettier-ignore
const TABLE_C1 = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0, 0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318,
  0x6c41, 0x6976, 0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b, 0x355f, 0x3068, 0x3f31, 0x3a06,
  0x24b4, 0x2183, 0x2eda, 0x2bed,
];

describe('format information', () => {
  it('matches Table C.1 and the qrcode library for every level and mask', () => {
    for (const level of EC_LEVELS) {
      for (let mask = 0; mask < 8; mask++) {
        expect(formatInfoBits(level, mask)).toBe(TABLE_C1[formatData(level, mask)]);
        expect(formatInfoBits(level, mask)).toBe(referenceFormat.getEncodedBits(referenceLevels[level], mask));
      }
    }
  });

  it('follows the worked example in C.2: level M, mask 101', () => {
    const data = formatData('M', 0b101);
    expect(data).toBe(0b00101);
    const division = divide(data, 5, FORMAT_INFO_GENERATOR);
    expect(division.remainder).toBe(0b0011011100);
    expect(division.steps).toHaveLength(1);
    expect(formatInfoBits('M', 0b101)).toBe(0b100000011001110);
  });

  it('has codewords at least 7 bits apart (C.3)', () => {
    const distances = pairwiseDistances(FORMAT_CODEWORDS.map((c) => c.bits));
    expect(Math.min(...distances.keys())).toBe(7);
    expect([...distances.values()].reduce((a, b) => a + b)).toBe((32 * 31) / 2);
  });

  it('decodes the example in C.3: two bits wrong, level M, mask 011', () => {
    // C.3 compares unmasked strings; the symbol holds them XORed with the mask.
    const read = 0b000011101001001 ^ FORMAT_INFO_MASK;
    expect(decodeFormatInfo(read)).toEqual({ level: 'M', mask: 0b011, distance: 2, ok: true });
  });

  it('corrects every pattern of up to 3 bit errors', () => {
    const patterns: number[] = [0];
    for (let a = 0; a < 15; a++) {
      patterns.push(1 << a);
      for (let b = a + 1; b < 15; b++) {
        patterns.push((1 << a) | (1 << b));
        for (let c = b + 1; c < 15; c++) patterns.push((1 << a) | (1 << b) | (1 << c));
      }
    }
    expect(patterns).toHaveLength(1 + 15 + 105 + 455);
    for (const { level, mask, bits } of FORMAT_CODEWORDS) {
      for (const errors of patterns) {
        const decoded = decodeFormatInfo(bits ^ errors);
        expect(decoded.ok && decoded.level === level && decoded.mask === mask).toBe(true);
      }
    }
  });
});

describe('version information', () => {
  it('follows the worked example in D.2: version 7', () => {
    const division = divide(7, 6, VERSION_INFO_GENERATOR);
    expect(division.remainder).toBe(0b110010010100);
  });

  it('has codewords at least 8 bits apart (D.3)', () => {
    const distances = pairwiseDistances(VERSION_CODEWORDS.map((c) => c.bits));
    expect(Math.min(...distances.keys())).toBe(8);
  });

  it('decodes the example in D.3: one bit wrong, version 7', () => {
    expect(decodeVersionInfo(0b000111110110010100)).toEqual({ version: 7, distance: 1, ok: true });
    expect(hammingDistance(0b000111110110010100, VERSION_CODEWORDS[0].bits)).toBe(1);
  });
});
