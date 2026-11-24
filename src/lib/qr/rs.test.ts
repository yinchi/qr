import { describe, expect, it } from 'vitest';
import { EC_LEVELS, ecInfo } from './ec';
import { exp, generatorPolynomial, multiply, polyAdd, polyMultiply, solveLinear } from './gf256';
import {
  decode,
  encodeBlocks,
  errorCorrectionCodewords,
  interleave,
  powerOf,
  protectionFor,
  syndromes,
  type Block,
} from './rs';

// Annex I: 01234567 in a version 1-M code, 16 data codewords and 10 error correction codewords.
const ANNEX_I_DATA = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
const ANNEX_I_EC = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];
const ANNEX_I = [...ANNEX_I_DATA, ...ANNEX_I_EC];

/** A deterministic stream of bytes, so failures can be reproduced. */
function randomBytes(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state >> 16;
  };
}

describe('solving linear equations over bytes', () => {
  it('finds the one solution, and returns null when there is not exactly one', () => {
    // 3a + 7b = 3 × 5 + 7 × 9, a + b = 5 + 9
    const rhs = [multiply(3, 5) ^ multiply(7, 9), 5 ^ 9];
    expect(solveLinear([[3, 7], [1, 1]], rhs)).toEqual([5, 9]);
    expect(solveLinear([[3, 7], [6, 14]], [1, 2])).toBeNull();
    expect(solveLinear([], [])).toEqual([]);
  });
});

describe('encoding', () => {
  it('gives the error correction codewords of Annex I', () => {
    expect(errorCorrectionCodewords(ANNEX_I_DATA, 10)).toEqual(ANNEX_I_EC);
  });

  it('makes the block a multiple of the generator polynomial, so every syndrome is 0', () => {
    expect(syndromes(ANNEX_I, 10)).toEqual(new Array(10).fill(0));
  });
});

describe('decoding', () => {
  it('finds nothing to correct in a valid block', () => {
    const result = decode(ANNEX_I, 10, { protection: 2 });
    expect(result.failure).toBeNull();
    expect(result.trials).toEqual([{ count: 0, locator: [1], fits: true }]);
    expect(result.corrected).toEqual(ANNEX_I);
  });

  it('reads a single error straight from the syndromes: S₀ is its value and S₁ ÷ S₀ is α^j', () => {
    const received = [...ANNEX_I];
    received[5] ^= 49;
    const result = decode(received, 10, { protection: 2 });
    const power = powerOf(5, 26);
    expect(power).toBe(20);
    expect(result.syndromes.slice(0, 3)).toEqual([49, multiply(49, exp(20)), multiply(49, exp(40))]);
    expect(result.locator).toEqual([1, exp(20)]);
    expect(result.errors).toEqual([5]);
    expect(result.corrections).toEqual([{ index: 5, value: 49 }]);
    expect(result.corrected).toEqual(ANNEX_I);
  });

  it("finds a locator that satisfies Annex B's equations for four errors", () => {
    const received = [...ANNEX_I];
    for (const [index, value] of [[0, 1], [7, 200], [16, 33], [25, 99]]) received[index] ^= value;
    const { syndromes: s, locator, corrected } = decode(received, 10, { protection: 2 });
    expect(corrected).toEqual(ANNEX_I);
    const [, s1, s2, s3, s4] = locator!;
    // S₀σ₄ − S₁σ₃ + S₂σ₂ − S₃σ₁ + S₄ = 0, and so on, where minus is plus.
    for (let i = 0; i < 4; i++) {
      expect(multiply(s[i], s4) ^ multiply(s[i + 1], s3) ^ multiply(s[i + 2], s2) ^ multiply(s[i + 3], s1) ^ s[i + 4]).toBe(0);
    }
  });

  it('corrects any e erasures and t errors with e + 2t ≤ n − p', () => {
    const random = randomBytes(18004);
    const pick = (max: number) => random() % max;
    for (const n of [7, 10, 13, 17, 22, 26, 28, 30]) {
      for (let trial = 0; trial < 60; trial++) {
        const length = n + 1 + pick(120);
        const data = Array.from({ length: length - n }, random).map((v) => v & 0xff);
        const block = [...data, ...errorCorrectionCodewords(data, n)];
        const protection = pick(4);
        const e = pick(n - protection + 1);
        const t = pick(Math.floor((n - protection - e) / 2) + 1);
        const indexes = Array.from({ length }, (_, i) => i).sort(() => (random() & 1 ? 1 : -1));
        const erasures = indexes.slice(0, e);
        const errors = indexes.slice(e, e + t);
        const received = [...block];
        for (const index of erasures) received[index] = 0;
        for (const index of errors) received[index] ^= 1 + pick(255);
        const result = decode(received, n, { erasures, protection });
        expect(result.failure, `n = ${n}, e = ${e}, t = ${t}`).toBeNull();
        expect(result.corrected).toEqual(block);
        expect(result.errors).toEqual([...errors].sort((a, b) => a - b));
      }
    }
  });

  it('either gives up or lands on a valid block when there are too many errors', () => {
    const random = randomBytes(2015);
    let gaveUp = 0;
    for (let trial = 0; trial < 300; trial++) {
      const received = [...ANNEX_I];
      const errors = new Set<number>();
      while (errors.size < 5 + (trial % 4)) errors.add(random() % 26);
      for (const index of errors) received[index] ^= 1 + (random() % 255);
      const result = decode(received, 10, { protection: 2 });
      if (result.failure) gaveUp++;
      else expect(syndromes(result.corrected!, 10)).toEqual(new Array(10).fill(0));
    }
    expect(gaveUp).toBeGreaterThan(290);
  });

  it('is fooled by damage that lands closer to another valid block, unless misdecode protection is on', () => {
    // Another valid block: add x¹⁵ g(x), which changes the first 11 codewords.
    const other = polyAdd(ANNEX_I, polyMultiply(generatorPolynomial(10), [1, ...new Array(15).fill(0)]));
    const changed = ANNEX_I.map((c, i) => (c !== other[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Damage 6 of them to match the other block: it is now 5 codewords from that one.
    const received = ANNEX_I.map((c, i) => (i < 6 ? other[i] : c));
    const unprotected = decode(received, 10);
    expect(unprotected.corrected).toEqual(other);
    expect(unprotected.errors).toEqual([6, 7, 8, 9, 10]);
    expect(decode(received, 10, { protection: 2 }).failure).toBe('errors');
  });

  it('corrects as many erasures as there are error correction codewords, without protection', () => {
    const erasures = [0, 3, 6, 9, 12, 15, 18, 21, 24, 25];
    const received = ANNEX_I.map((c, i) => (erasures.includes(i) ? 0 : c));
    expect(decode(received, 10, { erasures }).corrected).toEqual(ANNEX_I);
    expect(decode(received, 10, { erasures: [...erasures, 1] }).failure).toBe('erasures');
  });

  it('keeps back 3 codewords once more than half are erased (7.5.1)', () => {
    expect(protectionFor(2, 10, 5)).toBe(2);
    expect(protectionFor(2, 10, 6)).toBe(3);
    expect(protectionFor(0, 30, 16)).toBe(3);
  });
});

describe('blocks and interleaving', () => {
  it('make one block for version 1', () => {
    const blocks = encodeBlocks(ANNEX_I_DATA, 1, 'M');
    expect(blocks).toEqual([{ data: ANNEX_I_DATA, ec: ANNEX_I_EC }]);
    expect(interleave(blocks)).toEqual(ANNEX_I);
  });

  it('follow Figure 15 for version 5-H', () => {
    const labels: Block<string>[] = [];
    let d = 0;
    let e = 0;
    for (const size of [11, 11, 12, 12]) {
      labels.push({
        data: Array.from({ length: size }, () => `D${++d}`),
        ec: Array.from({ length: 22 }, () => `E${++e}`),
      });
    }
    const sequence = interleave(labels);
    expect(sequence.slice(0, 8)).toEqual(['D1', 'D12', 'D23', 'D35', 'D2', 'D13', 'D24', 'D36']);
    expect(sequence.slice(40, 52)).toEqual(['D11', 'D22', 'D33', 'D45', 'D34', 'D46', 'E1', 'E23', 'E45', 'E67', 'E2', 'E24']);
    expect(sequence.slice(-4)).toEqual(['E22', 'E44', 'E66', 'E88']);

    const blocks = encodeBlocks(new Array(46).fill(0), 5, 'H');
    expect(blocks.map((b) => [b.data.length, b.ec.length])).toEqual([[11, 22], [11, 22], [12, 22], [12, 22]]);
  });

  it('use every codeword of every version and level once', () => {
    for (let version = 1; version <= 40; version++) {
      for (const level of EC_LEVELS) {
        const info = ecInfo(version, level);
        const data = Array.from({ length: info.dataCodewords }, (_, i) => i % 256);
        const blocks = encodeBlocks(data, version, level);
        expect(blocks.flatMap((b) => b.data)).toEqual(data);
        expect(interleave(blocks)).toHaveLength(info.totalCodewords);
      }
    }
  });
});
