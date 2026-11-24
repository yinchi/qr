<script lang="ts">
  import { EC_LEVELS, ecInfo, type EcLevel } from '../../lib/qr/ec';
  import { MAX_VERSION, MIN_VERSION } from '../../lib/qr/layout';
  import { interleave, type Block } from '../../lib/qr/rs';

  const uid = $props.id();

  interface Codeword {
    block: number;
    kind: 'data' | 'ec';
    /** Position within the block's data or error correction codewords. */
    index: number;
  }

  // Version 5-H is the standard's example (Figure 15).
  let version = $state(5);
  let level: EcLevel = $state('H');
  let interleaved = $state(true);
  let start = $state(30);
  let runLength = $state(40);
  /** The sequence position being pointed at, if any. */
  let pointed: number | null = $state(null);

  const info = $derived(ecInfo(version, level));
  const capacity = $derived(info.blocks[0].correctable);
  const blocks = $derived.by(() => {
    const out: Block<Codeword>[] = [];
    for (const group of info.blocks) {
      for (let n = 0; n < group.count; n++) {
        const block = out.length;
        out.push({
          data: Array.from({ length: group.data }, (_, index) => ({ block, kind: 'data', index })),
          ec: Array.from({ length: info.ecPerBlock }, (_, index) => ({ block, kind: 'ec', index })),
        });
      }
    }
    return out;
  });
  const sequence = $derived(interleaved ? interleave(blocks) : blocks.flatMap((b) => [...b.data, ...b.ec]));
  const total = $derived(sequence.length);
  const longest = $derived(Math.max(...blocks.map((b) => b.data.length + b.ec.length)));

  /** The damaged run, as sequence positions from `first` up to but not including `end`. */
  const first = $derived(Math.min(start, total) - 1);
  const end = $derived(Math.min(total, first + runLength));
  const key = (c: Codeword) => `${c.block}:${c.kind}:${c.index}`;
  const damaged = $derived(new Set(sequence.slice(first, end).map(key)));
  /** Where each codeword sits in the sequence, so pointing at a block's codeword can show it. */
  const positionOf = $derived(new Map(sequence.map((c, i) => [key(c), i])));
  const hits = $derived(blocks.map((b) => [...b.data, ...b.ec].filter((c) => damaged.has(key(c))).length));
  const failing = $derived(hits.filter((h) => h > capacity).length);
  const most = $derived(Math.max(0, ...hits));

  const rowHeight = $derived(blocks.length > 30 ? 6 : blocks.length > 12 ? 10 : 16);
  const showLabels = $derived(rowHeight >= 16);
  const pointedCodeword = $derived(pointed === null ? null : sequence[pointed]);

  const groupText = $derived(
    info.blocks
      .map(
        (g) =>
          `${g.count} ${g.count === 1 ? 'block' : 'blocks'} of ${g.total} bytes (${g.data} data + ${info.ecPerBlock} error correction)`,
      )
      .join(' and '),
  );

  function pointAt(event: PointerEvent, toPosition: (x: number, y: number) => number | null) {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    pointed = toPosition((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  }
  const leave = (event: PointerEvent) => event.pointerType !== 'touch' && (pointed = null);
</script>

<figure class="interleaving">
  <div class="controls">
    <div class="field grow">
      <label for="version-{uid}">Version</label>
      <input id="version-{uid}" type="range" min={MIN_VERSION} max={MAX_VERSION} bind:value={version} />
      <output for="version-{uid}">{version}</output>
    </div>
    <div class="field choices" role="radiogroup" aria-label="Error correction level">
      <span>Level</span>
      {#each EC_LEVELS as l (l)}
        <label class="choice"><input type="radio" name="level-{uid}" value={l} bind:group={level} /> {l}</label>
      {/each}
    </div>
  </div>
  <p class="summary">
    Version {version}-{level}: {total} bytes in {groupText}. Each block can correct {capacity}
    {capacity === 1 ? 'error' : 'errors'}.
  </p>

  <div class="controls">
    <div class="field grow">
      <label for="length-{uid}">Damage</label>
      <input id="length-{uid}" type="range" min="0" max={total} bind:value={runLength} />
      <output for="length-{uid}">{end - first}</output>
    </div>
    <div class="field grow">
      <label for="start-{uid}">from byte</label>
      <input id="start-{uid}" type="range" min="1" max={total} bind:value={start} />
      <output for="start-{uid}">{first + 1}</output>
    </div>
  </div>
  <div class="field choices" role="radiogroup" aria-label="Order of the bytes">
    <label class="choice"><input type="radio" name="order-{uid}" value={true} bind:group={interleaved} /> Interleaved</label>
    <label class="choice"
      ><input type="radio" name="order-{uid}" value={false} bind:group={interleaved} /> One block after another</label
    >
  </div>

  <h4>The sequence of bytes</h4>
  <svg
    class="strip"
    viewBox="0 0 {total} 1"
    preserveAspectRatio="none"
    shape-rendering="crispEdges"
    role="img"
    aria-label="The {total} bytes in sequence, with bytes {first + 1} to {end} damaged"
    onpointermove={(event) => pointAt(event, (x) => Math.min(total - 1, Math.floor(x * total)))}
    onpointerdown={(event) => pointAt(event, (x) => Math.min(total - 1, Math.floor(x * total)))}
    onpointerleave={leave}
  >
    {#each sequence as c, i (i)}
      <rect
        x={i}
        width="1"
        height="1"
        class={c.kind}
        class:damaged={i >= first && i < end}
        class:pointed={i === pointed}
      />
    {/each}
  </svg>

  <h4>Where the damage lands</h4>
  <div class="rows" style:--row="{rowHeight}px" class:compact={!showLabels}>
    {#each blocks as block, b (b)}
      {@const cells = [...block.data, ...block.ec]}
      {#if showLabels}<span class="row-label">Block {b + 1}</span>{/if}
      <svg
        class="row"
        viewBox="0 0 {longest} 1"
        preserveAspectRatio="none"
        shape-rendering="crispEdges"
        role="img"
        aria-label="Block {b + 1}: {hits[b]} of its {cells.length} bytes damaged"
        onpointermove={(event) =>
          pointAt(event, (x) => {
            const c = cells[Math.floor(x * longest)];
            return c ? (positionOf.get(key(c)) ?? null) : null;
          })}
        onpointerdown={(event) =>
          pointAt(event, (x) => {
            const c = cells[Math.floor(x * longest)];
            return c ? (positionOf.get(key(c)) ?? null) : null;
          })}
        onpointerleave={leave}
      >
        {#each cells as c, j (j)}
          <rect
            x={j}
            width="1"
            height="1"
            class={c.kind}
            class:damaged={damaged.has(key(c))}
            class:pointed={pointedCodeword !== null && key(c) === key(pointedCodeword)}
          />
        {/each}
      </svg>
      {#if showLabels}
        <span class="tally" class:over={hits[b] > capacity}
          >{hits[b]}<span aria-hidden="true">{hits[b] > capacity ? ' ✗' : ' ✓'}</span></span
        >
      {/if}
    {/each}
  </div>
  <p class="key">
    <span class="sample data"></span> data · <span class="sample ec"></span> error correction ·
    <span class="sample damaged"></span> damaged
    {#if showLabels}· the number on the right counts each block's damaged bytes{/if}
  </p>

  <p class="readout" aria-live="polite">
    {#if pointedCodeword && pointed !== null}
      Byte {pointed + 1} of the sequence: block {pointedCodeword.block + 1},
      {pointedCodeword.kind === 'data' ? 'data' : 'error correction'} byte {pointedCodeword.index + 1}.
    {:else}
      Point at a byte to see where it is in the sequence and in its block.
    {/if}
  </p>

  <p class="outcome" class:fail={failing > 0} aria-live="polite">
    <span class="icon" aria-hidden="true">{failing ? '✗' : '✓'}</span>
    {#if failing}
      {failing} of the {blocks.length} blocks {failing === 1 ? 'has' : 'have'} more damaged bytes than the {capacity}
      {capacity === 1 ? 'error' : 'errors'} each can correct, so the code can't be read.
    {:else}
      No block has more than {most} damaged {most === 1 ? 'byte' : 'bytes'}, and each can correct {capacity}, so the code
      can still be read.
    {/if}
  </p>
</figure>

<style>
  .interleaving {
    /* Status colours from the dataviz reference palette; each outcome also has an icon and a label. */
    --good: #0ca30c;
    --critical: #d03b3b;
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
    margin-bottom: 0.5rem;
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
    margin: 0.25rem 0 1rem;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  h4 {
    margin: 1.25rem 0 0.375rem;
  }

  svg {
    display: block;
    width: 100%;
    touch-action: manipulation;
  }

  .strip {
    height: 1.5rem;
  }

  rect.data {
    fill: color-mix(in srgb, var(--link) 30%, var(--surface));
  }

  rect.ec {
    fill: color-mix(in srgb, var(--muted) 30%, var(--surface));
  }

  rect.damaged {
    fill: var(--critical);
  }

  rect.pointed {
    fill: var(--text);
  }

  /* One row per block: a label, the block's bytes, and how many are damaged. */
  .rows {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) 3.5em;
    align-items: center;
    gap: 2px 0.5rem;
  }

  .rows.compact {
    grid-template-columns: minmax(0, 1fr);
    gap: 1px;
  }

  .row {
    height: var(--row);
  }

  .row-label {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .tally {
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .tally.over {
    color: var(--critical);
    font-weight: 700;
  }

  .key {
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .sample {
    display: inline-block;
    width: 0.9em;
    height: 0.9em;
    border-radius: 2px;
    vertical-align: -0.1em;
  }

  .sample.data {
    background: color-mix(in srgb, var(--link) 30%, var(--surface));
  }

  .sample.ec {
    background: color-mix(in srgb, var(--muted) 30%, var(--surface));
  }

  .sample.damaged {
    background: var(--critical);
  }

  .readout {
    min-height: 3em;
    margin: 0.75rem 0 0;
    font-size: 0.9375rem;
  }

  .outcome {
    display: flex;
    gap: 0.5rem;
    margin: 0.5rem 0 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--good);
    border-radius: 0 4px 4px 0;
    background: color-mix(in srgb, var(--good) 10%, transparent);
  }

  .outcome.fail {
    border-color: var(--critical);
    background: color-mix(in srgb, var(--critical) 10%, transparent);
  }

  .icon {
    font-weight: 700;
  }
</style>
