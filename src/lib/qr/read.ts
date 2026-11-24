import { ecInfo, misdecodeProtection, type EcLevel } from './ec';
import { decodeFormatInfo } from './format';
import { fixedLayout, formatInfoPositions, MAX_VERSION, MIN_VERSION, versionInfoPositions, type Position } from './layout';
import { MASK_CONDITIONS } from './masks';
import { parseBitstream, type ParsedBitstream } from './modes';
import { decode, deinterleave, type Block, type Decoding } from './rs';
import { dataPath } from './symbol';
import { decodeVersionInfo, FIRST_VERSION_WITH_INFO } from './version-info';

/**
 * Reading a QR code back, as the standard's reference decoder does once it has found the grid of modules (section 12,
 * from step j): format information, version, unmasking, codewords, error correction, then the text.
 */

/** One copy of the format information, as read, and the valid string nearest to it. */
export interface FormatCopy {
  bits: number;
  level: EcLevel;
  mask: number;
  /** Bits that differ from the nearest valid string. */
  distance: number;
  /** Whether that is close enough to correct: at most 3 bits. */
  ok: boolean;
}

/** One copy of the version information, as read, and the valid string nearest to it. */
export interface VersionCopy {
  bits: number;
  version: number;
  distance: number;
  ok: boolean;
}

/** One block of codewords as read, and what the Reed-Solomon decoder made of it. */
export interface BlockReading {
  received: Block;
  decoding: Decoding;
}

/** The step at which reading gave up. */
export type ReadFailure = 'format' | 'version' | 'blocks' | 'bitstream';

export interface SymbolReading {
  size: number;
  /** Both copies of the format information: first the one around the top-left finder pattern. */
  formatCopies: [FormatCopy, FormatCopy];
  /** The copy used: the first if it can be corrected, else the second, else null. */
  formatUsed: 0 | 1 | null;
  /** The version the size suggests. */
  sizeVersion: number;
  /** From version 7, both copies of the version information: first the block beside the top-right finder pattern. */
  versionCopies: VersionCopy[];
  versionUsed: 0 | 1 | null;
  /** The version read, if any: from the version information from version 7, else from the size. */
  version: number | null;
  /** The codewords along the data path after unmasking, in sequence order, if the format and version were read. */
  codewords: number[] | null;
  blocks: BlockReading[] | null;
  /** The corrected data codewords of all the blocks in turn, if every block could be corrected. */
  data: number[] | null;
  bitstream: ParsedBitstream | null;
  failure: ReadFailure | null;
}

/** The number whose bit i is the module at `positions[i]`. */
function readBits(dark: readonly boolean[], size: number, positions: readonly Position[]): number {
  return positions.reduce((bits, [row, col], i) => bits + (dark[row * size + col] ? 2 ** i : 0), 0);
}

/** The codewords along the data path, with the mask undone (section 12, steps y and z). Remainder bits are dropped. */
export function readCodewords(dark: readonly boolean[], version: number, mask: number): number[] {
  const layout = fixedLayout(version);
  const condition = MASK_CONDITIONS[mask];
  const path = dataPath(layout);
  const codewords = new Array<number>(Math.floor(path.length / 8)).fill(0);
  for (let k = 0; k < 8 * codewords.length; k++) {
    const [row, col] = path[k];
    if (dark[row * layout.size + col] !== condition(row, col)) codewords[k >> 3] |= 1 << (7 - (k & 7));
  }
  return codewords;
}

/** Read a QR code from its modules, row by row, assuming its grid has already been found. */
export function readSymbol(dark: readonly boolean[], size: number): SymbolReading {
  const sizeVersion = (size - 17) / 4;
  if (!Number.isInteger(sizeVersion) || sizeVersion < MIN_VERSION || sizeVersion > MAX_VERSION) {
    throw new RangeError(`No QR code version is ${size} modules wide`);
  }

  // Step j: the format information around the top-left finder pattern, or failing that the other copy.
  const { first, second } = formatInfoPositions(sizeVersion);
  const formatCopies = [first, second].map((positions) => {
    const bits = readBits(dark, size, positions);
    return { bits, ...decodeFormatInfo(bits) };
  }) as [FormatCopy, FormatCopy];
  const formatUsed = formatCopies[0].ok ? 0 : formatCopies[1].ok ? 1 : null;

  // Step g: up to version 6 the size gives the version; from 7, the version information beside the top-right finder
  // pattern, or failing that the block beside the bottom-left one.
  let versionCopies: VersionCopy[] = [];
  let versionUsed: 0 | 1 | null = null;
  let version: number | null = sizeVersion;
  if (sizeVersion >= FIRST_VERSION_WITH_INFO) {
    const { topRight, bottomLeft } = versionInfoPositions(sizeVersion);
    versionCopies = [topRight, bottomLeft].map((positions) => {
      const bits = readBits(dark, size, positions);
      return { bits, ...decodeVersionInfo(bits) };
    });
    versionUsed = versionCopies[0].ok ? 0 : versionCopies[1].ok ? 1 : null;
    version = versionUsed === null ? null : versionCopies[versionUsed].version;
  }

  const reading: SymbolReading = {
    size,
    formatCopies,
    formatUsed,
    sizeVersion,
    versionCopies,
    versionUsed,
    version,
    codewords: null,
    blocks: null,
    data: null,
    bitstream: null,
    failure: null,
  };
  if (formatUsed === null) return { ...reading, failure: 'format' };
  // A version that doesn't match the size means sampling the wrong grid, which can't give a valid code.
  if (version !== sizeVersion) return { ...reading, failure: 'version' };

  // Steps y to bb: undo the mask, read the codewords, sort them into blocks and correct each one.
  const { level, mask } = formatCopies[formatUsed];
  const codewords = readCodewords(dark, version, mask);
  const n = ecInfo(version, level).ecPerBlock;
  const protection = misdecodeProtection(version, level);
  const blocks = deinterleave(codewords, version, level).map((received) => ({
    received,
    decoding: decode([...received.data, ...received.ec], n, { protection }),
  }));
  if (blocks.some((b) => !b.decoding.corrected)) return { ...reading, codewords, blocks, failure: 'blocks' };

  // Steps cc to ee: the data codewords of the blocks in turn, then the segments.
  const data = blocks.flatMap((b) => b.decoding.corrected!.slice(0, b.received.data.length));
  const bitstream = parseBitstream(data, version);
  return { ...reading, codewords, blocks, data, bitstream, failure: bitstream.error ? 'bitstream' : null };
}
