import type { Position } from './layout';

/** The weights of the four penalty rules, N1 to N4 (7.8.3, Table 11). */
export const PENALTY_WEIGHTS = { runs: 3, squares: 3, finders: 40, balance: 10 } as const;

/** A row or column of the symbol, as module positions. */
interface Line {
  vertical: boolean;
  /** The row number, or the column number if vertical. */
  index: number;
}

/** Five or more modules of one colour in a row or column. */
export interface Run extends Line {
  start: number;
  length: number;
  dark: boolean;
  points: number;
}

/** A dark-light-dark-dark-dark-light-dark sequence, like a slice through a finder pattern, with 4 light modules beside it. */
export interface FinderLike extends Line {
  /** The first module of the 7. */
  start: number;
  /** Which sides have 4 light modules. */
  lightBefore: boolean;
  lightAfter: boolean;
}

export interface Penalty {
  runs: Run[];
  /** The top left modules of the 2 × 2 squares of one colour. Squares overlap, and each counts. */
  squares: Position[];
  finders: FinderLike[];
  darkCount: number;
  moduleCount: number;
  points: { runs: number; squares: number; finders: number; balance: number; total: number };
}

export interface PenaltyOptions {
  /**
   * Count the quiet zone as light modules beside the symbol, for rule 3. The standard scores "the complete symbol", which
   * doesn't include the quiet zone, but this reading reproduces the mask Annex I chooses.
   */
  quietZone?: boolean;
}

const FINDER = [true, false, true, true, true, false, true];

/** The penalty points for a finished symbol (7.8.3): the whole symbol is scored, not just the data area. */
export function penalty(dark: readonly boolean[], size: number, options: PenaltyOptions = {}): Penalty {
  const runs: Run[] = [];
  const finders: FinderLike[] = [];
  for (const vertical of [false, true]) {
    for (let index = 0; index < size; index++) {
      const at = (k: number) => (vertical ? dark[k * size + index] : dark[index * size + k]);

      // Rule 1: runs of 5 or more, 3 points for 5 and 1 more for each module beyond.
      let start = 0;
      for (let k = 1; k <= size; k++) {
        if (k < size && at(k) === at(start)) continue;
        const length = k - start;
        if (length >= 5) runs.push({ vertical, index, start, length, dark: at(start), points: length - 2 });
        start = k;
      }

      // Rule 3: the finder's 1:1:3:1:1 sequence with 4 light modules before or after it.
      const light = (from: number) => {
        for (let k = from; k < from + 4; k++) {
          if (k < 0 || k >= size ? !options.quietZone : at(k)) return false;
        }
        return true;
      };
      for (let s = 0; s + 7 <= size; s++) {
        if (!FINDER.every((d, k) => at(s + k) === d)) continue;
        const lightBefore = light(s - 4);
        const lightAfter = light(s + 7);
        if (lightBefore || lightAfter) finders.push({ vertical, index, start: s, lightBefore, lightAfter });
      }
    }
  }

  // Rule 2: every 2 × 2 square of one colour.
  const squares: Position[] = [];
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const d = dark[row * size + col];
      if (dark[row * size + col + 1] === d && dark[(row + 1) * size + col] === d && dark[(row + 1) * size + col + 1] === d) {
        squares.push([row, col]);
      }
    }
  }

  // Rule 4: 10 points for each full 5 % that the share of dark modules is away from 50 %.
  const moduleCount = size * size;
  const darkCount = dark.filter(Boolean).length;
  const steps = Math.floor(Math.abs(20 * darkCount - 10 * moduleCount) / moduleCount);

  const points = {
    runs: runs.reduce((n, r) => n + r.points, 0),
    squares: PENALTY_WEIGHTS.squares * squares.length,
    finders: PENALTY_WEIGHTS.finders * finders.length,
    balance: PENALTY_WEIGHTS.balance * steps,
    total: 0,
  };
  points.total = points.runs + points.squares + points.finders + points.balance;
  return { runs, squares, finders, darkCount, moduleCount, points };
}
