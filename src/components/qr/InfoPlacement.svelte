<script lang="ts">
  import { EC_LEVELS, type EcLevel } from '../../lib/qr/ec';
  import { FORMAT_INFO_BITS, formatInfoBits } from '../../lib/qr/format';
  import {
    fixedLayout,
    formatInfoPositions,
    MAX_VERSION,
    MIN_VERSION,
    versionInfoPositions,
  } from '../../lib/qr/layout';
  import { VERSION_INFO_BITS } from '../../lib/qr/version-info';
  import { PARTS } from './parts';

  type Kind = 'format' | 'version';

  const uid = $props.id();

  let level: EcLevel = $state('M');
  let mask = $state(0b101);
  let version = $state(7);
  /** The bit being pointed at, in the grid or in the bit strings. */
  let active: { kind: Kind; bit: number } | null = $state(null);

  const DARK = '#1c1b19';
  const LIGHT = '#ffffff';
  const FIXED_DARK = '#a3a19a';
  const DATA = PARTS.data.colour;

  const layout = $derived(fixedLayout(version));
  const size = $derived(layout.size);
  const bits = $derived({ format: formatInfoBits(level, mask), version: layout.versionInfo ?? 0 });
  const positions = $derived({
    format: Object.values(formatInfoPositions(version)),
    version: Object.values(versionInfoPositions(version)),
  });

  /** Which bit each format or version module holds, keyed by module index. */
  const bitAt = $derived.by(() => {
    const map = new Map<number, { kind: Kind; bit: number }>();
    for (const kind of ['format', 'version'] as const) {
      for (const copy of positions[kind]) copy.forEach(([r, c], bit) => map.set(r * size + c, { kind, bit }));
    }
    return map;
  });

  const valueOf = (kind: Kind, bit: number) => (bits[kind] >> bit) & 1;

  /** The three corners that hold format and version information, as row and column ranges. */
  const corners = $derived([
    { name: 'Top left', area: 'tl', rows: [0, 8], cols: [0, 8] },
    { name: 'Top right', area: 'tr', rows: [0, 8], cols: [size - 11, size - 1] },
    { name: 'Bottom left', area: 'bl', rows: [size - 11, size - 1], cols: [0, 8] },
  ]);

  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  const readout = $derived.by(() => {
    if (!active) return 'Point at a bit, in a corner or in the strings below, to see where both of its copies go.';
    const { kind, bit } = active;
    const where = positions[kind].map((copy) => `row ${copy[bit][0]}, column ${copy[bit][1]}`).join(' and ');
    return `${kind === 'format' ? 'Format' : 'Version'} information bit ${bit} is ${valueOf(kind, bit)}: ${where}.`;
  });

  const bits3 = (n: number) => n.toString(2).padStart(3, '0');

  const strings = $derived<{ kind: Kind; width: number; label: string }[]>([
    { kind: 'format', width: FORMAT_INFO_BITS, label: `Format information, level ${level}, mask ${bits3(mask)}` },
    { kind: 'version', width: VERSION_INFO_BITS, label: `Version information, version ${version}` },
  ]);
</script>

<figure class="placement">
  <div class="controls">
    <div class="field choices" role="radiogroup" aria-labelledby="level-label-{uid}">
      <span id="level-label-{uid}">Level</span>
      {#each EC_LEVELS as l (l)}
        <label class="choice"><input type="radio" name="level-{uid}" value={l} bind:group={level} /> {l}</label>
      {/each}
    </div>
    <div class="field">
      <label for="mask-{uid}">Mask</label>
      <select id="mask-{uid}" bind:value={mask}>
        {#each [0, 1, 2, 3, 4, 5, 6, 7] as m (m)}
          <option value={m}>{bits3(m)}</option>
        {/each}
      </select>
    </div>
    <div class="field grow">
      <label for="version-{uid}">Version</label>
      <input id="version-{uid}" type="range" min={MIN_VERSION} max={MAX_VERSION} bind:value={version} />
      <output for="version-{uid}">{version}</output>
    </div>
  </div>

  <div class="corners-wrap">
  <div class="corners">
    {#each corners as corner (corner.area)}
      {@const rows = range(corner.rows[0], corner.rows[1])}
      {@const cols = range(corner.cols[0], corner.cols[1])}
      <div class="corner {corner.area}">
        <p class="corner-name">
          {corner.name} <span>rows {corner.rows[0]}–{corner.rows[1]}, columns {corner.cols[0]}–{corner.cols[1]}</span>
        </p>
        <svg
          style:--cols={cols.length}
          viewBox="0 0 {cols.length} {rows.length}"
          role="img"
          aria-label="{corner.name} corner of a version {version} code, with the bit number in each format and version information module"
          onpointerleave={(event) => event.pointerType !== 'touch' && (active = null)}
        >
          <rect width={cols.length} height={rows.length} fill={LIGHT} />
          {#each rows as r, y (r)}
            {#each cols as c, x (c)}
              {@const i = r * size + c}
              {@const info = bitAt.get(i)}
              {#if info}
                {@const value = valueOf(info.kind, info.bit)}
                {@const on = active?.kind === info.kind && active.bit === info.bit}
                <g
                  class="bit"
                  role="presentation"
                  onpointerenter={() => (active = info)}
                  onpointerdown={() => (active = info)}
                >
                  <rect x={x} y={y} width="1" height="1" fill={value ? DARK : LIGHT} />
                  <rect
                    class="outline"
                    class:on
                    x={x + 0.06}
                    y={y + 0.06}
                    width="0.88"
                    height="0.88"
                    style:stroke={PARTS[info.kind].colour}
                  />
                  <text x={x + 0.5} y={y + 0.52} fill={value ? LIGHT : DARK} class:on>{info.bit}</text>
                </g>
              {:else}
                {@const role = layout.roles[i]}
                <rect
                  x={x}
                  y={y}
                  width="1"
                  height="1"
                  fill={role === 'data' ? DATA : layout.dark[i] ? FIXED_DARK : LIGHT}
                />
              {/if}
            {/each}
          {/each}
        </svg>
      </div>
    {/each}
  </div>
  </div>

  <div class="strings">
    {#each strings as row (row.kind)}
      <div class="string">
        <p class="string-label">
          <span class="key" style:border-color={PARTS[row.kind].colour}></span>{row.label}
        </p>
        {#if row.kind === 'version' && version < 7}
          <p class="none">None below version 7.</p>
        {:else}
          <div class="string-bits" role="group" aria-label={row.label} onpointerleave={(event) => event.pointerType !== 'touch' && (active = null)}>
            {#each range(0, row.width - 1).reverse() as bit (bit)}
              <button
                type="button"
                class="string-bit"
                class:on={active?.kind === row.kind && active.bit === bit}
                aria-label="Bit {bit}: {valueOf(row.kind, bit)}"
                onpointerenter={() => (active = { kind: row.kind, bit })}
                onfocus={() => (active = { kind: row.kind, bit })}
                onblur={() => (active = null)}
                onclick={() => (active = { kind: row.kind, bit })}
              >
                <span class="value" aria-hidden="true">{valueOf(row.kind, bit)}</span>
                <span class="index" aria-hidden="true">{bit}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <p class="readout" aria-live="polite">{readout}</p>
</figure>

<style>
  .placement {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.5rem;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .choices {
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
  }

  .choice {
    white-space: nowrap;
  }

  .grow {
    flex: 1 1 14rem;
  }

  .grow input {
    flex: 1;
    min-width: 6rem;
  }

  select {
    padding: 0.2rem 0.375rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  output {
    min-width: 2ch;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  /*
   * Sized from the figure's own width with a container query, so the layout is right before any script runs. Narrow:
   * one corner above another, 11 cells across. Wide: the corners where they are in the code (top left and top right,
   * then bottom left), 20 cells across. Cells stay between readable and 30px.
   */
  .corners-wrap {
    container-type: inline-size;
  }

  .corners {
    --cell: min(30px, 100cqi / 11);
    display: grid;
    gap: 1rem 24px;
  }

  @container (min-width: 520px) {
    .corners {
      --cell: min(30px, (100cqi - 24px) / 20);
      grid-template-columns: auto auto;
      grid-template-areas: 'tl tr' 'bl .';
      justify-content: start;
    }

    .tl {
      grid-area: tl;
    }

    .tr {
      grid-area: tr;
    }

    .bl {
      grid-area: bl;
    }
  }

  .corner-name {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .corner-name span {
    color: var(--muted);
    font-weight: 400;
  }

  svg {
    display: block;
    width: calc(var(--cols) * var(--cell));
    height: auto;
    border-radius: 3px;
    shape-rendering: crispEdges;
    touch-action: pan-y;
  }

  .bit {
    cursor: pointer;
  }

  .outline {
    fill: none;
    stroke-width: 0.1;
  }

  .outline.on {
    stroke-width: 0.22;
  }

  text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.42px;
    text-anchor: middle;
    dominant-baseline: middle;
    pointer-events: none;
  }

  text.on {
    font-weight: 700;
  }

  .strings {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .string-label {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .key {
    display: inline-block;
    width: 0.75em;
    height: 0.75em;
    margin-right: 0.4em;
    border: 2px solid;
    border-radius: 2px;
    vertical-align: -0.05em;
  }

  .none {
    margin: 0;
    color: var(--muted);
  }

  .string-bits {
    display: flex;
    gap: 2px;
  }

  .string-bit {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    max-width: 1.75rem;
    min-width: 0;
    padding: 0.15rem 0;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .string-bit.on {
    background: color-mix(in srgb, var(--link) 18%, transparent);
  }

  .value {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .index {
    color: var(--muted);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  .readout {
    min-height: 3em;
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
  }
</style>
