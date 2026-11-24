<script lang="ts">
  import { onDestroy } from 'svelte';
  import { EC_LEVELS, ecInfo, type EcLevel } from '../../lib/qr/ec';
  import { fixedLayout, MAX_VERSION, MIN_VERSION } from '../../lib/qr/layout';
  import { interleave, type Block } from '../../lib/qr/rs';
  import { dataPath } from '../../lib/qr/symbol';
  import { PARTS, tint } from './parts';

  const uid = $props.id();

  interface Codeword {
    kind: 'data' | 'ec';
    /** D1, D2, … and E1, E2, …, numbered block by block as in chapter 5. */
    name: string;
    block: number;
    /** Position within its block's data or error correction bytes, from 0. */
    index: number;
  }

  // Fills, on the white of the code in both themes. Hues from the dataviz reference palette.
  const FILL = {
    data: tint('#2a78d6', 0.38),
    ec: tint('#eda100', 0.42),
    remainder: tint('#e34948', 0.5),
    empty: '#ffffff',
    fixedDark: '#a8a59d',
    fixedLight: '#ecebe7',
  };
  type Fill = keyof typeof FILL;

  // Version 2-M is the standard's own example (Figure 19).
  let version = $state(2);
  let level: EcLevel = $state('M');
  /** Bytes placed, with the remainder bits as one more step; null for all of them. */
  let placed: number | null = $state(null);
  let showPath = $state(true);
  let playing = $state(false);
  let pointed: { row: number; col: number } | null = $state(null);
  let svg: SVGSVGElement | undefined = $state();

  const layout = $derived(fixedLayout(version));
  const size = $derived(layout.size);
  const path = $derived(dataPath(layout));
  const info = $derived(ecInfo(version, level));
  const sequence = $derived.by(() => {
    const blocks: Block<Codeword>[] = [];
    let data = 0;
    let ec = 0;
    for (const group of info.blocks) {
      for (let n = 0; n < group.count; n++) {
        const block = blocks.length;
        blocks.push({
          data: Array.from({ length: group.data }, (_, index) => ({ kind: 'data', name: `D${++data}`, block, index })),
          ec: Array.from({ length: info.ecPerBlock }, (_, index) => ({ kind: 'ec', name: `E${++ec}`, block, index })),
        });
      }
    }
    return interleave(blocks);
  });
  const total = $derived(sequence.length);
  const remainder = $derived(path.length - 8 * total);
  const steps = $derived(total + (remainder ? 1 : 0));
  const shown = $derived(Math.min(placed ?? steps, steps));
  const bitsShown = $derived(shown > total ? path.length : 8 * shown);

  /** Each module's position along the path, or -1 if it isn't data. */
  const pathIndex = $derived.by(() => {
    const index = new Int32Array(size * size).fill(-1);
    path.forEach(([row, col], k) => (index[row * size + col] = k));
    return index;
  });

  /** Which byte a module belongs to once placed: its place in the sequence, `total` for remainder bits, else -1. */
  function owner(row: number, col: number): number {
    if (row < 0 || col < 0 || row >= size || col >= size) return -1;
    const k = pathIndex[row * size + col];
    return k < 0 || k >= bitsShown ? -1 : Math.min(k >> 3, total);
  }

  function fillOf(m: number): Fill {
    const k = pathIndex[m];
    if (k < 0) return layout.dark[m] ? 'fixedDark' : 'fixedLight';
    if (k >= bitsShown) return 'empty';
    if (k >= 8 * total) return 'remainder';
    return sequence[k >> 3].kind;
  }

  /** One SVG path per fill, built from horizontal runs so even version 40 stays small. */
  const fills = $derived.by(() => {
    const d: Record<Fill, string> = { data: '', ec: '', remainder: '', empty: '', fixedDark: '', fixedLight: '' };
    for (let row = 0; row < size; row++) {
      let col = 0;
      while (col < size) {
        const fill = fillOf(row * size + col);
        let end = col + 1;
        while (end < size && fillOf(row * size + end) === fill) end++;
        d[fill] += `M${col} ${row}h${end - col}v1h${col - end}z`;
        col = end;
      }
    }
    return (Object.keys(d) as Fill[]).map((fill) => ({ fill, d: d[fill] }));
  });

  // Outlines and names only while the modules are big enough to see them.
  const showOutlines = $derived(size <= 57);
  const showNames = $derived(size <= 29);

  /** The edges between modules of different bytes, so each byte's shape shows. */
  const outlines = $derived.by(() => {
    if (!showOutlines) return '';
    let d = '';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const own = owner(row, col);
        if (own < 0) continue;
        if (owner(row - 1, col) !== own) d += `M${col} ${row}h1`;
        if (owner(row + 1, col) !== own) d += `M${col} ${row + 1}h1`;
        if (owner(row, col - 1) !== own) d += `M${col} ${row}v1`;
        if (owner(row, col + 1) !== own) d += `M${col + 1} ${row}v1`;
      }
    }
    return d;
  });

  /** Where to write each placed byte's name: its centre if that falls inside it, else its module nearest the centre. */
  const names = $derived.by(() => {
    if (!showNames) return [];
    return sequence.slice(0, Math.min(shown, total)).map((codeword, q) => {
      const cells = path.slice(8 * q, 8 * q + 8);
      const x = cells.reduce((s, [, c]) => s + c + 0.5, 0) / 8;
      const y = cells.reduce((s, [r]) => s + r + 0.5, 0) / 8;
      const inside = cells.some(([r, c]) => r === Math.floor(y) && c === Math.floor(x));
      if (inside) return { name: codeword.name, x, y };
      const [r, c] = cells.reduce((best, cell) =>
        Math.hypot(cell[1] + 0.5 - x, cell[0] + 0.5 - y) < Math.hypot(best[1] + 0.5 - x, best[0] + 0.5 - y)
          ? cell
          : best,
      );
      return { name: codeword.name, x: c + 0.5, y: r + 0.5 };
    });
  });

  /**
   * The whole path as one string, with where each bit's segment ends, so a prefix is a cheap slice. The line breaks
   * where the path jumps over something that isn't data.
   */
  const line = $derived.by(() => {
    let d = '';
    const ends = new Uint32Array(path.length + 1);
    path.forEach(([row, col], k) => {
      const jump = k === 0 || Math.abs(row - path[k - 1][0]) > 1 || Math.abs(col - path[k - 1][1]) > 1;
      d += `${jump ? 'M' : 'L'}${col + 0.5} ${row + 0.5}`;
      ends[k + 1] = d.length;
    });
    return { d, ends };
  });
  const head = $derived(bitsShown > 0 ? path[bitsShown - 1] : null);

  // Playing adds bytes at a pace that takes a few seconds whatever the version.
  let frame = 0;
  function play() {
    if (playing) {
      stop();
      return;
    }
    if (shown >= steps) placed = 0;
    playing = true;
    const rate = Math.max(8, steps / 6); // bytes per second
    const start = performance.now() - (1000 * (placed ?? 0)) / rate;
    const tick = (now: number) => {
      const next = Math.min(steps, Math.floor(((now - start) * rate) / 1000));
      placed = next;
      if (next >= steps) stop();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    playing = false;
  }
  onDestroy(stop);

  function setStep(value: number) {
    stop();
    placed = Math.max(0, Math.min(steps, value));
  }
  function reset() {
    stop();
    placed = null;
  }

  function onPointer(event: PointerEvent) {
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const row = Math.floor(point.y);
    const col = Math.floor(point.x);
    pointed = row >= 0 && col >= 0 && row < size && col < size ? { row, col } : null;
  }

  const ordinal = (n: number) => {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
    return `${n}${suffix}`;
  };

  const readout = $derived.by(() => {
    if (!pointed) return 'Point at a module to see which bit it holds.';
    const { row, col } = pointed;
    const where = `Row ${row}, column ${col}:`;
    const m = row * size + col;
    const k = pathIndex[m];
    if (k < 0) return `${where} ${PARTS[layout.roles[m]].name.toLowerCase()}, not data.`;
    if (k >= bitsShown) return `${where} data area, not filled yet. It takes the ${ordinal(k + 1)} bit of the stream.`;
    if (k >= 8 * total) return `${where} remainder bit ${k - 8 * total + 1} of ${remainder}, always 0 before masking.`;
    const codeword = sequence[k >> 3];
    const kind = codeword.kind === 'data' ? 'data' : 'error correction';
    const block = info.blocks.length > 1 || info.blocks[0].count > 1 ? ` of block ${codeword.block + 1}` : '';
    return `${where} bit ${7 - (k & 7)} of ${codeword.name}, the ${ordinal((k >> 3) + 1)} byte of the sequence (${kind} byte ${codeword.index + 1}${block}).`;
  });

  const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
  const blockText = $derived.by(() => {
    const count = info.blocks.reduce((n, g) => n + g.count, 0);
    return count === 1 ? '' : `, in ${count} blocks`;
  });
</script>

<figure class="placement">
  <div class="controls">
    <div class="field grow">
      <label for="version-{uid}">Version</label>
      <input
        id="version-{uid}"
        type="range"
        min={MIN_VERSION}
        max={MAX_VERSION}
        bind:value={version}
        oninput={reset}
      />
      <output for="version-{uid}">{version}</output>
    </div>
    <div class="field choices" role="radiogroup" aria-label="Error correction level">
      <span>Level</span>
      {#each EC_LEVELS as l (l)}
        <label class="choice"
          ><input type="radio" name="level-{uid}" value={l} bind:group={level} onchange={reset} /> {l}</label
        >
      {/each}
    </div>
  </div>
  <p class="summary">
    Version {version}-{level}: {plural(path.length, 'data module')}. The {plural(total, 'byte')} ({info.dataCodewords.toLocaleString('en')}
    data + {info.ecCodewords.toLocaleString('en')} error correction{blockText}) fill {(8 * total).toLocaleString('en')} of them{#if remainder},
      leaving {plural(remainder, 'remainder bit')}{/if}.
  </p>

  <div class="stepper">
    <button type="button" class="play" onclick={play} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
    <button type="button" onclick={() => setStep(shown - 1)} disabled={shown <= 0} aria-label="One byte fewer"
      >◀</button
    >
    <input
      type="range"
      min="0"
      max={steps}
      value={shown}
      oninput={(event) => setStep(Number(event.currentTarget.value))}
      aria-label="Bytes placed"
    />
    <button type="button" onclick={() => setStep(shown + 1)} disabled={shown >= steps} aria-label="One byte more"
      >▶</button
    >
    <output>{Math.min(shown, total)} of {total}</output>
  </div>

  <svg
    bind:this={svg}
    viewBox="-1 -1 {size + 2} {size + 2}"
    role="img"
    aria-label="Version {version}-{level}: {Math.min(shown, total)} of {total} bytes placed along the path"
    onpointermove={onPointer}
    onpointerdown={onPointer}
    onpointerleave={(event) => event.pointerType !== 'touch' && (pointed = null)}
  >
    <rect x="-1" y="-1" width={size + 2} height={size + 2} fill="#ffffff" />
    <g shape-rendering="crispEdges">
      {#each fills as { fill, d } (fill)}
        <path {d} fill={FILL[fill]} />
      {/each}
    </g>
    {#if showOutlines}
      <path class="outline" d={outlines} />
    {/if}
    {#each names as n (n.name)}
      <text x={n.x} y={n.y}>{n.name}</text>
    {/each}
    {#if showPath && bitsShown > 1}
      <path class="path" d={line.d.slice(0, line.ends[bitsShown])} />
    {/if}
    {#if head && shown < steps}
      <circle class="head" cx={head[1] + 0.5} cy={head[0] + 0.5} r={Math.max(0.35, size / 120)} />
    {/if}
    {#if pointed}
      <rect class="pointer" x={pointed.col} y={pointed.row} width="1" height="1" />
    {/if}
  </svg>

  <p class="key">
    <span class="swatch" style:background={FILL.data}></span> data bytes ·
    <span class="swatch" style:background={FILL.ec}></span> error correction bytes
    {#if remainder}· <span class="swatch" style:background={FILL.remainder}></span> remainder bits{/if}
    · <span class="swatch" style:background={FILL.fixedDark}></span> not data
    <label class="toggle"><input type="checkbox" bind:checked={showPath} /> Show the path</label>
  </p>
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
    gap: 0.5rem 1.5rem;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .grow {
    flex: 1 1 14rem;
  }

  .grow input {
    flex: 1;
    min-width: 0;
  }

  .choices {
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
  }

  .choice {
    white-space: nowrap;
  }

  output {
    min-width: 3ch;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
  }

  .summary {
    margin: 0.5rem 0 0.75rem;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .stepper input {
    flex: 1;
    min-width: 0;
  }

  .stepper output {
    min-width: 8ch;
    white-space: nowrap;
  }

  .stepper button {
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .stepper .play {
    min-width: 4.5rem;
  }

  .stepper button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  svg {
    display: block;
    width: 100%;
    max-width: 36rem;
    height: auto;
    margin: 0 auto;
    border-radius: 4px;
    touch-action: pinch-zoom;
  }

  .outline {
    fill: none;
    stroke: #1c1b19;
    stroke-width: 1px;
    stroke-linecap: square;
    vector-effect: non-scaling-stroke;
  }

  text {
    fill: #1c1b19;
    stroke: #ffffff;
    stroke-width: 0.12px;
    stroke-linejoin: round;
    paint-order: stroke;
    font-family: system-ui, sans-serif;
    font-size: 0.62px;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }

  .path {
    fill: none;
    stroke: #1c1b19;
    stroke-width: 1.5px;
    stroke-linejoin: round;
    opacity: 0.45;
    vector-effect: non-scaling-stroke;
  }

  .head {
    fill: #1c1b19;
  }

  .pointer {
    fill: none;
    stroke: #1c1b19;
    stroke-width: 2.5px;
    vector-effect: non-scaling-stroke;
  }

  .key {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .swatch {
    display: inline-block;
    width: 0.9em;
    height: 0.9em;
    border: 1px solid #8a877f;
    border-radius: 2px;
    vertical-align: -0.1em;
  }

  .toggle {
    margin-left: 0.5rem;
    color: var(--text);
    white-space: nowrap;
  }

  .readout {
    min-height: 3em;
    margin: 0.5rem 0 0;
    font-size: 0.9375rem;
  }
</style>
