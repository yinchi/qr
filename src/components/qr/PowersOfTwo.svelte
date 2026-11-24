<script lang="ts">
  import { CYCLE, inverse, LOGS, POWERS, PRIME_MODULUS } from '../../lib/qr/gf256';

  const uid = $props.id();

  const HEX = '0123456789ABCDEF';
  const bitsOf = (value: number, n: number) => value.toString(2).padStart(n, '0');

  /** How far along the cycle: 2^k is the newest power. At 255 the powers are back at 2⁰ = 1. */
  let k = $state(8);
  /** A byte the reader is pointing at, if any. */
  let pointed: number | null = $state(null);
  let playing = $state(false);

  const current = $derived(POWERS[k % CYCLE]);
  const focus = $derived(pointed ?? current);
  const focusLog = $derived(LOGS[focus]);
  const focusInverse = $derived(inverse(focus));
  const visited = (byte: number) => byte !== 0 && (k >= CYCLE || LOGS[byte] <= k);

  /** How 2^k comes from 2^(k−1). */
  const step = $derived.by(() => {
    if (k === 0) return null;
    const before = POWERS[k - 1];
    const shifted = before << 1;
    return { before, shifted, overflow: shifted > 0xff };
  });

  function go(to: number) {
    k = Math.min(Math.max(to, 0), CYCLE);
    pointed = null;
  }

  function togglePlay() {
    if (!playing && k >= CYCLE) go(0);
    playing = !playing;
  }

  $effect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (k >= CYCLE) playing = false;
      else go(k + 1);
    }, 60);
    return () => clearInterval(timer);
  });
</script>

<figure class="powers">
  <div class="controls">
    <div class="field">
      <label for="k-{uid}">Power</label>
      <input
        id="k-{uid}"
        type="range"
        min="0"
        max={CYCLE}
        value={k}
        oninput={(event) => {
          playing = false;
          go(event.currentTarget.valueAsNumber);
        }}
      />
      <output for="k-{uid}">2<sup>{k}</sup> = {current}</output>
    </div>
    <div class="buttons">
      <button type="button" onclick={() => ((playing = false), go(k - 1))} disabled={k === 0}>÷ 2</button>
      <button type="button" onclick={() => ((playing = false), go(k + 1))} disabled={k === CYCLE}>× 2</button>
      <button type="button" onclick={togglePlay} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
      <button type="button" onclick={() => ((playing = false), go(CYCLE))} disabled={k === CYCLE}>Show all</button>
    </div>
  </div>

  <div class="readout" aria-live="polite">
    {#if pointed === null}
      <p>
        {#if step === null}
          2<sup>0</sup> = 1, the start of the cycle. Press × 2 to take a step.
        {:else}
          2<sup>{k}</sup> = 2 × 2<sup>{k - 1}</sup>: shift <code>{bitsOf(step.before, 8)}</code> left to get
          {#if step.overflow}
            <code>{bitsOf(step.shifted, 9)}</code>. That's 9 bits, so XOR with <code>{PRIME_MODULUS.toString(2)}</code>
            to get <code>{bitsOf(current, 8)}</code> = {current}.
          {:else}
            <code>{bitsOf(current, 8)}</code> = {current}.
          {/if}
          {#if k === CYCLE}
            Back to 1: the powers have visited all 255 non-zero bytes, each once, and from here they repeat.
          {/if}
        {/if}
      </p>
    {/if}
    <p>
      {focus} = 2<sup>{focusLog}</sup>, so its log is {focusLog}.
      {#if focus === 1}
        1 is its own inverse.
      {:else}
        Its inverse is 2<sup>{CYCLE - focusLog}</sup> = {focusInverse}, because 2<sup>{focusLog}</sup> × 2<sup
          >{CYCLE - focusLog}</sup
        > = 2<sup>255</sup> = 1.
      {/if}
    </p>
  </div>

  <div
    class="table"
    role="img"
    aria-label="All 256 bytes, by first and second hexadecimal digit, with the log of each of the {k >= CYCLE
      ? 255
      : k + 1} powers of 2 found so far"
    onpointerleave={(event) => event.pointerType !== 'touch' && (pointed = null)}
  >
    <span class="corner"></span>
    {#each HEX as digit (digit)}
      <span class="head">{digit}</span>
    {/each}
    {#each HEX as high, row (high)}
      <span class="head">{high}</span>
      {#each HEX as _, col (col)}
        {@const byte = row * 16 + col}
        {@const seen = visited(byte)}
        <span
          class="cell"
          class:zero={byte === 0}
          class:seen
          class:current={byte === current}
          class:pointed={byte === pointed}
          class:inverse={byte === focusInverse && byte !== focus}
          role="presentation"
          onpointerenter={() => seen && (pointed = byte)}
          onpointerdown={() => seen && (pointed = byte)}>{seen ? LOGS[byte] : ''}</span
        >
      {/each}
    {/each}
  </div>
  <p class="key">
    Each square is a byte, placed by its two hexadecimal digits: row 1, column D is <code>1D</code>, or 29. The
    number in it is its log.
    <span class="sample current"></span> the latest power ·
    <span class="sample inverse"></span> the inverse of {pointed === null ? 'the latest power' : 'the byte you point at'}
    · <span class="sample zero"></span> 0, which is never reached
  </p>
</figure>

<style>
  .powers {
    container-type: inline-size;
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
  }

  .field {
    display: flex;
    flex: 1 1 16rem;
    align-items: center;
    gap: 0.5rem;
  }

  .field input {
    flex: 1;
    min-width: 0;
  }

  output {
    min-width: 7.5ch;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .buttons button {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .buttons button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .buttons button[aria-pressed='true'] {
    border-color: var(--link);
  }

  .readout {
    min-height: 5.5em;
    margin: 0.75rem 0;
  }

  .readout p {
    margin: 0.25rem 0;
  }

  code {
    overflow-wrap: anywhere;
  }

  /* A 16 × 16 table of bytes, with a header row and column of hexadecimal digits. */
  .table {
    display: grid;
    grid-template-columns: 1.25em repeat(16, minmax(0, 1fr));
    gap: 1px;
    max-width: 34rem;
    font-size: clamp(0.5rem, 2.4cqi, 0.8125rem);
    font-variant-numeric: tabular-nums;
    text-align: center;
    touch-action: manipulation;
  }

  .head,
  .corner {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: 1.6;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: 2px;
    background: color-mix(in srgb, var(--muted) 8%, transparent);
    line-height: 1;
    user-select: none;
  }

  .cell.seen {
    background: color-mix(in srgb, var(--link) 22%, var(--surface));
    cursor: pointer;
  }

  .cell.zero,
  .sample.zero {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--muted) 30%, transparent) 0 2px,
      transparent 2px 5px
    );
  }

  .cell.current,
  .sample.current {
    background: var(--link);
    color: var(--bg);
    font-weight: 700;
  }

  .cell.pointed {
    outline: 2px solid var(--text);
    outline-offset: -1px;
  }

  .cell.inverse,
  .sample.inverse {
    box-shadow: inset 0 0 0 2px var(--text);
  }

  .key {
    margin: 0.75rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .sample {
    display: inline-block;
    width: 0.9em;
    height: 0.9em;
    margin-left: 0.25em;
    border-radius: 2px;
    vertical-align: -0.1em;
  }
</style>
