import { describe, expect, it } from 'vitest';
import { EC_LEVELS, ecInfo, type EcLevel } from './ec';
import {
  fixedLayout,
  formatInfoPositions,
  MAX_VERSION,
  MIN_VERSION,
  versionInfoPositions,
  type Position,
} from './layout';
import { buildBitstream, kanjiCharacters, kanjiCode, kanjiValue, parseBitstream, smallestVersionFor, type Mode } from './modes';
import { readCodewords, readSymbol } from './read';
import { deinterleave, interleave } from './rs';
import { applyMask, chooseMask, dataPath, encodeText, placeCodewords, type QrSymbol } from './symbol';

const VERSIONS = Array.from({ length: MAX_VERSION - MIN_VERSION + 1 }, (_, i) => i + MIN_VERSION);

/** The finished code for some text, with the mask that scores lowest. */
function make(text: string, level: EcLevel) {
  const encoded = encodeText(text, level)!;
  const unmasked = placeCodewords(encoded.version, encoded.codewords);
  const { mask } = chooseMask(unmasked, level);
  return { encoded, mask, symbol: applyMask(unmasked, level, mask) };
}

/** A copy of the code with the modules at `positions` flipped. */
function flip(symbol: QrSymbol, positions: readonly Position[]): boolean[] {
  const dark = [...symbol.dark];
  for (const [row, col] of positions) dark[row * symbol.size + col] = !dark[row * symbol.size + col];
  return dark;
}

describe('deinterleave', () => {
  it.each(VERSIONS)('undoes interleave for version %i at every level', (version) => {
    for (const level of EC_LEVELS) {
      const info = ecInfo(version, level);
      const blocks = info.blocks.flatMap((group, g) =>
        Array.from({ length: group.count }, (_, b) => ({
          data: Array.from({ length: group.data }, (_, i) => `${g}.${b} D${i}`),
          ec: Array.from({ length: info.ecPerBlock }, (_, i) => `${g}.${b} E${i}`),
        })),
      );
      expect(deinterleave(interleave(blocks), version, level)).toEqual(blocks);
    }
  });
});

describe('parseBitstream', () => {
  const SAMPLES: [Mode, string][] = [
    ['numeric', ''],
    ['numeric', '0'],
    ['numeric', '01234567'],
    ['numeric', '0123456789012345678'],
    ['alphanumeric', 'AC-42'],
    ['alphanumeric', 'HELLO WORLD'],
    ['byte', 'Hello, world!'],
    ['byte', 'Grüße, ½ ÿ'],
    ['byte', 'Привет, 世界 👋'],
    ['kanji', '点茗'],
    ['kanji', 'こんにちは、世界'],
  ];

  it.each(SAMPLES)('reads back %s text “%s” at every level', (mode, text) => {
    for (const level of EC_LEVELS) {
      const version = smallestVersionFor(mode, text, level)!;
      const parsed = parseBitstream(buildBitstream(mode, text, version, level).codewords, version);
      expect(parsed.error).toBeNull();
      expect(parsed.text).toBe(text);
      expect(parsed.segments.map((s) => s.mode)).toEqual([mode]);
    }
  });

  it('uses the longer character counts of larger versions', () => {
    for (const version of [9, 10, 26, 27, 40]) {
      const parsed = parseBitstream(buildBitstream('byte', 'Version', version, 'H').codewords, version);
      expect(parsed.text).toBe('Version');
    }
  });

  it('turns every kanji mode value back into its Shift JIS code', () => {
    for (const code of kanjiCharacters().values()) expect(kanjiCode(kanjiValue(code))).toBe(code);
  });

  it('reports bits that make no sense', () => {
    // Mode indicator 0011 (structured append) isn't handled.
    expect(parseBitstream([0b0011_0000, 0], 1).error).toMatch(/mode indicator 0011/);
    // Numeric mode, a count of 1023 characters in version 1: more than the bits left.
    expect(parseBitstream([0b0001_1111, 0b1111_1100, 0], 1).error).toMatch(/1023 characters/);
    // Numeric mode, 3 digits holding 1023.
    expect(parseBitstream([0b0001_0000, 0b0000_1111, 0b1111_1111, 0], 1).error).toMatch(/1023 in 3 digits/);
  });
});

describe('readSymbol', () => {
  const TEXTS = ['01234567', 'HELLO WORLD', 'Hello, world!', 'こんにちは', 'Pack my box with five dozen liquor jugs! '.repeat(8)];

  it.each(TEXTS)('reads “%s” back at every level and with every mask', (text) => {
    for (const level of EC_LEVELS) {
      const encoded = encodeText(text, level)!;
      const unmasked = placeCodewords(encoded.version, encoded.codewords);
      for (let mask = 0; mask < 8; mask++) {
        const symbol = applyMask(unmasked, level, mask);
        const reading = readSymbol(symbol.dark, symbol.size);
        expect(reading.failure).toBeNull();
        expect(reading.formatUsed).toBe(0);
        expect(reading.formatCopies[0]).toMatchObject({ level, mask, distance: 0 });
        expect(reading.version).toBe(encoded.version);
        expect(reading.codewords).toEqual(encoded.codewords);
        expect(reading.data).toEqual(encoded.data);
        expect(reading.blocks!.every((b) => b.decoding.corrections.length === 0)).toBe(true);
        expect(reading.bitstream!.text).toBe(text);
      }
    }
  });

  it('reads the Annex I example', () => {
    const annex = applyMask(placeCodewords(1, encodeText('01234567', 'M')!.codewords), 'M', 0b010);
    expect(readSymbol(annex.dark, annex.size).bitstream!.text).toBe('01234567');
  });

  describe('with damaged bytes', () => {
    const { encoded, mask, symbol } = make('Pack my box with five dozen liquor jugs! '.repeat(4), 'Q');
    const path = dataPath(fixedLayout(encoded.version));
    const info = ecInfo(encoded.version, 'Q');
    /** The first bit of each codeword in sequence order, so flipping it damages exactly that codeword. */
    const firstBit = (k: number) => path[8 * k];
    /** Positions in the sequence of each block's codewords. */
    const sequenceIndex = deinterleave(
      Array.from({ length: info.totalCodewords }, (_, k) => k),
      encoded.version,
      'Q',
    ).map((b) => [...b.data, ...b.ec]);

    it('corrects up to r damaged bytes in every block', () => {
      expect(sequenceIndex.length).toBeGreaterThan(2);
      const r = info.blocks[0].correctable;
      const damage = sequenceIndex.flatMap((indexes, b) => indexes.slice(b, b + 2 * r).filter((_, i) => i % 2 === 0));
      expect(damage).toHaveLength(r * sequenceIndex.length);
      const reading = readSymbol(flip(symbol, damage.map(firstBit)), symbol.size);
      expect(reading.failure).toBeNull();
      expect(reading.codewords).toEqual(readCodewords(flip(symbol, damage.map(firstBit)), encoded.version, mask));
      expect(reading.blocks!.map((b) => b.decoding.errors.length)).toEqual(sequenceIndex.map(() => r));
      expect(reading.bitstream!.text).toBe(encoded.text);
    });

    it('gives up when a block has more than r', () => {
      const r = info.blocks[0].correctable;
      const damage = sequenceIndex[1].slice(0, r + 1);
      const reading = readSymbol(flip(symbol, damage.map(firstBit)), symbol.size);
      expect(reading.failure).toBe('blocks');
      expect(reading.blocks!.map((b) => b.decoding.corrected !== null)).toEqual(sequenceIndex.map((_, b) => b !== 1));
      expect(reading.data).toBeNull();
    });
  });

  describe('format information', () => {
    const { symbol } = make('HELLO WORLD', 'H');
    const { first, second } = formatInfoPositions(symbol.version);

    it('corrects up to 3 wrong bits in the first copy', () => {
      const reading = readSymbol(flip(symbol, first.slice(0, 3)), symbol.size);
      expect(reading.formatUsed).toBe(0);
      expect(reading.formatCopies[0].distance).toBe(3);
      expect(reading.failure).toBeNull();
    });

    it('falls back on the second copy when the first has more than 3', () => {
      const reading = readSymbol(flip(symbol, first.slice(0, 4)), symbol.size);
      expect(reading.formatCopies[0].ok).toBe(false);
      expect(reading.formatUsed).toBe(1);
      expect(reading.bitstream!.text).toBe('HELLO WORLD');
    });

    it('fails when neither copy can be corrected', () => {
      const reading = readSymbol(flip(symbol, [...first.slice(0, 4), ...second.slice(4, 8)]), symbol.size);
      expect(reading.formatUsed).toBeNull();
      expect(reading.failure).toBe('format');
      expect(reading.codewords).toBeNull();
    });
  });

  describe('version information', () => {
    const { encoded, symbol } = make('The quick brown fox jumps over the lazy dog. '.repeat(4), 'M');
    const { topRight, bottomLeft } = versionInfoPositions(encoded.version);

    it('is read from version 7', () => {
      expect(encoded.version).toBeGreaterThanOrEqual(7);
      const reading = readSymbol(symbol.dark, symbol.size);
      expect(reading.versionCopies.map((c) => c.distance)).toEqual([0, 0]);
      expect(reading.versionUsed).toBe(0);
    });

    it('falls back on the bottom-left block, then fails', () => {
      const one = readSymbol(flip(symbol, topRight.slice(0, 4)), symbol.size);
      expect(one.versionUsed).toBe(1);
      expect(one.failure).toBeNull();
      const both = readSymbol(flip(symbol, [...topRight.slice(0, 4), ...bottomLeft.slice(0, 4)]), symbol.size);
      expect(both.version).toBeNull();
      expect(both.failure).toBe('version');
    });

    it('is not used below version 7', () => {
      const small = make('HELLO', 'L').symbol;
      expect(readSymbol(small.dark, small.size).versionCopies).toEqual([]);
    });
  });
});
