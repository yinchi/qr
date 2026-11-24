<script lang="ts">
  import { EC_LEVELS, type EcLevel } from '../../lib/qr/ec';
  import { QUIET_ZONE } from '../../lib/qr/layout';
  import { MASK_CONDITIONS } from '../../lib/qr/masks';
  import { maxCharacters, detectMode } from '../../lib/qr/modes';
  import { penalty, type Penalty } from '../../lib/qr/penalty';
  import { applyMask, encodeText, placeCodewords, type EncodedText } from '../../lib/qr/symbol';

  const uid = $props.id();

  const MODE_NAMES = { numeric: 'Numeric', alphanumeric: 'Alphanumeric', byte: 'Byte', kanji: 'Kanji' };
  const DARK = '#1c1b19';
  type Mark = 'nothing' | 'flipped' | 'runs' | 'squares' | 'finders';
  const MARKS: { value: Mark; label: string }[] = [
    { value: 'nothing', label: 'Nothing' },
    { value: 'flipped', label: 'Flipped modules' },
    { value: 'runs', label: 'Runs' },
    { value: 'squares', label: '2 × 2 squares' },
    { value: 'finders', label: 'Finder-like' },
  ];

  // The standard's example (Annex I) to start with.
  let text = $state('01234567');
  let level: EcLevel = $state('M');
  let encoded: EncodedText = $state(encodeText('01234567', 'M')!);
  let fits = $state(true);
  /** The mask shown: a reference, 'none' for the unmasked code, or null for whichever scores lowest. */
  let chosen = $state<number | 'none' | null>(null);
  let mark = $state<Mark>('nothing');
  let quietZone = $state(false);
  let pointed: { row: number; col: number } | null = $state(null);
  let svg: SVGSVGElement | undefined = $state();

  function update(nextText: string, nextLevel: EcLevel) {
    text = nextText;
    level = nextLevel;
    const next = encodeText(nextText, nextLevel);
    fits = next !== null;
    if (next) encoded = next;
  }

  const unmasked = $derived(placeCodewords(encoded.version, encoded.codewords));
  const size = $derived(unmasked.size);
  const masked = $derived(MASK_CONDITIONS.map((_, mask) => applyMask(unmasked, encoded.level, mask)));
  const scores = $derived(masked.map((s) => penalty(s.dark, size, { quietZone })));
  const unmaskedScore = $derived(penalty(unmasked.dark, size, { quietZone }));
  const lowest = $derived.by(() => {
    const totals = scores.map((s) => s.points.total);
    return totals.indexOf(Math.min(...totals));
  });
  const shown = $derived(chosen ?? lowest);
  const symbol = $derived(shown === 'none' ? unmasked : masked[shown]);
  const score: Penalty = $derived(shown === 'none' ? unmaskedScore : scores[shown]);
  const effectiveMark = $derived(shown === 'none' && mark === 'flipped' ? 'nothing' : mark);

  const darkPath = $derived.by(() => {
    let d = '';
    for (let row = 0; row < size; row++) {
      let col = 0;
      while (col < size) {
        if (!symbol.dark[row * size + col]) {
          col++;
          continue;
        }
        let end = col + 1;
        while (end < size && symbol.dark[row * size + end]) end++;
        d += `M${col} ${row}h${end - col}v1h${col - end}z`;
        col = end;
      }
    }
    return d;
  });

  /** The data modules this mask flips. */
  const flipped = $derived.by(() => {
    if (shown === 'none') return [];
    const condition = MASK_CONDITIONS[shown];
    const cells: [number, number][] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (unmasked.roles[row * size + col] === 'data' && condition(row, col)) cells.push([row, col]);
      }
    }
    return cells;
  });

  /** The four light modules beside a finder-like sequence, clipped to the symbol unless the quiet zone counts. */
  function lightArea(f: Penalty['finders'][number], before: boolean) {
    const from = before ? f.start - 4 : f.start + 7;
    const lo = quietZone ? from : Math.max(0, from);
    const hi = quietZone ? from + 4 : Math.min(size, from + 4);
    return f.vertical ? { x: f.index, y: lo, w: 1, h: hi - lo } : { x: lo, y: f.index, w: hi - lo, h: 1 };
  }

  const reference = (mask: number) => mask.toString(2).padStart(3, '0');
  const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
  const percent = (s: Penalty) => ((100 * s.darkCount) / s.moduleCount).toFixed(1);

  function onPointer(event: PointerEvent) {
    const matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const row = Math.floor(point.y);
    const col = Math.floor(point.x);
    pointed = row >= 0 && col >= 0 && row < size && col < size ? { row, col } : null;
  }

  const readout = $derived.by(() => {
    if (!pointed) return null;
    const { row, col } = pointed;
    const m = row * size + col;
    const role = unmasked.roles[m];
    const colour = symbol.dark[m] ? 'dark' : 'light';
    if (role !== 'data') return `Row ${row}, column ${col}: ${colour}, not data, so never masked.`;
    if (shown === 'none') return `Row ${row}, column ${col}: ${colour}, as placed.`;
    const flips = MASK_CONDITIONS[shown](row, col);
    return `Row ${row}, column ${col}: ${colour}. Placed as ${unmasked.dark[m] ? 'dark' : 'light'}${flips ? ', and this mask flips it' : '; this mask leaves it'}.`;
  });

  const capacity = $derived.by(() => {
    const mode = detectMode(text);
    return { mode, max: maxCharacters(mode, 40, level) };
  });
</script>

<figure class="masking">
  <div class="field">
    <label for="text-{uid}">Text</label>
    <input
      id="text-{uid}"
      type="text"
      autocomplete="off"
      spellcheck="false"
      value={text}
      oninput={(event) => update(event.currentTarget.value, level)}
    />
  </div>
  <div class="field choices" role="radiogroup" aria-label="Error correction level">
    <span>Level</span>
    {#each EC_LEVELS as l (l)}
      <label class="choice"
        ><input type="radio" name="level-{uid}" value={l} checked={level === l} onchange={() => update(text, l)} />
        {l}</label
      >
    {/each}
  </div>
  <p class="note" aria-live="polite">
    {#if fits}
      {MODE_NAMES[encoded.mode]} mode, version {encoded.version}-{encoded.level}: {size} × {size} modules.
    {:else}
      Too long: version 40-{level} holds at most {capacity.max.toLocaleString('en')} characters in {capacity.mode} mode.
      Still showing the last text that fitted.
    {/if}
  </p>

  <div class="body">
    <div class="diagram">
      <svg
        bind:this={svg}
        viewBox="{-QUIET_ZONE} {-QUIET_ZONE} {size + 2 * QUIET_ZONE} {size + 2 * QUIET_ZONE}"
        role="img"
        aria-label={shown === 'none'
          ? 'The code before masking'
          : `The code with mask ${reference(shown)}, scoring ${score.points.total} points`}
        onpointermove={onPointer}
        onpointerdown={onPointer}
        onpointerleave={(event) => event.pointerType !== 'touch' && (pointed = null)}
      >
        <rect
          x={-QUIET_ZONE}
          y={-QUIET_ZONE}
          width={size + 2 * QUIET_ZONE}
          height={size + 2 * QUIET_ZONE}
          fill="#ffffff"
        />
        <path d={darkPath} fill={DARK} shape-rendering="crispEdges" />
        {#if effectiveMark === 'flipped'}
          {#each flipped as [row, col] (row * size + col)}
            <circle class="dot" cx={col + 0.5} cy={row + 0.5} r="0.2" />
          {/each}
        {:else if effectiveMark === 'runs'}
          {#each score.runs as r, i (i)}
            <rect
              class="mark"
              x={(r.vertical ? r.index : r.start) + 0.12}
              y={(r.vertical ? r.start : r.index) + 0.12}
              width={(r.vertical ? 1 : r.length) - 0.24}
              height={(r.vertical ? r.length : 1) - 0.24}
            />
          {/each}
        {:else if effectiveMark === 'squares'}
          {#each score.squares as [row, col] (row * size + col)}
            <rect class="mark" x={col + 0.18} y={row + 0.18} width="1.64" height="1.64" />
          {/each}
        {:else if effectiveMark === 'finders'}
          {#each score.finders as f, i (i)}
            <rect
              class="mark"
              x={(f.vertical ? f.index : f.start) + 0.08}
              y={(f.vertical ? f.start : f.index) + 0.08}
              width={(f.vertical ? 1 : 7) - 0.16}
              height={(f.vertical ? 7 : 1) - 0.16}
            />
            {#each [f.lightBefore, f.lightAfter] as light, side (side)}
              {#if light}
                {@const a = lightArea(f, side === 0)}
                <rect class="mark light" x={a.x + 0.08} y={a.y + 0.08} width={a.w - 0.16} height={a.h - 0.16} />
              {/if}
            {/each}
          {/each}
        {/if}
        {#if pointed}
          <rect class="pointer" x={pointed.col} y={pointed.row} width="1" height="1" />
        {/if}
      </svg>
      <div class="marks" role="radiogroup" aria-label="Mark on the code">
        <span>Mark</span>
        {#each MARKS as m (m.value)}
          <label class="choice">
            <input
              type="radio"
              name="mark-{uid}"
              value={m.value}
              bind:group={mark}
              disabled={m.value === 'flipped' && shown === 'none'}
            />
            {m.label}
          </label>
        {/each}
      </div>
      <p class="readout" aria-live="polite">
        {#if readout}
          {readout}
        {:else if shown === 'none'}
          No mask: {plural(score.runs.length, 'run')} of 5 or more, {plural(score.squares.length, 'square')},
          {plural(score.finders.length, 'finder-like sequence')}, {percent(score)} % dark. Not allowed: a code must use
          one of the eight masks.
        {:else}
          Mask {reference(shown)}: {plural(score.runs.length, 'run')} of 5 or more, {plural(score.squares.length, 'square')},
          {plural(score.finders.length, 'finder-like sequence')}, {percent(score)} % dark.
        {/if}
      </p>
    </div>

    <div class="scores">
      <div class="table-wrap">
        <table>
          <caption>Penalty points for each mask</caption>
          <thead>
            <tr>
              <th scope="col">Mask</th>
              <th scope="col" class="num">Runs</th>
              <th scope="col" class="num">2 × 2</th>
              <th scope="col" class="num">Finder</th>
              <th scope="col" class="num">Balance</th>
              <th scope="col" class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each [...scores.map((s, mask) => ({ s, mask: mask as number | 'none' })), { s: unmaskedScore, mask: 'none' as const }] as { s, mask } (mask)}
              <tr class:selected={shown === mask} class:none={mask === 'none'}>
                <th scope="row">
                  <label>
                    <input
                      type="radio"
                      name="mask-{uid}"
                      checked={shown === mask}
                      onchange={() => (chosen = mask === lowest ? null : mask)}
                    />
                    {mask === 'none' ? 'None' : reference(mask)}
                  </label>
                </th>
                <td class="num">{s.points.runs}</td>
                <td class="num">{s.points.squares}</td>
                <td class="num">{s.points.finders}</td>
                <td class="num">{s.points.balance}</td>
                <td class="num total">
                  {s.points.total}{#if mask === lowest}<span class="best" aria-label="lowest">✓</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="table-note">
        ✓ marks the lowest total, the mask the code uses. “None” is for comparison only: every code must use one of the
        eight masks.
      </p>
      <label class="quiet"
        ><input type="checkbox" bind:checked={quietZone} /> Count the quiet zone as light modules (see the note below)</label
      >
    </div>
  </div>
</figure>

<style>
  .masking {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .field input[type='text'] {
    flex: 1;
    min-width: 0;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 1rem;
  }

  .choices {
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin-top: 0.5rem;
  }

  .choice {
    white-space: nowrap;
  }

  .note {
    margin: 0.375rem 0 0.75rem;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  @media (min-width: 720px) {
    .body {
      grid-template-columns: minmax(0, 1fr) auto;
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

  .dot {
    fill: #e34948;
  }

  .mark {
    fill: none;
    stroke: #e34948;
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }

  .mark.light {
    stroke-dasharray: 3 2;
  }

  .pointer {
    fill: none;
    stroke: #2a78d6;
    stroke-width: 2.5px;
    vector-effect: non-scaling-stroke;
  }

  .marks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin-top: 0.5rem;
    font-size: 0.9375rem;
  }

  .readout {
    min-height: 4.5em;
    margin: 0.5rem 0 0;
    font-size: 0.9375rem;
  }

  .table-wrap {
    margin: 0;
    overflow-x: auto;
  }

  table {
    width: 100%;
    margin: 0;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }

  caption {
    padding-bottom: 0.25rem;
    color: var(--muted);
    font-size: 0.875rem;
    text-align: left;
  }

  th,
  td {
    padding: 0.2rem 0.3rem;
  }

  tbody th {
    font-weight: normal;
    white-space: nowrap;
  }

  tbody th label {
    cursor: pointer;
  }

  .num {
    text-align: right;
  }

  .total {
    font-weight: 600;
    white-space: nowrap;
  }

  .best {
    margin-left: 0.25em;
    font-weight: normal;
  }

  tr.selected {
    background: color-mix(in srgb, var(--link) 12%, transparent);
  }

  tr.none td,
  tr.none th {
    color: var(--muted);
  }

  .table-note {
    max-width: 22rem;
    margin: 0.375rem 0 0;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .quiet {
    display: block;
    max-width: 22rem;
    margin-top: 0.5rem;
    font-size: 0.875rem;
  }
</style>
