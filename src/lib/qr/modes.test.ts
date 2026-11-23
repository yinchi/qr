import { describe, expect, it } from 'vitest';
import { EC_LEVELS } from './ec';
import {
  buildBitstream,
  countBits,
  detectMode,
  encodeAlphanumeric,
  encodeBytes,
  encodeKanji,
  encodeNumeric,
  kanjiCharacters,
  maxCharacters,
  MODES,
  segmentParts,
  shiftJis,
  smallestVersionFor,
  type Part,
} from './modes';

const bitString = (parts: Part[]) => parts.map((p) => p.value.toString(2).padStart(p.width, '0')).join(' ');

describe('numeric mode', () => {
  it('follows example 1 of 7.4.3: 01234567 in version 1-H', () => {
    expect(encodeNumeric('01234567').map((g) => [g.chars, g.value, g.width])).toEqual([
      ['012', 12, 10],
      ['345', 345, 10],
      ['67', 67, 7],
    ]);
    expect(bitString(segmentParts('numeric', '01234567', 1))).toBe(
      '0001 0000001000 0000001100 0101011001 1000011',
    );
  });
});

describe('alphanumeric mode', () => {
  it('follows the example in 7.4.4: AC-42 in version 1-H', () => {
    expect(encodeAlphanumeric('AC-42').map((g) => g.value)).toEqual([462, 1849, 2]);
    expect(bitString(segmentParts('alphanumeric', 'AC-42', 1))).toBe(
      '0010 000000101 00111001110 11100111001 000010',
    );
  });
});

describe('byte mode', () => {
  it('uses ISO/IEC 8859-1 when it can, one byte per character', () => {
    expect(encodeBytes('Aé').map((g) => g.codes)).toEqual([[0x41], [0xe9]]);
    expect(segmentParts('byte', 'Aé', 1).map((p) => p.kind)).toEqual(['mode', 'count', 'data', 'data']);
  });

  it('uses UTF-8 otherwise, with an ECI header for ECI 26 and the count in bytes', () => {
    expect(encodeBytes('€').map((g) => g.codes)).toEqual([[0xe2, 0x82, 0xac]]);
    const parts = segmentParts('byte', 'A€', 1);
    // ECI header: mode indicator 0111, then ECI 000026 in one codeword, 0bbbbbbb (Table 4).
    expect(bitString(parts.slice(0, 3))).toBe('011100011010 0100 00000100');
  });
});

describe('kanji mode', () => {
  it('follows the examples in 7.4.6: 点 and 茗', () => {
    expect([shiftJis('点'), shiftJis('茗')]).toEqual([0x935f, 0xe4aa]);
    expect(encodeKanji('点茗').map((g) => g.value.toString(2).padStart(13, '0'))).toEqual([
      '0110110011111',
      '1101010101010',
    ]);
  });

  it('covers kana but not ASCII', () => {
    expect(shiftJis('あ')).toBe(0x82a0);
    expect(shiftJis('A')).toBeNull();
  });

  it('holds exactly the 6,879 characters of JIS X 0208, without vendor additions such as ①', () => {
    expect(kanjiCharacters().size).toBe(6879);
    expect(shiftJis('①')).toBeNull();
    expect(shiftJis('㍻')).toBeNull();
  });

  it('includes some traditional Chinese forms but few simplified ones', () => {
    // 國, 學 and 發 are in JIS X 0208 alongside the Japanese 国, 学 and 発; 說 is not, only the Japanese 説.
    expect(['國', '學', '發', '龍', '竜'].map(shiftJis)).toEqual([0x9aa0, 0x9b7b, 0xe1a2, 0x97b4, 0x97b3]);
    expect(['說', '发', '们', '这'].map(shiftJis)).toEqual([null, null, null, null]);
  });
});

describe('detectMode', () => {
  it('picks the smallest character set that covers the text', () => {
    expect(['01234567', 'AC-42', 'Hello', '点茗', '点A'].map(detectMode)).toEqual([
      'numeric',
      'alphanumeric',
      'byte',
      'kanji',
      'byte',
    ]);
  });
});

describe('character count indicator', () => {
  it('has the lengths in Table 3', () => {
    expect([1, 9, 10, 26, 27, 40].map((v) => MODES.map((m) => countBits(m, v)))).toEqual([
      [10, 9, 8, 8],
      [10, 9, 8, 8],
      [12, 11, 16, 10],
      [12, 11, 16, 10],
      [14, 13, 16, 12],
      [14, 13, 16, 12],
    ]);
  });
});

describe('buildBitstream', () => {
  it('reproduces Annex I.2: 01234567 in version 1-M', () => {
    const { codewords } = buildBitstream('numeric', '01234567', 1, 'M');
    expect(codewords.map((c) => c.toString(2).padStart(8, '0')).join(' ')).toBe(
      '00010000 00100000 00001100 01010110 01100001 10000000 11101100 00010001 ' +
        '11101100 00010001 11101100 00010001 11101100 00010001 11101100 00010001',
    );
  });

  it('shortens the terminator when there is no room for all four bits', () => {
    // Version 1-H holds 72 bits: 17 digits use 4 + 10 + 57 = 71, leaving room for one terminator bit.
    const { parts } = buildBitstream('numeric', '12345678901234567', 1, 'H');
    expect(parts.filter((p) => p.kind === 'terminator').map((p) => p.width)).toEqual([1]);
    expect(parts.some((p) => p.kind === 'pad')).toBe(false);
  });

  it('reports data that does not fit', () => {
    expect(buildBitstream('numeric', '1'.repeat(18), 1, 'H').fits).toBe(false);
  });
});

// ISO/IEC 18004, Table 7: characters per mode (numeric, alphanumeric, byte, kanji) for each level (L, M, Q, H).
// Chosen versions cover all three lengths of the character count indicator and the boundaries between them.
// prettier-ignore
const TABLE_7: Record<number, number[][]> = {
  1: [[41, 25, 17, 10], [34, 20, 14, 8], [27, 16, 11, 7], [17, 10, 7, 4]],
  2: [[77, 47, 32, 20], [63, 38, 26, 16], [48, 29, 20, 12], [34, 20, 14, 8]],
  9: [[552, 335, 230, 141], [432, 262, 180, 111], [312, 189, 130, 80], [235, 143, 98, 60]],
  10: [[652, 395, 271, 167], [513, 311, 213, 131], [364, 221, 151, 93], [288, 174, 119, 74]],
  26: [[3283, 1990, 1367, 842], [2544, 1542, 1059, 652], [1804, 1094, 751, 462], [1425, 864, 593, 365]],
  27: [[3517, 2132, 1465, 902], [2701, 1637, 1125, 692], [1933, 1172, 805, 496], [1501, 910, 625, 385]],
  35: [[5529, 3351, 2303, 1417], [4343, 2632, 1809, 1113], [3081, 1867, 1283, 790], [2361, 1431, 983, 605]],
  40: [[7089, 4296, 2953, 1817], [5596, 3391, 2331, 1435], [3993, 2420, 1663, 1024], [3057, 1852, 1273, 784]],
};

describe('maxCharacters', () => {
  it.each(Object.keys(TABLE_7).map(Number))('matches Table 7 for version %i', (version) => {
    expect(EC_LEVELS.map((level) => MODES.map((mode) => maxCharacters(mode, version, level)))).toEqual(
      TABLE_7[version],
    );
  });

  it('agrees with the bitstream builder at the limit', () => {
    for (const [mode, char] of [
      ['numeric', '7'],
      ['alphanumeric', 'Q'],
      ['byte', 'q'],
      ['kanji', '茗'],
    ] as const) {
      for (const version of [1, 10, 27]) {
        const n = maxCharacters(mode, version, 'Q');
        expect(buildBitstream(mode, char.repeat(n), version, 'Q').fits).toBe(true);
        expect(buildBitstream(mode, char.repeat(n + 1), version, 'Q').fits).toBe(false);
      }
    }
  });
});

describe('smallestVersionFor', () => {
  it('finds the first version that fits', () => {
    expect(smallestVersionFor('numeric', '01234567', 'M')).toBe(1);
    expect(smallestVersionFor('byte', 'x'.repeat(18), 'L')).toBe(2);
  });
});
