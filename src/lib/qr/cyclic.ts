/** Number of bits needed to write `n` in binary (0 for 0). */
export function bitLength(n: number): number {
  return n === 0 ? 0 : 32 - Math.clz32(n);
}

/** Number of 1 bits in `n`. */
export function popCount(n: number): number {
  let count = 0;
  for (let rest = n >>> 0; rest; rest &= rest - 1) count++;
  return count;
}

/** Number of bit positions in which `a` and `b` differ. */
export function hammingDistance(a: number, b: number): number {
  return popCount(a ^ b);
}

/** One step of long division over GF(2): XOR the generator, shifted under the leading 1, into the running value. */
export interface DivisionStep {
  /** The running value before this step. */
  value: number;
  /** The generator shifted left so its leading 1 lines up with the leading 1 of `value`. */
  shifted: number;
  /** How far the generator was shifted. */
  shift: number;
}

export interface Division {
  /** The data with `degree` zero bits appended: data·x^degree. */
  dividend: number;
  /** Width of the dividend in bits: the data bits plus the degree of the generator. */
  width: number;
  /** Degree of the generator: the number of check bits. */
  degree: number;
  steps: DivisionStep[];
  remainder: number;
}

/**
 * Long division of `dividend` by `divisor`, both polynomials over GF(2) written as bits, step by step: XOR the divisor
 * in under each leading 1 until fewer bits are left than the divisor has.
 */
export function longDivision(dividend: number, divisor: number): { steps: DivisionStep[]; remainder: number } {
  const degree = bitLength(divisor) - 1;
  const steps: DivisionStep[] = [];
  let value = dividend;
  while (bitLength(value) > degree) {
    const shift = bitLength(value) - 1 - degree;
    const shifted = divisor * 2 ** shift;
    steps.push({ value, shifted, shift });
    value ^= shifted;
  }
  return { steps, remainder: value };
}

/**
 * Long division of data·x^d by `generator` (a polynomial of degree d over GF(2), written as bits), step by step.
 * `dataBits` fixes how many bits the data has, including leading zeros.
 */
export function divide(data: number, dataBits: number, generator: number): Division {
  const degree = bitLength(generator) - 1;
  const dividend = data * 2 ** degree;
  return { dividend, width: dataBits + degree, degree, ...longDivision(dividend, generator) };
}

/**
 * Systematic encoding for a (shortened) cyclic code: append the remainder of data·x^d divided by `generator`. QR codes
 * use this for the (15, 5) BCH code that protects the format information and the (18, 6) Golay code that protects the
 * version information.
 */
export function cyclicEncode(data: number, generator: number): number {
  const { dividend, remainder } = divide(data, bitLength(data), generator);
  return dividend | remainder;
}

/** The codeword closest to `received`, by Hamming distance; the first one found if several are equally close. */
export function nearestCodeword(received: number, codewords: readonly number[]): { index: number; distance: number } {
  let best = { index: -1, distance: Infinity };
  codewords.forEach((codeword, index) => {
    const distance = hammingDistance(received, codeword);
    if (distance < best.distance) best = { index, distance };
  });
  return best;
}

/** How many pairs of codewords differ in each number of bits: the result maps distance to number of pairs. */
export function pairwiseDistances(codewords: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (let i = 0; i < codewords.length; i++) {
    for (let j = i + 1; j < codewords.length; j++) {
      const d = hammingDistance(codewords[i], codewords[j]);
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  return new Map([...counts].sort(([a], [b]) => a - b));
}
