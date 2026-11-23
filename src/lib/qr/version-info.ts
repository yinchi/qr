import { cyclicEncode, nearestCodeword } from './cyclic';

/** Versions that carry version information (7.10). */
export const FIRST_VERSION_WITH_INFO = 7;

/** G(x) = x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1, generator of the (18, 6) Golay code (ISO/IEC 18004, D.2). */
export const VERSION_INFO_GENERATOR = 0b1_1111_0010_0101;

/** Bits in the version information: 6 data bits (the version number) and 12 error correction bits. */
export const VERSION_INFO_BITS = 18;
export const VERSION_DATA_BITS = 6;

/** The 18-bit version information: the 6-bit version number, then 12 error correction bits. Not masked (7.10). */
export function versionInfoBits(version: number): number {
  return cyclicEncode(version, VERSION_INFO_GENERATOR);
}

/** The 34 valid version information codewords, for versions 7–40 (Table D.1). */
export const VERSION_CODEWORDS: readonly { version: number; bits: number }[] = Array.from({ length: 34 }, (_, i) => ({
  version: i + FIRST_VERSION_WITH_INFO,
  bits: versionInfoBits(i + FIRST_VERSION_WITH_INFO),
}));

/** Decode version information as the standard does (D.3): take the closest valid codeword, if it is within 3 bits. */
export function decodeVersionInfo(received: number): { version: number; distance: number; ok: boolean } {
  const { index, distance } = nearestCodeword(received, VERSION_CODEWORDS.map((c) => c.bits));
  return { version: VERSION_CODEWORDS[index].version, distance, ok: distance <= 3 };
}
