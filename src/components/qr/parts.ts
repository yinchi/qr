import type { Role } from '../../lib/qr/layout';

/** Everything the diagrams can point at: the module roles, plus the quiet zone around the symbol. */
export type Part = Role | 'quietZone';

export interface PartStyle {
  /** Plural name, for legends. */
  label: string;
  /** Singular name, for describing one module. */
  name: string;
  colour: string;
}

// Hues from the dataviz reference palette. Every pair of parts that touch in the grid was run through the palette
// validator. Red (dark module) against aqua (format) is in the colour-blind warning band, so the dark module also gets
// a ring.
export const PARTS: Record<Part, PartStyle> = {
  finder: { label: 'Finder patterns', name: 'Finder pattern', colour: '#2a78d6' },
  separator: { label: 'Separators', name: 'Separator', colour: '#eda100' },
  timing: { label: 'Timing patterns', name: 'Timing pattern', colour: '#6250d6' },
  alignment: { label: 'Alignment patterns', name: 'Alignment pattern', colour: '#e87ba4' },
  darkModule: { label: 'Dark module', name: 'Dark module', colour: '#e34948' },
  quietZone: { label: 'Quiet zone', name: 'Quiet zone', colour: '#ffffff' },
  format: { label: 'Format information', name: 'Format information', colour: '#1baf7a' },
  version: { label: 'Version information', name: 'Version information', colour: '#008300' },
  data: { label: 'Data area', name: 'Data area', colour: '#e4e3de' },
};

/** Legend order, matching the order of the chapter. */
export const PART_ORDER = Object.keys(PARTS) as Part[];

/** Mix a colour with white: 0 gives white, 1 the colour itself. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(255 + (channel - 255) * amount);
  const rgb = (mix(n >> 16) << 16) | (mix((n >> 8) & 0xff) << 8) | mix(n & 0xff);
  return `#${rgb.toString(16).padStart(6, '0')}`;
}
