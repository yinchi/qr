import { longDivision, type DivisionStep } from './cyclic';

/**
 * Arithmetic on bytes in GF(2⁸), the Galois field the standard uses for Reed-Solomon codes (ISO/IEC 18004, 7.5.2). A
 * byte stands for a polynomial of degree below 8 with bit coefficients. Bytes add by XOR, and multiply as polynomials,
 * keeping the remainder after dividing by the prime modulus polynomial.
 */

/** The standard's prime modulus polynomial x⁸ + x⁴ + x³ + x² + 1, written as bits: 100011101 (7.5.2). */
export const PRIME_MODULUS = 0b1_0001_1101;

/** Number of non-zero bytes: the powers of 2 run through all of them, so 2^255 = 1. */
export const CYCLE = 255;

/** Adding (and subtracting) bytes: XOR, with no carries. */
export function add(a: number, b: number): number {
  return a ^ b;
}

/** Multiplying by 2, or x: shift left one place, and if that gives 9 bits, XOR with the modulus to get back to 8. */
export function times2(a: number, modulus = PRIME_MODULUS): number {
  const shifted = a << 1;
  return shifted & 0x100 ? shifted ^ modulus : shifted;
}

/**
 * The powers of 2 under a modulus, 2⁰ = 1, 2¹ = 2, …, until they come back to 1. Under the standard's modulus there are
 * 255 of them, every non-zero byte once; under others the cycle can be shorter.
 */
export function powersOf2(modulus = PRIME_MODULUS): number[] {
  const powers = [1];
  for (let value = times2(1, modulus); value !== 1 && powers.length < 256; value = times2(value, modulus)) {
    powers.push(value);
  }
  return powers;
}

/** POWERS[k] = 2^k, for k from 0 to 254: the exponential (antilog) table. */
export const POWERS: readonly number[] = powersOf2();

/** LOGS[a] = k where 2^k = a, for each non-zero byte a: the log table. LOGS[0] is NaN, as 0 is no power of 2. */
export const LOGS: readonly number[] = (() => {
  const logs = new Array<number>(256).fill(NaN);
  POWERS.forEach((value, k) => (logs[value] = k));
  return logs;
})();

/** 2^k for any whole number k: powers repeat every 255. */
export function exp(k: number): number {
  return POWERS[((k % CYCLE) + CYCLE) % CYCLE];
}

/** The k from 0 to 254 with 2^k = a. */
export function log(a: number): number {
  if (a < 1 || a > 255) throw new RangeError(`${a} has no logarithm`);
  return LOGS[a];
}

/** Product of two bytes, by adding their logs. */
export function multiply(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : exp(LOGS[a] + LOGS[b]);
}

/** The byte that multiplies with `a` to give 1: 2^(255 − k) for a = 2^k. */
export function inverse(a: number): number {
  return exp(CYCLE - log(a));
}

/** a ÷ b: a times the inverse of b, or subtract logs. */
export function quotient(a: number, b: number): number {
  if (b === 0) throw new RangeError('Division by zero');
  return a === 0 ? 0 : exp(LOGS[a] - LOGS[b]);
}

/** Multiplying two bytes the long way, as the polynomials they stand for. */
export interface ByteMultiplication {
  /** One shifted copy of `a` for each 1 bit of `b`, from the highest: a·x^shift. */
  partials: { shift: number; value: number }[];
  /** The partials XORed together: the product of the polynomials, up to 15 bits. */
  product: number;
  /** Long division of the product by the modulus. */
  steps: DivisionStep[];
  /** The remainder: the product as a byte. */
  result: number;
}

export function multiplyLongHand(a: number, b: number, modulus = PRIME_MODULUS): ByteMultiplication {
  const partials: ByteMultiplication['partials'] = [];
  for (let shift = 7; shift >= 0; shift--) {
    if ((b >> shift) & 1) partials.push({ shift, value: a << shift });
  }
  const product = partials.reduce((p, { value }) => p ^ value, 0);
  const { steps, remainder } = longDivision(product, modulus);
  return { partials, product, steps, result: remainder };
}

/**
 * Polynomials with byte coefficients, highest power first, as the standard writes them: [1, 3, 2] is x² + 3x + 2. The
 * data codewords of a block are the coefficients of one such polynomial, the first codeword the highest (7.5.2).
 */
export type Polynomial = readonly number[];

/** Drop leading zero coefficients, keeping at least one. */
function trim(p: Polynomial): number[] {
  const first = p.findIndex((c) => c !== 0);
  return first === -1 ? [0] : p.slice(first);
}

/** Sum of two polynomials: add (XOR) the coefficients of each power. */
export function polyAdd(p: Polynomial, q: Polynomial): number[] {
  const length = Math.max(p.length, q.length);
  const coefficient = (r: Polynomial, i: number) => r[i - (length - r.length)] ?? 0;
  return trim(Array.from({ length }, (_, i) => coefficient(p, i) ^ coefficient(q, i)));
}

/** Product of two polynomials: every term of one times every term of the other, added up. */
export function polyMultiply(p: Polynomial, q: Polynomial): number[] {
  const result = new Array<number>(p.length + q.length - 1).fill(0);
  p.forEach((a, i) => q.forEach((b, j) => (result[i + j] ^= multiply(a, b))));
  return trim(result);
}

/** One step of polynomial long division: subtract factor·x^shift times the divisor. */
export interface PolyDivisionStep {
  /** What is left before this step. */
  value: number[];
  /** The quotient's term for this step: `factor`·x^`shift`. */
  factor: number;
  shift: number;
  /** The divisor times factor·x^shift, lined up with `value`. */
  subtracted: number[];
}

/**
 * Long division of polynomials with byte coefficients. Each step divides the leading coefficient of what is left by the
 * divisor's leading coefficient, and subtracts that multiple of the divisor.
 */
export function polyDivide(
  dividend: Polynomial,
  divisor: Polynomial,
): { quotient: number[]; remainder: number[]; steps: PolyDivisionStep[] } {
  const d = trim(divisor);
  if (d.length === 1 && d[0] === 0) throw new RangeError('Division by zero');
  const value = [...dividend];
  const quotientLength = Math.max(value.length - d.length + 1, 0);
  const result = new Array<number>(quotientLength).fill(0);
  const steps: PolyDivisionStep[] = [];
  for (let i = 0; i < quotientLength; i++) {
    if (value[i] === 0) continue;
    const factor = quotient(value[i], d[0]);
    const shift = quotientLength - 1 - i;
    const subtracted = value.map((_, j) => (j >= i && j < i + d.length ? multiply(factor, d[j - i]) : 0));
    steps.push({ value: [...value], factor, shift, subtracted });
    subtracted.forEach((c, j) => (value[j] ^= c));
    result[i] = factor;
  }
  const remainder = value.slice(quotientLength);
  return { quotient: trim(result), remainder: remainder.length ? remainder : [0], steps };
}

/** The value of a polynomial at x, by Horner's rule: multiply by x and add the next coefficient. */
export function polyEvaluate(p: Polynomial, x: number): number {
  return p.reduce((value, c) => multiply(value, x) ^ c, 0);
}

/**
 * Solve linear equations with byte coefficients, `matrix` · unknowns = `rhs`, by elimination. Returns null unless there
 * is exactly one solution, so the matrix must be square.
 */
export function solveLinear(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const n = rhs.length;
  if (matrix.length !== n || matrix.some((row) => row.length !== n)) throw new RangeError('Matrix must be square');
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    const pivot = rows.findIndex((row, r) => r >= col && row[col] !== 0);
    if (pivot === -1) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = inverse(rows[col][col]);
    rows[col] = rows[col].map((c) => multiply(c, scale));
    for (let r = 0; r < n; r++) {
      const factor = rows[r][col];
      if (r !== col && factor !== 0) rows[r] = rows[r].map((c, k) => c ^ multiply(factor, rows[col][k]));
    }
  }
  return rows.map((row) => row[n]);
}

/**
 * The generator polynomial for n error correction codewords: (x − 2⁰)(x − 2¹)…(x − 2^(n−1)) (Annex A). Subtracting is
 * adding, so each factor is x + 2^i.
 */
export function generatorPolynomial(n: number): number[] {
  let g: number[] = [1];
  for (let i = 0; i < n; i++) g = polyMultiply(g, [1, exp(i)]);
  return g;
}
