<script lang="ts">
  import { countRoles, fixedLayout, MAX_VERSION, MIN_VERSION, QUIET_ZONE, type Role } from '../../lib/qr/layout';
  import { PART_ORDER, PARTS, tint, type Part } from './parts';

  interface Props {
    /** The version shown first. */
    version?: number;
    /** Show the version picker and display options. */
    controls?: boolean;
  }

  const { version: initialVersion = 7, controls = true }: Props = $props();
  const uid = $props.id();

  // svelte-ignore state_referenced_locally
  let version = $state(initialVersion);
  let colourByPart = $state(true);
  let showFormat = $state(true);
  let showQuietZone = $state(true);
  /** The part picked from the legend (sticky), and the one under the mouse (temporary). */
  let selected: Part | null = $state(null);
  let hovered: Part | null = $state(null);
  let pointed: { row: number; col: number } | null = $state(null);
  let svg: SVGSVGElement | undefined = $state();

  const DARK = '#1c1b19';
  const LIGHT = '#ffffff';
  const UNKNOWN = PARTS.data.colour;
  const RESERVED = '#c4c3bc';
  const QUIET_HIGHLIGHT = '#d6dde6';

  const layout = $derived(fixedLayout(version));
  const size = $derived(layout.size);
  const counts = $derived(countRoles(layout));
  const margin = $derived(showQuietZone ? QUIET_ZONE : 0);
  const highlighted = $derived(hovered ?? selected);

  /** Format modules are blank (their values depend on choices made later), shown only when asked for. */
  function fill(role: Role, dark: boolean): string {
    if (role === 'data' || (role === 'format' && !showFormat)) return UNKNOWN;
    if (role === 'format') return colourByPart ? tint(PARTS.format.colour, 0.35) : RESERVED;
    if (!colourByPart) return dark ? DARK : LIGHT;
    // Separators are all light, so they need a stronger tint to show up against the quiet zone.
    return dark ? PARTS[role].colour : tint(PARTS[role].colour, role === 'separator' ? 0.6 : 0.28);
  }

  /** One SVG path per (role, colour), built from horizontal runs so even version 40 stays small. */
  const groups = $derived.by(() => {
    const { roles, dark } = layout;
    const byKey = new Map<string, { role: Role; fill: string; d: string }>();
    for (let row = 0; row < size; row++) {
      let col = 0;
      while (col < size) {
        const role = roles[row * size + col];
        const colour = fill(role, dark[row * size + col]);
        let end = col + 1;
        while (end < size && roles[row * size + end] === role && fill(role, dark[row * size + end]) === colour) end++;
        if (role !== 'data') {
          const key = `${role} ${colour}`;
          let group = byKey.get(key);
          if (!group) byKey.set(key, (group = { role, fill: colour, d: '' }));
          group.d += `M${col} ${row}h${end - col}v1h${col - end}z`;
        }
        col = end;
      }
    }
    return [...byKey.values()];
  });

  function opacity(part: Part): number {
    return highlighted && highlighted !== part ? 0.15 : 1;
  }

  function swatch(part: Part): string {
    if (part === 'data' || part === 'quietZone') return PARTS[part].colour;
    if (part === 'format') return fill('format', false);
    return colourByPart ? PARTS[part].colour : DARK;
  }

  function moduleCount(part: Part): number {
    if (part === 'quietZone') return (size + 2 * QUIET_ZONE) ** 2 - size ** 2;
    if (part === 'data' && !showFormat) return counts.data + counts.format;
    return counts[part];
  }

  const visibleParts = $derived(
    PART_ORDER.filter((part) => (part !== 'quietZone' || showQuietZone) && (part !== 'format' || showFormat)),
  );

  const pointedText = $derived.by(() => {
    if (!pointed) return 'Point at a module to see which part it belongs to.';
    const { row, col } = pointed;
    if (row < 0 || col < 0 || row >= size || col >= size) return PARTS.quietZone.name;
    let role: Part = layout.roles[row * size + col];
    if (role === 'format' && !showFormat) role = 'data';
    return `Row ${row}, column ${col}: ${PARTS[role].name}`;
  });

  function onPointerMove(event: PointerEvent) {
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const row = Math.floor(point.y);
    const col = Math.floor(point.x);
    const inside = row >= -margin && col >= -margin && row < size + margin && col < size + margin;
    pointed = inside ? { row, col } : null;
  }

  const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
  const dataText = $derived.by(() => {
    const modules = moduleCount('data');
    const text = `Data area: ${plural(modules, 'module')} = ${plural(Math.floor(modules / 8), 'byte')}`;
    return modules % 8 ? `${text} + ${plural(modules % 8, 'remainder bit')}` : text;
  });
  const versionBits = $derived(
    layout.versionInfo === null ? null : layout.versionInfo.toString(2).padStart(18, '0').replace(/^(.{6})/, '$1 '),
  );
</script>

<figure class="fixed-patterns">
  {#if controls}
    <div class="controls">
      <div class="version-picker">
        <label for="version-{uid}">Version</label>
        <button type="button" aria-label="Previous version" disabled={version <= MIN_VERSION} onclick={() => version--}
          >−</button
        >
        <input id="version-{uid}" type="range" min={MIN_VERSION} max={MAX_VERSION} bind:value={version} />
        <button type="button" aria-label="Next version" disabled={version >= MAX_VERSION} onclick={() => version++}
          >+</button
        >
        <output for="version-{uid}">{version}</output>
      </div>
      <div class="options">
        <label><input type="checkbox" bind:checked={colourByPart} /> Colour by part</label>
        <label><input type="checkbox" bind:checked={showFormat} /> Show format information area</label>
        <label><input type="checkbox" bind:checked={showQuietZone} /> Show quiet zone</label>
      </div>
    </div>
  {/if}

  <div class="body">
    <div class="diagram">
      <svg
        bind:this={svg}
        viewBox="{-margin} {-margin} {size + 2 * margin} {size + 2 * margin}"
        role="img"
        aria-label="The fixed parts of a version {version} QR code, {size} by {size} modules"
        shape-rendering="crispEdges"
        onpointermove={onPointerMove}
        onpointerdown={onPointerMove}
        onpointerleave={(event) => event.pointerType !== 'touch' && (pointed = null)}
      >
        <rect x={-margin} y={-margin} width={size + 2 * margin} height={size + 2 * margin} fill={LIGHT} />
        {#if showQuietZone && highlighted === 'quietZone'}
          <path
            d="M{-margin} {-margin}h{size + 2 * margin}v{size + 2 * margin}h{-(size + 2 * margin)}zM0 0v{size}h{size}v{-size}z"
            fill={QUIET_HIGHLIGHT}
            fill-rule="evenodd"
          />
        {/if}
        <rect width={size} height={size} fill={UNKNOWN} opacity={opacity('data')} />
        {#each groups as group (group.role + group.fill)}
          <path d={group.d} fill={group.fill} opacity={opacity(group.role === 'format' && !showFormat ? 'data' : group.role)} />
        {/each}
        {#if colourByPart}
          <circle
            cx={8.5}
            cy={size - 7.5}
            r={1.4}
            fill="none"
            stroke={PARTS.darkModule.colour}
            stroke-width={0.3}
            opacity={opacity('darkModule')}
            shape-rendering="geometricPrecision"
          />
        {/if}
        {#if showQuietZone}
          <rect class="edge" width={size} height={size} fill="none" />
        {/if}
        {#if pointed}
          <rect class="pointer" x={pointed.col} y={pointed.row} width={1} height={1} fill="none" />
        {/if}
      </svg>
      <p class="readout">{pointedText}</p>
    </div>

    <div class="key">
      <ul class="legend" aria-label="Parts">
        {#each visibleParts as part (part)}
          <li>
            <button
              type="button"
              aria-pressed={selected === part}
              onclick={() => (selected = selected === part ? null : part)}
              onpointerenter={(e) => e.pointerType === 'mouse' && (hovered = part)}
              onpointerleave={() => (hovered = null)}
            >
              <span class="swatch" style:background={swatch(part)}></span>
              <span class="label">{PARTS[part].label}</span>
              <span class="count">{moduleCount(part).toLocaleString('en')}</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="legend-note">Modules in each part. Select a part to pick it out.</p>
    </div>
  </div>

  <figcaption aria-live="polite">
    <span>Version {version}: {size} × {size} modules</span>
    <span>{plural(layout.alignmentCentres.length, 'alignment pattern')}</span>
    <span>{dataText}</span>
    <span
      >{#if versionBits}Version information: <code>{versionBits}</code>{:else}No version information below version
        7{/if}</span
    >
  </figcaption>
</figure>

<style>
  .fixed-patterns {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    margin-bottom: 1rem;
  }

  .version-picker {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1 1 16rem;
  }

  .version-picker input {
    flex: 1;
    min-width: 6rem;
  }

  .version-picker output {
    min-width: 2ch;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .version-picker button {
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .version-picker button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    font-size: 0.9375rem;
  }

  .body {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 600px) {
    .body {
      grid-template-columns: minmax(0, 1fr) 15rem;
      align-items: start;
    }
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
    touch-action: pinch-zoom;
  }

  .edge {
    stroke: #8a877f;
    stroke-width: 1px;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }

  .pointer {
    stroke: #1c1b19;
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }

  .readout {
    min-height: 1.5em;
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .legend {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .legend button {
    display: grid;
    grid-template-columns: 1rem 1fr auto;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.25rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
  }

  .legend button:hover,
  .legend button[aria-pressed='true'] {
    border-color: var(--rule);
  }

  .legend button[aria-pressed='true'] {
    font-weight: 600;
  }

  .swatch {
    width: 1rem;
    height: 1rem;
    border: 1px solid #8a877f;
    border-radius: 3px;
  }

  .count {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .legend-note {
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin-top: 1rem;
    font-size: 0.9375rem;
  }
</style>
