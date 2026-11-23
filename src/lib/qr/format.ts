import { cyclicEncode, nearestCodeword } from './cyclic';
import { EC_LEVELS, type EcLevel } from './ec';

/** The two bits that record the error correction level (Table 12). Note they are not in L, M, Q, H order. */
export const EC_LEVEL_BITS: Record<EcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/** G(x) = x^10 + x^8 + x^5 + x^4 + x^2 + x + 1, generator of the (15, 5) BCH code (ISO/IEC 18004, C.2). */
export const FORMAT_INFO_GENERATOR = 0b101_0011_0111;

/** XORed into the encoded format information so that it is never all zeros (C.2). */
export const FORMAT_INFO_MASK = 0b101_0100_0001_0010;

export const FORMAT_INFO_BITS = 15;
export const FORMAT_DATA_BITS = 5;

/** The 5 data bits: the error correction level (2 bits), then the mask pattern reference (3 bits). */
export function formatData(level: EcLevel, mask: number): number {
  return (EC_LEVEL_BITS[level] << 3) | mask;
}

/** The 15 bits stored in the symbol: data bits and BCH check bits, XORed with the format information mask. */
export function formatInfoBits(level: EcLevel, mask: number): number {
  return cyclicEncode(formatData(level, mask), FORMAT_INFO_GENERATOR) ^ FORMAT_INFO_MASK;
}

/** The 32 valid format information codewords, as stored in the symbol (Table C.1). */
export const FORMAT_CODEWORDS: readonly { level: EcLevel; mask: number; bits: number }[] = EC_LEVELS.flatMap((level) =>
  Array.from({ length: 8 }, (_, mask) => ({ level, mask, bits: formatInfoBits(level, mask) })),
);

/** Decode format information as the standard does (C.3): take the closest valid codeword, if it is within 3 bits. */
export function decodeFormatInfo(received: number): { level: EcLevel; mask: number; distance: number; ok: boolean } {
  const { index, distance } = nearestCodeword(received, FORMAT_CODEWORDS.map((c) => c.bits));
  const { level, mask } = FORMAT_CODEWORDS[index];
  return { level, mask, distance, ok: distance <= 3 };
}
