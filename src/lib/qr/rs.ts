import { ecInfo, type EcLevel } from './ec';
import {
  exp,
  generatorPolynomial,
  multiply,
  polyDivide,
  polyEvaluate,
  polyMultiply,
  solveLinear,
  type Polynomial,
} from './gf256';

/**
 * Reed-Solomon codes (ISO/IEC 18004, 7.5.2 and Annex B). A block of codewords is a polynomial with byte coefficients,
 * the first codeword the highest power. The error correction codewords make it a multiple of the generator polynomial
 * g(x) = (x − α⁰)(x − α¹)…(x − α^(n−1)), so it is 0 at each of α⁰ … α^(n−1).
 */

/** The n error correction codewords for a block of data codewords: the remainder of data · xⁿ ÷ g(x) (7.5.2). */
export function errorCorrectionCodewords(data: readonly number[], n: number): number[] {
  return polyDivide([...data, ...new Array<number>(n).fill(0)], generatorPolynomial(n)).remainder;
}

/** The power of x whose coefficient is codeword `index` of a block of `length`: the last codeword is x⁰. */
export function powerOf(index: number, length: number): number {
  return length - 1 - index;
}

/** The syndromes S_i = R(α^i) of a received block R(x), for i from 0 to n − 1 (Annex B). All 0 for a valid block. */
export function syndromes(block: Polynomial, n: number): number[] {
  return Array.from({ length: n }, (_, i) => polyEvaluate(block, exp(i)));
}

/**
 * Misdecode protection p for a decoder correcting `erasures` erasures in a block with n error correction codewords
 * (7.5.1): Table 9's p, but 3 once more than half of the n codewords are erased.
 */
export function protectionFor(p: number, n: number, erasures: number): number {
  return erasures > n / 2 ? 3 : p;
}

export interface DecodeOptions {
  /** Indexes of codewords known to be damaged, such as unreadable ones. Their values are ignored. */
  erasures?: readonly number[];
  /** Misdecode protection p (7.5.1): error correction codewords kept back to detect errors, not correct them. */
  protection?: number;
}

/** One error count the decoder tried, and the error locator it found for it, if any. */
export interface LocatorTrial {
  count: number;
  /** σ(x) for this many errors, highest power first, or null if the equations had no single solution. */
  locator: number[] | null;
  /** Whether σ(x) fits every reduced syndrome. */
  fits: boolean;
}

/**
 * Why decoding failed: more erasures than the code can take, no error locator that fits with at most `maxErrors`
 * errors, or a locator without that many roots among the block's codewords.
 */
export type DecodeFailure = 'erasures' | 'errors' | 'roots';

export interface Decoding {
  syndromes: number[];
  /** Indexes of the erased codewords, in order. */
  erasures: number[];
  /** The syndromes with each erasure's part cancelled out: one fewer for each erasure. */
  reduced: number[];
  /** The most errors at unknown positions the decoder may correct: ⌊(n − p − e) / 2⌋. */
  maxErrors: number;
  /** Error counts tried, from 0 up, until a locator fits. */
  trials: LocatorTrial[];
  /** The error locator σ(x) that fits: its roots are α^j for the powers j of the errors. */
  locator: number[] | null;
  /** Indexes of the codewords where σ(x) is 0: the errors. */
  errors: number[];
  /** What to add to each damaged codeword, erasures first, then errors. */
  corrections: { index: number; value: number }[];
  /** The repaired block, or null if the decoder gave up. */
  corrected: number[] | null;
  failure: DecodeFailure | null;
}

/**
 * Error locator σ(x) = x^t + σ₁x^(t−1) + … + σ_t for t errors, from the first 2t syndromes: each syndrome after the
 * first t is σ₁ times the one before, plus σ₂ times the one before that, and so on (Annex B, step ii).
 */
function locatorFor(s: readonly number[], t: number): number[] | null {
  const matrix = Array.from({ length: t }, (_, i) => Array.from({ length: t }, (_, k) => s[i + t - 1 - k]));
  const sigma = solveLinear(matrix, s.slice(t, 2 * t));
  return sigma && [1, ...sigma];
}

/** Whether every syndrome after the first t follows from the t before it, as σ(x) says. */
function fitsAll(s: readonly number[], locator: readonly number[]): boolean {
  const t = locator.length - 1;
  for (let i = 0; i + t < s.length; i++) {
    if (locator.reduce((sum, c, k) => sum ^ multiply(c, s[i + t - k]), 0) !== 0) return false;
  }
  return true;
}

/**
 * Decode a block with n error correction codewords by the method of Annex B: syndromes, then an error locator from
 * linear equations, then its roots by trying every codeword, then the error values from more linear equations. Erasures
 * are cancelled out of the syndromes first, which uses up one syndrome each.
 */
export function decode(received: readonly number[], n: number, options: DecodeOptions = {}): Decoding {
  const length = received.length;
  const locatorOf = (index: number) => exp(powerOf(index, length));
  const s = syndromes(received, n);
  const erasures = [...new Set(options.erasures ?? [])].sort((a, b) => a - b);
  const e = erasures.length;

  // For an erasure at α^j, S_(i+1) + α^j S_i cancels its part of the syndromes. Γ(x), the product of (x − α^j) over
  // the erasures, does this for all of them at once.
  const gamma = erasures.reduce<number[]>((g, index) => polyMultiply(g, [1, locatorOf(index)]), [1]);
  const reduced = Array.from({ length: Math.max(n - e, 0) }, (_, i) =>
    gamma.reduce((sum, c, m) => sum ^ multiply(c, s[i + e - m]), 0),
  );

  const maxErrors = Math.floor((n - (options.protection ?? 0) - e) / 2);
  const result: Decoding = {
    syndromes: s,
    erasures,
    reduced,
    maxErrors,
    trials: [],
    locator: null,
    errors: [],
    corrections: [],
    corrected: null,
    failure: null,
  };
  if (maxErrors < 0) return { ...result, failure: 'erasures' };

  // The fewest errors that explain the syndromes.
  for (let t = 0; t <= maxErrors; t++) {
    const locator = t === 0 ? [1] : locatorFor(reduced, t);
    const fits = locator !== null && fitsAll(reduced, locator);
    result.trials.push({ count: t, locator, fits });
    if (fits) {
      result.locator = locator;
      break;
    }
  }
  if (!result.locator) return { ...result, failure: 'errors' };

  // Try every codeword: σ(α^j) = 0 marks an error at power j.
  const locator = result.locator;
  result.errors = Array.from({ length }, (_, index) => index).filter(
    (index) => !erasures.includes(index) && polyEvaluate(locator, locatorOf(index)) === 0,
  );
  if (result.errors.length !== locator.length - 1) return { ...result, failure: 'roots' };

  // With every position known, S_i = Σ E_k (α^(j_k))^i is linear in the error values E_k (Annex B, step iii).
  const positions = [...erasures, ...result.errors];
  const values = solveLinear(
    positions.map((_, i) => positions.map((index) => exp(i * powerOf(index, length)))),
    s.slice(0, positions.length),
  );
  if (!values) return { ...result, failure: 'roots' };
  result.corrections = positions.map((index, k) => ({ index, value: values[k] }));
  const corrected = [...received];
  for (const { index, value } of result.corrections) corrected[index] ^= value;
  if (syndromes(corrected, n).some((v) => v !== 0)) return { ...result, failure: 'errors' };
  return { ...result, corrected };
}

/** A block of codewords: its data, then its error correction. */
export interface Block<T = number> {
  data: T[];
  ec: T[];
}

/**
 * Split the data codewords into blocks as Table 9 gives for the version and level, shortest blocks first, and add each
 * block's error correction codewords (7.6, steps 1 and 2).
 */
export function encodeBlocks(data: readonly number[], version: number, level: EcLevel): Block[] {
  const info = ecInfo(version, level);
  if (data.length !== info.dataCodewords) {
    throw new RangeError(`Version ${version}-${level} has ${info.dataCodewords} data codewords, got ${data.length}`);
  }
  const blocks: Block[] = [];
  let offset = 0;
  for (const group of info.blocks) {
    for (let b = 0; b < group.count; b++) {
      const blockData = data.slice(offset, offset + group.data);
      offset += group.data;
      blocks.push({ data: blockData, ec: errorCorrectionCodewords(blockData, info.ecPerBlock) });
    }
  }
  return blocks;
}

/**
 * The final codeword sequence (7.6, step 3): the first data codeword of each block in turn, then the second, and so on,
 * then the error correction codewords the same way. Longer blocks' extra data codewords come last among the data.
 */
export function interleave<T>(blocks: readonly Block<T>[]): T[] {
  const sequence: T[] = [];
  for (const part of ['data', 'ec'] as const) {
    const longest = Math.max(0, ...blocks.map((block) => block[part].length));
    for (let i = 0; i < longest; i++) {
      for (const block of blocks) if (i < block[part].length) sequence.push(block[part][i]);
    }
  }
  return sequence;
}

/** Sort a symbol's codeword sequence back into its blocks, as a decoder does (section 12, step aa): undoes `interleave`. */
export function deinterleave<T>(sequence: readonly T[], version: number, level: EcLevel): Block<T>[] {
  const info = ecInfo(version, level);
  if (sequence.length !== info.totalCodewords) {
    throw new RangeError(`Version ${version} has ${info.totalCodewords} codewords, got ${sequence.length}`);
  }
  const blocks: Block<T>[] = info.blocks.flatMap((group) =>
    Array.from({ length: group.count }, () => ({ data: [] as T[], ec: [] as T[] })),
  );
  const lengths = info.blocks.flatMap((group) => new Array<number>(group.count).fill(group.data));
  let next = 0;
  for (const part of ['data', 'ec'] as const) {
    const length = (b: number) => (part === 'data' ? lengths[b] : info.ecPerBlock);
    const longest = Math.max(...blocks.map((_, b) => length(b)));
    for (let i = 0; i < longest; i++) {
      blocks.forEach((block, b) => i < length(b) && block[part].push(sequence[next++]));
    }
  }
  return blocks;
}
