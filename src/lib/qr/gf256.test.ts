import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  add,
  exp,
  generatorPolynomial,
  inverse,
  LOGS,
  multiply,
  multiplyLongHand,
  polyAdd,
  polyDivide,
  polyMultiply,
  POWERS,
  powersOf2,
  PRIME_MODULUS,
  quotient,
  times2,
} from './gf256';

const require = createRequire(import.meta.url);
const reference = require('qrcode/lib/core/galois-field') as {
  exp(n: number): number;
  log(n: number): number;
  mul(a: number, b: number): number;
};
const ReedSolomonEncoder = require('qrcode/lib/core/reed-solomon-encoder') as new (degree: number) => {
  encode(data: Uint8Array): Uint8Array;
};

const BYTES = Array.from({ length: 256 }, (_, i) => i);
const NON_ZERO = BYTES.slice(1);

describe('powers of 2', () => {
  it('double until a 1 falls off the end, then XOR with 100011101', () => {
    expect(POWERS.slice(0, 12)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 29, 58, 116, 232]);
    expect(times2(128)).toBe(0b100000000 ^ 0b100011101);
  });

  it('run through all 255 non-zero bytes, then return to 1', () => {
    expect(POWERS).toHaveLength(255);
    expect(new Set(POWERS).size).toBe(255);
    expect(POWERS).not.toContain(0);
    expect(times2(POWERS[254])).toBe(1);
  });

  it("don't for every irreducible polynomial: under AES's x⁸ + x⁴ + x³ + x + 1 they return to 1 after 51", () => {
    expect(powersOf2(0b100011011)).toHaveLength(51);
  });

  it('visit every non-zero byte under 16 of the 256 polynomials of degree 8, all irreducible', () => {
    const primitive = BYTES.map((low) => 0x100 | low).filter((modulus) => powersOf2(modulus).length === 255);
    expect(primitive).toHaveLength(16);
    expect(primitive[0]).toBe(PRIME_MODULUS);
    const hasZeroDivisors = (modulus: number) =>
      NON_ZERO.some((a) => NON_ZERO.some((b) => multiplyLongHand(a, b, modulus).result === 0));
    expect(primitive.filter(hasZeroDivisors)).toEqual([]);
  });

  it('match the qrcode library, as do the logs', () => {
    for (let k = 0; k < 255; k++) expect(POWERS[k]).toBe(reference.exp(k));
    for (const a of NON_ZERO) expect(LOGS[a]).toBe(reference.log(a));
    expect(LOGS[0]).toBeNaN();
  });
});

describe('multiplying bytes', () => {
  it('gives the same answer the long way, by adding logs, and in the qrcode library', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        const product = multiply(a, b);
        expect(multiplyLongHand(a, b).result).toBe(product);
        expect(reference.mul(a, b)).toBe(product);
      }
    }
  });

  it('shows the long-hand steps: one shifted copy per 1 bit, then the division', () => {
    const { partials, product, steps, result } = multiplyLongHand(0b11, 0b10000001);
    expect(partials).toEqual([
      { shift: 7, value: 0b110000000 },
      { shift: 0, value: 0b11 },
    ]);
    expect(product).toBe(0b110000011);
    expect(steps.map((s) => s.shifted)).toEqual([0b100011101]);
    expect(result).toBe(0b010011110);
  });

  it('follows the rules of ordinary arithmetic', () => {
    for (const a of BYTES) {
      for (const b of BYTES) {
        expect(multiply(a, b)).toBe(multiply(b, a));
        for (const c of [1, 3, 29, 142, 255]) {
          expect(multiply(a, add(b, c))).toBe(add(multiply(a, b), multiply(a, c)));
          expect(multiply(multiply(a, b), c)).toBe(multiply(a, multiply(b, c)));
        }
      }
    }
  });

  it('never gives 0 from two non-zero bytes', () => {
    for (const a of NON_ZERO) for (const b of NON_ZERO) expect(multiply(a, b)).not.toBe(0);
  });

  it('would, with a modulus that factors: x⁸ + 1 = (x + 1)⁸', () => {
    expect(multiplyLongHand(0b11, 0b11111111, 0b100000001).result).toBe(0);
  });

  it('works out the examples in the text', () => {
    expect(add(82, 25)).toBe(75);
    expect(multiply(3, 3)).toBe(5);
    expect([multiply(7, 3), multiply(7, 2), multiply(8, 3), multiply(8, 2)]).toEqual([9, 14, 24, 16]);
    expect(LOGS[3]).toBe(25);
    expect(exp(LOGS[3] + LOGS[3])).toBe(5);
  });
});

describe('dividing bytes', () => {
  it('finds one inverse for each non-zero byte', () => {
    for (const a of NON_ZERO) {
      expect(multiply(a, inverse(a))).toBe(1);
      expect(NON_ZERO.filter((b) => multiply(a, b) === 1)).toEqual([inverse(a)]);
    }
    expect(inverse(2)).toBe(142);
    expect(() => inverse(0)).toThrow(RangeError);
  });

  it('undoes multiplication', () => {
    for (const a of BYTES) for (const b of NON_ZERO) expect(quotient(multiply(a, b), b)).toBe(a);
    expect(() => quotient(1, 0)).toThrow(RangeError);
  });
});

describe('polynomials with byte coefficients', () => {
  it('add and multiply the examples in the text', () => {
    expect(polyAdd([3, 5, 7], [1, 5, 2])).toEqual([2, 0, 5]);
    expect(polyMultiply([1, 1], [1, 2])).toEqual([1, 3, 2]);
  });

  it('divide the example in the text', () => {
    const { quotient: q, remainder, steps } = polyDivide([7, 1, 0, 0], [1, 3, 2]);
    expect(q).toEqual([7, 8]);
    expect(remainder).toEqual([22, 16]);
    expect(steps.map((s) => s.subtracted)).toEqual([
      [7, 9, 14, 0],
      [0, 8, 24, 16],
    ]);
    // Data 7, 1 with error correction bytes 22, 16: a multiple of the generator.
    expect(polyMultiply([7, 8], [1, 3, 2])).toEqual([7, 1, 22, 16]);
  });

  it('divide by divisors whose leading coefficient is not 1', () => {
    const p = [200, 17, 0, 93];
    const q = [5, 250, 1];
    const r = [77, 3];
    const { quotient: found, remainder } = polyDivide(polyAdd(polyMultiply(p, q), r), q);
    expect(found).toEqual(p);
    expect(remainder).toEqual(r);
  });

  // Table A.1, as the powers of α = 2 that make up each coefficient, highest first; x^k alone is α⁰.
  // prettier-ignore
  const TABLE_A1: Record<number, number[]> = {
    2: [0, 25, 1],
    7: [0, 87, 229, 146, 149, 238, 102, 21],
    10: [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45],
    13: [0, 74, 152, 176, 100, 86, 100, 106, 104, 130, 218, 206, 140, 78],
    17: [0, 43, 139, 206, 78, 43, 239, 123, 206, 214, 147, 24, 99, 150, 39, 243, 163, 136],
    30: [0, 41, 173, 145, 152, 216, 31, 179, 182, 50, 48, 110, 86, 239, 96, 222, 125, 42, 173, 226, 193, 224, 130,
      156, 37, 251, 216, 238, 40, 192, 180],
  };

  it.each(Object.keys(TABLE_A1).map(Number))('build the generator polynomial of Table A.1 for %i codewords', (n) => {
    expect(generatorPolynomial(n).map((c) => LOGS[c])).toEqual(TABLE_A1[n]);
  });

  it('give the error correction codewords of Annex I: 01234567 in version 1-M', () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    const { remainder } = polyDivide([...data, ...new Array(10).fill(0)], generatorPolynomial(10));
    expect(remainder).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it('agree with the qrcode library on error correction codewords', () => {
    let seed = 1;
    const random = () => (seed = (seed * 75) % 65537) & 0xff;
    for (const n of [7, 10, 13, 17, 22, 30]) {
      const data = Array.from({ length: 20 + n }, random);
      const { remainder } = polyDivide([...data, ...new Array(n).fill(0)], generatorPolynomial(n));
      expect(remainder).toEqual([...new ReedSolomonEncoder(n).encode(new Uint8Array(data))]);
    }
  });
});
