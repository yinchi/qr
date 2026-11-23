import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MASK_CONDITIONS } from './masks';

const require = createRequire(import.meta.url);
const BitMatrix = require('qrcode/lib/core/bit-matrix') as new (size: number) => { data: Uint8Array };
const reference = require('qrcode/lib/core/mask-pattern') as { applyMask(mask: number, matrix: unknown): void };

describe('mask patterns', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('mask %i matches the qrcode library', (mask) => {
    const size = 45;
    const matrix = new BitMatrix(size);
    reference.applyMask(mask, matrix); // XORs the pattern into an all-light matrix
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        expect(MASK_CONDITIONS[mask](i, j), `(${i}, ${j})`).toBe(matrix.data[i * size + j] === 1);
      }
    }
  });
});
