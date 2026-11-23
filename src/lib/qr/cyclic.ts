/** Number of bits needed to write `n` in binary (0 for 0). */
export function bitLength(n: number): number {
  return n === 0 ? 0 : 32 - Math.clz32(n);
}

/**
 * Systematic encoding for a (shortened) cyclic code: append the remainder of data·x^d divided by `generator`, a
 * polynomial of degree d over GF(2) written as bits. QR codes use this for the (15, 5) BCH code that protects the
 * format information and the (18, 6) Golay code that protects the version information.
 */
export function cyclicEncode(data: number, generator: number): number {
  const degree = bitLength(generator) - 1;
  let remainder = data << degree;
  for (let bit = bitLength(remainder) - 1; bit >= degree; bit--) {
    if (remainder & (1 << bit)) remainder ^= generator << (bit - degree);
  }
  return (data << degree) | remainder;
}

/** G(x) = x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1, generator of the (18, 6) Golay code (ISO/IEC 18004, D.2). */
export const VERSION_INFO_GENERATOR = 0b1_1111_0010_0101;

/** The 18-bit version information: the 6-bit version number, then 12 error correction bits. Not masked (7.10). */
export function versionInfoBits(version: number): number {
  return cyclicEncode(version, VERSION_INFO_GENERATOR);
}
