<script lang="ts">
  import { EC_LEVELS, ecInfo, smallestVersion, type EcLevel } from '../../lib/qr/ec';
  import { MAX_VERSION, MIN_VERSION } from '../../lib/qr/layout';

  interface Props {
    /** The version selected first. */
    version?: number;
    /** The amount of data, in bytes, to find the smallest version for. */
    bytes?: number;
  }

  const { version: initialVersion = 7, bytes: initialBytes = 500 }: Props = $props();
  const uid = $props.id();

  // svelte-ignore state_referenced_locally
  let version = $state(initialVersion);
  // svelte-ignore state_referenced_locally
  let bytes = $state(initialBytes);
  let width = $state(640);

  const VERSIONS = Array.from({ length: MAX_VERSION - MIN_VERSION + 1 }, (_, i) => i + MIN_VERSION);
  const INFO = Object.fromEntries(EC_LEVELS.map((level) => [level, VERSIONS.map((v) => ecInfo(v, level))])) as Record<
    EcLevel,
    ReturnType<typeof ecInfo>[]
  >;
  const MAX_BYTES = INFO.L[INFO.L.length - 1].dataCodewords;
  const Y_MAX = 3000;

  // Chart geometry in pixels, from the measured width, so text stays the same size on any screen.
  const HEIGHT = 280;
  const M = { top: 12, right: 28, bottom: 42, left: 48 };
  const plotWidth = $derived(Math.max(width - M.left - M.right, 100));
  const x = (v: number) => M.left + ((v - MIN_VERSION) / (MAX_VERSION - MIN_VERSION)) * plotWidth;
  const y = (b: number) => M.top + (1 - b / Y_MAX) * (HEIGHT - M.top - M.bottom);
  const xTicks = $derived(width < 480 ? [1, 10, 20, 30, 40] : [1, 5, 10, 15, 20, 25, 30, 35, 40]);
  const yTicks = [0, 1000, 2000, 3000];

  const paths = $derived(
    Object.fromEntries(
      EC_LEVELS.map((level) => [
        level,
        INFO[level].map((info, i) => `${i ? 'L' : 'M'}${x(info.version)},${y(info.dataCodewords)}`).join(''),
      ]),
    ) as Record<EcLevel, string>,
  );

  /** The amount asked for, and whether any version holds it. */
  const target = $derived(Math.max(Math.round(bytes) || 1, 1));
  const fits = $derived(target <= MAX_BYTES);
  const smallest = $derived(Object.fromEntries(EC_LEVELS.map((level) => [level, smallestVersion(target, level)])));
  const selected = $derived(EC_LEVELS.map((level) => INFO[level][version - 1]));

  function pickVersion(event: PointerEvent) {
    const svg = event.currentTarget as SVGSVGElement;
    const left = svg.getBoundingClientRect().left;
    const v = Math.round(((event.clientX - left - M.left) / plotWidth) * (MAX_VERSION - MIN_VERSION)) + MIN_VERSION;
    version = Math.min(Math.max(v, MIN_VERSION), MAX_VERSION);
  }

  const percent = (part: number, whole: number) => `${Math.round((100 * part) / whole)}%`;
  const fmt = (n: number) => n.toLocaleString('en');
</script>

<figure class="capacity">
  <div class="controls">
    <div class="field">
      <label for="version-{uid}">Version</label>
      <input id="version-{uid}" type="range" min={MIN_VERSION} max={MAX_VERSION} bind:value={version} />
      <output for="version-{uid}">{version}</output>
    </div>
    <div class="field">
      <label for="bytes-{uid}">Data to store</label>
      <input id="bytes-{uid}" class="bytes" type="number" min="1" max={MAX_BYTES} bind:value={bytes} />
      <span>bytes</span>
    </div>
  </div>

  <div class="chart" bind:clientWidth={width}>
    <!-- The viewBox lets the server-rendered chart shrink to fit before it is measured and redrawn at its real width. -->
    <svg
      viewBox="0 0 {width} {HEIGHT}"
      role="img"
      aria-label="Data capacity in bytes for versions 1 to 40, at each error correction level. The table below gives the numbers for the selected version."
      onpointerdown={pickVersion}
      onpointermove={(e) => (e.buttons || e.pointerType === 'mouse') && pickVersion(e)}
    >
      {#each yTicks as tick (tick)}
        <line class="grid" x1={M.left} x2={M.left + plotWidth} y1={y(tick)} y2={y(tick)} />
        <text class="tick" x={M.left - 8} y={y(tick)} text-anchor="end" dominant-baseline="middle">{fmt(tick)}</text>
      {/each}
      {#each xTicks as tick (tick)}
        <text class="tick" x={x(tick)} y={HEIGHT - M.bottom + 18} text-anchor="middle">{tick}</text>
      {/each}
      <text class="axis-title" x={M.left + plotWidth / 2} y={HEIGHT - 4} text-anchor="middle">Version</text>

      <line class="selected" x1={x(version)} x2={x(version)} y1={M.top} y2={HEIGHT - M.bottom} />
      {#if fits}
        <line class="target" x1={M.left} x2={M.left + plotWidth} y1={y(target)} y2={y(target)} />
      {/if}

      {#each EC_LEVELS as level (level)}
        <path class="line" d={paths[level]} style:stroke="var(--level-{level})" />
        <text class="label" x={x(MAX_VERSION) + 8} y={y(INFO[level][MAX_VERSION - 1].dataCodewords)} dominant-baseline="middle"
          >{level}</text
        >
      {/each}
      {#each EC_LEVELS as level (level)}
        {@const v = smallest[level]}
        {#if v}
          <circle class="ring" cx={x(v)} cy={y(INFO[level][v - 1].dataCodewords)} r="6" style:stroke="var(--level-{level})" />
        {/if}
        <circle class="dot" cx={x(version)} cy={y(INFO[level][version - 1].dataCodewords)} r="4" style:fill="var(--level-{level})" />
      {/each}
    </svg>
  </div>

  <p class="answer" aria-live="polite">
    {#if !fits}
      No version can hold {fmt(target)} bytes; the most is {fmt(MAX_BYTES)}, in version 40-L.
    {:else}
      Smallest version for {fmt(target)} bytes:
      {#each EC_LEVELS as level, i (level)}
        <span class="nowrap"
          ><span class="key" style:background="var(--level-{level})"></span>{level}: {smallest[level] ?? 'none'}{i <
          EC_LEVELS.length - 1
            ? ','
            : ''}</span
        >{' '}
      {/each}
    {/if}
  </p>

  <div class="table-wrap">
    <table>
      <caption>Version {version}: {fmt(selected[0].totalCodewords)} codewords in all</caption>
      <thead>
        <tr>
          <th>Level</th>
          <th style:text-align="right">Data bytes</th>
          <th style:text-align="right">Error correction bytes</th>
          <th style:text-align="right">Can correct</th>
        </tr>
      </thead>
      <tbody>
        {#each selected as info (info.level)}
          <tr>
            <td><span class="key" style:background="var(--level-{info.level})"></span>{info.level}</td>
            <td style:text-align="right">{fmt(info.dataCodewords)}</td>
            <td style:text-align="right">{fmt(info.ecCodewords)}</td>
            <td style:text-align="right"
              >{fmt(info.correctableCodewords)} ({percent(info.correctableCodewords, info.totalCodewords)})</td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>

<style>
  /* One hue, light to dark from L to H (brightest H in dark mode), checked with the dataviz palette validator. */
  .capacity {
    --level-L: light-dark(#86b6ef, #256abf);
    --level-M: light-dark(#3987e5, #3987e5);
    --level-Q: light-dark(#1c5cab, #86b6ef);
    --level-H: light-dark(#0d366b, #cde2fb);
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    margin-bottom: 0.75rem;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .field:first-child {
    flex: 1 1 16rem;
  }

  .field input[type='range'] {
    flex: 1;
    min-width: 6rem;
  }

  output {
    min-width: 2ch;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .bytes {
    width: 6em;
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  .chart {
    width: 100%;
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    touch-action: pan-y;
    cursor: crosshair;
  }

  .grid {
    stroke: var(--rule);
  }

  .tick,
  .axis-title {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .label {
    fill: var(--text);
    font-size: 13px;
    font-weight: 600;
  }

  .selected {
    stroke: var(--muted);
    stroke-width: 1;
  }

  .target {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 4 3;
  }

  .dot {
    stroke: var(--bg);
    stroke-width: 2;
  }

  .ring {
    fill: none;
    stroke-width: 2;
  }

  .answer {
    margin: 0.75rem 0 0;
  }

  .nowrap {
    white-space: nowrap;
  }

  .key {
    display: inline-block;
    width: 0.75em;
    height: 0.75em;
    margin-right: 0.3em;
    border-radius: 2px;
    vertical-align: -0.05em;
  }

  .table-wrap {
    margin: 1rem 0 0;
  }

  /* A compact table, so it fits a phone without scrolling. */
  .table-wrap :global(th),
  .table-wrap :global(td) {
    padding-inline: 0.6rem;
  }

  caption {
    padding: 0.5rem 0.6rem;
    text-align: start;
    font-weight: 600;
  }
</style>
