import { MAX_VERSION, MIN_VERSION, dataModules } from './layout';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';
export const EC_LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];

/** Approximate share of the codewords that can be restored at each level (ISO/IEC 18004, Table 8). */
export const RECOVERY_PERCENT: Record<EcLevel, number> = { L: 7, M: 15, Q: 25, H: 30 };

// Error correction codewords per block, and number of blocks, for versions 1–40 (Table 9). Every block in a symbol has
// the same number of error correction codewords; when the codewords don't divide evenly, the last blocks are one
// codeword longer.
// prettier-ignore
const EC_PER_BLOCK: Record<EcLevel, readonly number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
// prettier-ignore
const BLOCKS: Record<EcLevel, readonly number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/**
 * Misdecode protection codewords p (7.5.1). In the smallest symbols, p error correction codewords only detect errors,
 * so that a badly damaged symbol is rejected rather than "corrected" to the wrong data.
 */
export function misdecodeProtection(version: number, level: EcLevel): number {
  if (version === 1) return { L: 3, M: 2, Q: 1, H: 1 }[level];
  if (version === 2 && level === 'L') return 2;
  if (version === 3 && level === 'L') return 1;
  return 0;
}

/** Total codewords in a symbol (Table 1): the data area's modules, 8 per codeword, ignoring the remainder bits. */
export function totalCodewords(version: number): number {
  return Math.floor(dataModules(version) / 8);
}

/** A group of identical blocks: Table 9's "(c, k, r)" with the number of such blocks. */
export interface BlockGroup {
  count: number;
  /** Codewords in each block (c). */
  total: number;
  /** Data codewords in each block (k). */
  data: number;
  /** Codewords each block can correct (r). */
  correctable: number;
}

export interface EcInfo {
  version: number;
  level: EcLevel;
  totalCodewords: number;
  dataCodewords: number;
  ecCodewords: number;
  ecPerBlock: number;
  blocks: BlockGroup[];
  /** Error correction codewords per block used only to detect errors (p). */
  misdecodeProtection: number;
  /** Damaged codewords the whole symbol can correct, at most r in each block. */
  correctableCodewords: number;
}

export function ecInfo(version: number, level: EcLevel): EcInfo {
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`QR version must be an integer from ${MIN_VERSION} to ${MAX_VERSION}, got ${version}`);
  }
  const total = totalCodewords(version);
  const ecPerBlock = EC_PER_BLOCK[level][version - 1];
  const count = BLOCKS[level][version - 1];
  const p = misdecodeProtection(version, level);
  const correctable = Math.floor((ecPerBlock - p) / 2);
  const shortLength = Math.floor(total / count);
  const longBlocks = total % count;
  const group = (n: number, length: number): BlockGroup => ({
    count: n,
    total: length,
    data: length - ecPerBlock,
    correctable,
  });
  const blocks = [group(count - longBlocks, shortLength)];
  if (longBlocks) blocks.push(group(longBlocks, shortLength + 1));
  return {
    version,
    level,
    totalCodewords: total,
    dataCodewords: total - ecPerBlock * count,
    ecCodewords: ecPerBlock * count,
    ecPerBlock,
    blocks,
    misdecodeProtection: p,
    correctableCodewords: correctable * count,
  };
}

export function dataCodewords(version: number, level: EcLevel): number {
  return ecInfo(version, level).dataCodewords;
}

/** The smallest version whose data codewords hold `bytes` bytes at this level, or null if none does. */
export function smallestVersion(bytes: number, level: EcLevel): number | null {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    if (dataCodewords(version, level) >= bytes) return version;
  }
  return null;
}
