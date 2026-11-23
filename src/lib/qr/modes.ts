import { dataCodewords, type EcLevel } from './ec';
import { MAX_VERSION, MIN_VERSION } from './layout';

/** The four modes for encoding data (ISO/IEC 18004, 7.3). */
export type Mode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji';
export const MODES: readonly Mode[] = ['numeric', 'alphanumeric', 'byte', 'kanji'];

/** Mode indicators (Table 2). */
export const MODE_INDICATOR: Record<Mode, number> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
  kanji: 0b1000,
};
export const ECI_INDICATOR = 0b0111;
/** ECI assignment number for UTF-8 (AIM ECI specification). */
export const ECI_UTF8 = 26;
export const MODE_INDICATOR_BITS = 4;

/** Bits in the character count indicator, which grows with the version (Table 3). */
export function countBits(mode: Mode, version: number): number {
  const range = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16], kanji: [8, 10, 12] }[mode][range];
}

/** The 45 characters of alphanumeric mode, in order of their values 0–44 (Table 5). */
export const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** A group of input characters encoded together, as `width` bits holding `value`. */
export interface Group {
  chars: string;
  value: number;
  width: number;
  /** Byte mode: the bytes. Kanji mode: the Shift JIS code. */
  codes?: number[];
}

/** Numeric mode (7.4.3): groups of three digits in 10 bits; a final one or two digits in 4 or 7 bits. */
export function encodeNumeric(digits: string): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    const chars = digits.slice(i, i + 3);
    groups.push({ chars, value: Number(chars), width: [0, 4, 7, 10][chars.length] });
  }
  return groups;
}

/** Alphanumeric mode (7.4.4): pairs as 45 × first + second in 11 bits; a final single character in 6 bits. */
export function encodeAlphanumeric(text: string): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < text.length; i += 2) {
    const chars = text.slice(i, i + 2);
    const values = [...chars].map((c) => ALPHANUMERIC_CHARS.indexOf(c));
    groups.push(
      values.length === 2
        ? { chars, value: values[0] * 45 + values[1], width: 11 }
        : { chars, value: values[0], width: 6 },
    );
  }
  return groups;
}

/**
 * The character set byte mode uses for some text: ISO/IEC 8859-1, the standard's default (7.3.5), when every
 * character is in it, otherwise UTF-8, which needs an ECI header to say so (7.4.2).
 */
export function byteCharset(text: string): 'latin1' | 'utf8' {
  return [...text].every((c) => c.codePointAt(0)! <= 0xff) ? 'latin1' : 'utf8';
}

/** Byte mode (7.4.5): 8 bits per byte. One group per character, which may be several bytes in UTF-8. */
export function encodeBytes(text: string): Group[] {
  const latin1 = byteCharset(text) === 'latin1';
  const encoder = new TextEncoder();
  return [...text].map((chars) => {
    const codes = latin1 ? [chars.codePointAt(0)!] : [...encoder.encode(chars)];
    return { chars, value: codes.reduce((v, b) => v * 256 + b, 0), width: 8 * codes.length, codes };
  });
}

/** Number of bytes byte mode stores for some text: what its character count indicator counts. */
export function byteLength(text: string): number {
  return encodeBytes(text).reduce((n, g) => n + g.codes!.length, 0);
}

let shiftJisTable: Map<string, number> | null = null;

/**
 * The Shift JIS code of a character, if kanji mode can encode it: codes 8140–9FFC and E040–EBBF (7.4.6), which hold
 * the double-byte characters of JIS X 0208 (kanji, kana and symbols). The table is built once, from the browser's own
 * Shift JIS decoder, rather than shipped with the page.
 */
export function shiftJis(char: string): number | null {
  if (!shiftJisTable) {
    shiftJisTable = new Map();
    const decoder = new TextDecoder('shift_jis');
    for (const [from, to] of [
      [0x81, 0x9f],
      [0xe0, 0xeb],
    ]) {
      for (let lead = from; lead <= to; lead++) {
        for (let trail = 0x40; trail <= 0xfc; trail++) {
          if (trail === 0x7f) continue;
          const code = (lead << 8) | trail;
          if (code > 0x9ffc && code < 0xe040) continue;
          if (code > 0xebbf) continue;
          const decoded = decoder.decode(new Uint8Array([lead, trail]));
          // Keep the first code for each character: later duplicates are vendor extensions.
          if (decoded.length === 1 && decoded !== '�' && !shiftJisTable.has(decoded)) {
            shiftJisTable.set(decoded, code);
          }
        }
      }
    }
  }
  return shiftJisTable.get(char) ?? null;
}

/** Kanji mode (7.4.6): subtract 8140 or C140 from the Shift JIS code, then (high byte × C0) + low byte, in 13 bits. */
export function kanjiValue(code: number): number {
  const shifted = code - (code <= 0x9ffc ? 0x8140 : 0xc140);
  return (shifted >> 8) * 0xc0 + (shifted & 0xff);
}

export function encodeKanji(text: string): Group[] {
  return [...text].map((chars) => {
    const code = shiftJis(chars) ?? 0;
    return { chars, value: kanjiValue(code), width: 13, codes: [code] };
  });
}

/** Characters of `text` that a mode can't encode. */
export function unencodable(mode: Mode, text: string): string[] {
  const chars = [...text];
  switch (mode) {
    case 'numeric':
      return chars.filter((c) => c < '0' || c > '9');
    case 'alphanumeric':
      return chars.filter((c) => !ALPHANUMERIC_CHARS.includes(c));
    case 'kanji':
      return chars.filter((c) => shiftJis(c) === null);
    case 'byte':
      return [];
  }
}

/** The mode with the smallest character set that covers all of `text`. */
export function detectMode(text: string): Mode {
  if (unencodable('numeric', text).length === 0) return 'numeric';
  if (unencodable('alphanumeric', text).length === 0) return 'alphanumeric';
  if (text.length > 0 && unencodable('kanji', text).length === 0) return 'kanji';
  return 'byte';
}

export function encodeGroups(mode: Mode, text: string): Group[] {
  return { numeric: encodeNumeric, alphanumeric: encodeAlphanumeric, byte: encodeBytes, kanji: encodeKanji }[mode](text);
}

/** What the character count indicator counts: characters, except bytes in byte mode. */
export function characterCount(mode: Mode, text: string): number {
  return mode === 'byte' ? byteLength(text) : [...text].length;
}

/** One labelled run of bits in the bitstream. */
export interface Part {
  kind: 'eci' | 'mode' | 'count' | 'data' | 'terminator' | 'padding' | 'pad';
  value: number;
  width: number;
  /** For data: the characters the bits encode. */
  chars?: string;
}

/** Whether the text needs an ECI header for UTF-8 in this mode. */
export function needsEci(mode: Mode, text: string): boolean {
  return mode === 'byte' && byteCharset(text) === 'utf8';
}

/** The parts of one segment: optional ECI header, mode indicator, character count, then the data (7.4.1). */
export function segmentParts(mode: Mode, text: string, version: number): Part[] {
  const parts: Part[] = [];
  if (needsEci(mode, text)) {
    // ECI assignment numbers up to 127 take one codeword, 0bbbbbbb (Table 4).
    parts.push({ kind: 'eci', value: (ECI_INDICATOR << 8) | ECI_UTF8, width: 12 });
  }
  parts.push({ kind: 'mode', value: MODE_INDICATOR[mode], width: MODE_INDICATOR_BITS });
  parts.push({ kind: 'count', value: characterCount(mode, text), width: countBits(mode, version) });
  for (const group of encodeGroups(mode, text)) {
    parts.push({ kind: 'data', value: group.value, width: group.width, chars: group.chars });
  }
  return parts;
}

export const PAD_CODEWORDS = [0b11101100, 0b00010001] as const;

export interface Bitstream {
  parts: Part[];
  /** The data codewords, ready for error correction. */
  codewords: number[];
  /** Bits available for data at this version and level. */
  capacityBits: number;
  /** Bits used by the segment, before the terminator and padding. */
  segmentBits: number;
  fits: boolean;
}

/**
 * The complete data bit stream for one segment (7.4.10): the segment, a terminator of up to four 0 bits, 0 bits up to
 * the next codeword boundary, then the pad codewords 11101100 and 00010001 in turn until the capacity is filled.
 */
export function buildBitstream(mode: Mode, text: string, version: number, level: EcLevel): Bitstream {
  const capacityBits = 8 * dataCodewords(version, level);
  const parts = segmentParts(mode, text, version);
  const segmentBits = parts.reduce((n, p) => n + p.width, 0);
  const countPart = parts.find((p) => p.kind === 'count')!;
  const fits = segmentBits <= capacityBits && countPart.value < 2 ** countPart.width;
  if (!fits) return { parts, codewords: [], capacityBits, segmentBits, fits };

  const terminator = Math.min(4, capacityBits - segmentBits);
  if (terminator) parts.push({ kind: 'terminator', value: 0, width: terminator });
  const used = segmentBits + terminator;
  const padding = (8 - (used % 8)) % 8;
  if (padding) parts.push({ kind: 'padding', value: 0, width: padding });
  for (let i = 0; used + padding + 8 * i < capacityBits; i++) {
    parts.push({ kind: 'pad', value: PAD_CODEWORDS[i % 2], width: 8 });
  }

  const bits = parts.flatMap((p) => Array.from({ length: p.width }, (_, k) => Math.floor(p.value / 2 ** (p.width - 1 - k)) % 2));
  const codewords = Array.from({ length: capacityBits / 8 }, (_, i) =>
    bits.slice(8 * i, 8 * i + 8).reduce((v, b) => v * 2 + b, 0),
  );
  return { parts, codewords, capacityBits, segmentBits, fits };
}

/** The most characters a version and level can hold in one segment of a mode (Table 7). */
export function maxCharacters(mode: Mode, version: number, level: EcLevel): number {
  const bits = 8 * dataCodewords(version, level) - MODE_INDICATOR_BITS - countBits(mode, version);
  const countLimit = 2 ** countBits(mode, version) - 1;
  const fit = {
    numeric: 3 * Math.floor(bits / 10) + (bits % 10 >= 7 ? 2 : bits % 10 >= 4 ? 1 : 0),
    alphanumeric: 2 * Math.floor(bits / 11) + (bits % 11 >= 6 ? 1 : 0),
    byte: Math.floor(bits / 8),
    kanji: Math.floor(bits / 13),
  }[mode];
  return Math.min(fit, countLimit);
}

/** The smallest version that holds `text` in `mode` at `level`, or null if none does. */
export function smallestVersionFor(mode: Mode, text: string, level: EcLevel): number | null {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    if (buildBitstream(mode, text, version, level).fits) return version;
  }
  return null;
}
