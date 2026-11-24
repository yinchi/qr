import { buildBitstream, detectMode, maxCharacters, type Mode } from '../../lib/qr/modes';

/**
 * Chapter 5's running example: one version 1-M block, shared by the encoder and decoder widgets, so that text typed into
 * the encoder is what the decoder repairs. It starts as the standard's own example, 01234567 (Annex I).
 */
export const VERSION = 1;
export const LEVEL = 'M';
/** Error correction bytes in a version 1-M block. */
export const EC_BYTES = 10;
/** Misdecode protection for version 1-M (7.5.1). */
export const PROTECTION = 2;

interface Example {
  text: string;
  mode: Mode;
  /** The 16 data bytes, from the bitstream of chapter 3. */
  data: number[];
  /** Bits of the data bytes that encode the text (mode indicator, count and characters); the rest is padding. */
  textBits: number;
}

/** The example for `text`, or null if it doesn't fit in version 1-M. */
function encode(text: string): Example | null {
  const mode = detectMode(text);
  const stream = buildBitstream(mode, text, VERSION, LEVEL);
  return stream.fits ? { text, mode, data: stream.codewords, textBits: stream.segmentBits } : null;
}

export const example: Example = $state(encode('01234567')!);

/** Use `text` for the example if it fits; returns whether it did. */
export function setExampleText(text: string): boolean {
  const next = encode(text);
  if (next) Object.assign(example, next);
  return next !== null;
}

/** The most characters of `text`'s mode that fit in version 1-M. */
export function capacityFor(text: string): { mode: Mode; max: number } {
  const mode = detectMode(text);
  return { mode, max: maxCharacters(mode, VERSION, LEVEL) };
}
