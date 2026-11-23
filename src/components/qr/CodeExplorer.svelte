<script lang="ts">
  import { bitLength, divide, hammingDistance, popCount } from '../../lib/qr/cyclic';
  import { EC_LEVELS, type EcLevel } from '../../lib/qr/ec';
  import {
    EC_LEVEL_BITS,
    FORMAT_CODEWORDS,
    FORMAT_DATA_BITS,
    FORMAT_INFO_BITS,
    FORMAT_INFO_GENERATOR,
    FORMAT_INFO_MASK,
    formatData,
  } from '../../lib/qr/format';
  import { MAX_VERSION } from '../../lib/qr/layout';
  import {
    FIRST_VERSION_WITH_INFO,
    VERSION_CODEWORDS,
    VERSION_DATA_BITS,
    VERSION_INFO_BITS,
    VERSION_INFO_GENERATOR,
  } from '../../lib/qr/version-info';

  interface Props {
    /** The format information's (15, 5) BCH code, or the version information's (18, 6) Golay code. */
    kind: 'format' | 'version';
  }

  const { kind }: Props = $props();
  const uid = $props.id();

  /** Bits of `value`, most significant first, padded to `n` bits. */
  const bitsOf = (value: number, n: number) => Array.from({ length: n }, (_, k) => (value >> (n - 1 - k)) & 1);

  let level: EcLevel = $state('M');
  let mask = $state(0b101);
  let version = $state(FIRST_VERSION_WITH_INFO);

  const isFormat = $derived(kind === 'format');
  const width = $derived(isFormat ? FORMAT_INFO_BITS : VERSION_INFO_BITS);
  const dataBits = $derived(isFormat ? FORMAT_DATA_BITS : VERSION_DATA_BITS);
  const generator = $derived(isFormat ? FORMAT_INFO_GENERATOR : VERSION_INFO_GENERATOR);
  const data = $derived(isFormat ? formatData(level, mask) : version);
  const division = $derived(divide(data, dataBits, generator));
  const codeword = $derived(division.dividend | division.remainder);
  const sent = $derived(isFormat ? codeword ^ FORMAT_INFO_MASK : codeword);

  /** Bits the reader has flipped. They belong to one sent codeword, and are dropped when the inputs change. */
  let flips = $state({ sent: -1, errors: 0 });
  const errors = $derived(flips.sent === sent ? flips.errors : 0);
  const received = $derived(sent ^ errors);
  const receivedBits = $derived(bitsOf(received, width));

  const bits3 = (n: number) => n.toString(2).padStart(3, '0');
  const candidates = $derived(
    isFormat
      ? FORMAT_CODEWORDS.map((c) => ({
          label: `level ${c.level}, mask ${bits3(c.mask)}`,
          short: `${c.level} · ${bits3(c.mask)}`,
          bits: c.bits,
        }))
      : VERSION_CODEWORDS.map((c) => ({ label: `version ${c.version}`, short: String(c.version), bits: c.bits })),
  );
  const ranked = $derived(
    candidates
      .map((c) => ({ ...c, distance: hammingDistance(received, c.bits) }))
      .sort((a, b) => a.distance - b.distance),
  );
  const nearest = $derived(ranked[0]);
  const sentLabel = $derived(candidates.find((c) => c.bits === sent)?.label ?? '');
  const flipped = $derived(popCount(errors));
  const outcome = $derived.by(() => {
    const d = nearest.distance;
    const bitsWord = (n: number) => `${n} bit${n === 1 ? '' : 's'}`;
    if (d > 3) {
      return {
        tone: 'fail',
        text: `Rejected: the closest valid codeword (${nearest.label}) is ${bitsWord(d)} away, more than 3, so the decoder gives up on this copy and tries the other one.`,
      };
    }
    if (nearest.bits !== sent) {
      return {
        tone: 'fail',
        text: `Wrong: the closest valid codeword is ${nearest.label}, ${bitsWord(d)} away, so the decoder picks it. But ${sentLabel} was sent: with ${bitsWord(flipped)} flipped, the damage landed closer to a different codeword.`,
      };
    }
    if (d === 0) return { tone: 'ok', text: `No errors: these bits are a valid codeword (${nearest.label}).` };
    return {
      tone: 'ok',
      text: `Corrected: the closest valid codeword is ${bitsWord(d)} away, and it is the one that was sent (${nearest.label}).`,
    };
  });

  function flip(k: number) {
    flips = { sent, errors: errors ^ (1 << (width - 1 - k)) };
  }

  function flipRandom() {
    const clean = bitsOf(errors, width)
      .map((bit, k) => (bit ? -1 : k))
      .filter((k) => k >= 0);
    if (clean.length) flip(clean[Math.floor(Math.random() * clean.length)]);
  }

  /**
   * Division rows for display: the dividend, then each shifted generator and the result of XORing it in. `cleared` is
   * the number of cells left of the leading 1 of a value row: zeros with nothing left to divide.
   */
  const rows = $derived.by(() => {
    const { dividend, steps, degree } = division;
    const out: { kind: 'start' | 'xor' | 'result'; cells: (number | null)[]; cleared: number }[] = [];
    const valueRow = (kind: 'start' | 'result', value: number) => ({
      kind,
      cells: bitsOf(value, width),
      cleared: width - bitLength(value),
    });
    out.push(valueRow('start', dividend));
    let value = dividend;
    for (const step of steps) {
      const cells = bitsOf(step.shifted, width).map((bit, k) => {
        const position = width - 1 - k;
        return position >= step.shift && position <= step.shift + degree ? bit : null;
      });
      out.push({ kind: 'xor', cells, cleared: 0 });
      value ^= step.shifted;
      out.push(valueRow('result', value));
    }
    return out;
  });

  /** Index of the first cell that is part of the remainder. */
  const remainderStart = $derived(width - division.degree);
</script>

<figure class="code-explorer">
  <div class="controls">
    {#if isFormat}
      <div class="field choices" role="radiogroup" aria-labelledby="level-label-{uid}">
        <span id="level-label-{uid}">Error correction level</span>
        {#each EC_LEVELS as l (l)}
          <label class="choice"><input type="radio" name="level-{uid}" value={l} bind:group={level} /> {l}</label>
        {/each}
      </div>
      <div class="field">
        <label for="mask-{uid}">Mask pattern</label>
        <select id="mask-{uid}" bind:value={mask}>
          {#each [0, 1, 2, 3, 4, 5, 6, 7] as m (m)}
            <option value={m}>{bits3(m)}</option>
          {/each}
        </select>
      </div>
    {:else}
      <div class="field grow">
        <label for="version-{uid}">Version</label>
        <input id="version-{uid}" type="range" min={FIRST_VERSION_WITH_INFO} max={MAX_VERSION} bind:value={version} />
        <output for="version-{uid}">{version}</output>
      </div>
    {/if}
  </div>

  <h4>Encoding</h4>
  <p class="step">
    {#if isFormat}
      Data bits: level {level} is <code>{EC_LEVEL_BITS[level].toString(2).padStart(2, '0')}</code>, mask
      <code>{bits3(mask)}</code>, giving <code>{bitsOf(data, dataBits).join('')}</code>.
    {:else}
      Data bits: {version} in binary is <code>{bitsOf(data, dataBits).join('')}</code>.
    {/if}
    Append {division.degree} zeros, then divide by the generator <code>{generator.toString(2)}</code>, XORing it in under
    each leading 1:
  </p>

  <div class="division" style:--cells={width} role="group" aria-label="Long division, one row per step">
    {#each rows as row, r (r)}
      <span class="op" aria-hidden="true">{row.kind === 'xor' ? '⊕' : row.kind === 'result' ? '=' : ''}</span>
      {#each row.cells as cell, k (k)}
        <span
          class="cell"
          class:xor={row.kind === 'xor'}
          class:cleared={k < row.cleared}
          class:split={k === remainderStart}
          class:remainder={r === rows.length - 1 && k >= remainderStart}>{cell ?? ''}</span
        >
      {/each}
    {/each}
  </div>
  <p class="key">
    <span class="sample cleared">0</span> zeros left of the leading 1, with nothing left to divide ·
    <span class="sample xor">1</span> the generator ·
    <span class="sample remainder">1</span> the remainder · the dashed line marks where the {division.degree} appended zeros
    start
  </p>
  {#if division.steps.length === 0}
    <p class="note">The data bits are all zero, so there is nothing to divide: the remainder is zero too.</p>
  {/if}

  <p class="step">
    The last {division.degree} bits are the remainder: the error correction bits. Put them after the data bits:
    <code class="codeword"
      ><span>{bitsOf(data, dataBits).join('')}</span><span class="check"
        >{bitsOf(division.remainder, division.degree).join('')}</span
      ></code
    >.
    {#if isFormat}
      Finally, XOR with <code>{bitsOf(FORMAT_INFO_MASK, width).join('')}</code> to get the bits stored in the code:
      <code class="codeword">{bitsOf(sent, width).join('')}</code>.
    {/if}
  </p>

  <h4>Decoding</h4>
  <p class="step">
    Select bits to flip them, as if the code were damaged. The decoder compares what it reads with every valid
    codeword, {isFormat ? 32 : 34} in all, and takes the closest if it is no more than 3 bits away.
  </p>
  <div class="bits" style:--cells={width}>
    {#each receivedBits as bit, k (k)}
      <button
        type="button"
        class:flipped={(errors >> (width - 1 - k)) & 1}
        class:gap={k === dataBits}
        aria-pressed={((errors >> (width - 1 - k)) & 1) === 1}
        aria-label="Bit {width - 1 - k}: {bit}"
        onclick={() => flip(k)}>{bit}</button
      >
    {/each}
  </div>
  <div class="actions">
    <button type="button" onclick={flipRandom} disabled={flipped === width}>Flip a random bit</button>
    <button type="button" onclick={() => (flips = { sent, errors: 0 })} disabled={!errors}>Reset</button>
    <span class="count">{flipped} flipped</span>
  </div>
  <p class="outcome {outcome.tone}" aria-live="polite">
    <span class="icon" aria-hidden="true">{outcome.tone === 'ok' ? '✓' : '✗'}</span>{outcome.text}
  </p>

  <div class="table-wrap">
    <table>
      <caption>Closest valid codewords</caption>
      <thead>
        <tr>
          <th>{isFormat ? 'Level · mask' : 'Version'}</th>
          <th>Bits</th>
          <th style:text-align="right">Differs</th>
        </tr>
      </thead>
      <tbody>
        {#each ranked.slice(0, 4) as candidate (candidate.bits)}
          <tr>
            <td class="nowrap">{candidate.short}{#if candidate.bits === sent}<span class="sent">sent</span>{/if}</td>
            <td class="mono"
              >{#each bitsOf(candidate.bits, width) as bit, k (k)}<span class:differs={bit !== receivedBits[k]}
                  >{bit}</span
                >{/each}</td
            >
            <td style:text-align="right">{candidate.distance}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>

<style>
  .code-explorer {
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
    gap: 0.75rem 1.5rem;
  }

  .choices {
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
  }

  .choice {
    white-space: nowrap;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .grow {
    flex: 1 1 16rem;
  }

  .grow input {
    flex: 1;
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

  h4 {
    margin: 1.25rem 0 0.25rem;
  }

  .step,
  .note {
    margin: 0.5rem 0;
  }

  .note {
    color: var(--muted);
  }

  code {
    overflow-wrap: anywhere;
  }

  .codeword .check {
    color: var(--link);
    font-weight: 600;
  }

  /* Long division: an operator column, then one column per bit. */
  .division {
    display: grid;
    grid-template-columns: 1.5em repeat(var(--cells), minmax(0, 1.25em));
    width: max-content;
    max-width: 100%;
    margin: 0.75rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95rem;
    line-height: 1.5;
    text-align: center;
  }

  .op {
    color: var(--muted);
  }

  .xor {
    color: var(--link);
  }

  .key {
    margin: 0 0 0.75rem;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .sample {
    display: inline-block;
    min-width: 1.25em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: center;
  }

  .cleared {
    color: var(--muted);
    opacity: 0.55;
  }

  .cell.split {
    border-left: 1px dashed var(--muted);
  }

  .cell.remainder,
  .sample.remainder {
    border-top: 1px solid var(--text);
    background: color-mix(in srgb, var(--link) 14%, transparent);
    font-weight: 700;
  }

  /* Clickable bits for the decoder. */
  .bits {
    display: flex;
    gap: 2px;
    margin: 0.5rem 0;
  }

  .bits button {
    flex: 1 1 0;
    min-width: 0;
    max-width: 2rem;
    padding: 0.35rem 0;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95rem;
    cursor: pointer;
  }

  .bits button.gap {
    margin-left: 0.4rem;
  }

  .bits button.flipped {
    border-color: var(--critical);
    background: color-mix(in srgb, var(--critical) 18%, var(--surface));
    font-weight: 700;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .actions button {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .count {
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .outcome {
    display: flex;
    gap: 0.5rem;
    margin: 0.75rem 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid;
    border-radius: 0 4px 4px 0;
  }

  .outcome.ok {
    border-color: var(--good);
    background: color-mix(in srgb, var(--good) 10%, transparent);
  }

  .outcome.fail {
    border-color: var(--critical);
    background: color-mix(in srgb, var(--critical) 10%, transparent);
  }

  .table-wrap {
    margin: 0.75rem 0 0;
  }

  caption {
    padding: 0.5rem 0.875rem;
    text-align: start;
    font-weight: 600;
  }

  /* A compact table, so it fits a phone without scrolling. */
  .table-wrap :global(th),
  .table-wrap :global(td) {
    padding-inline: 0.5rem;
  }

  .nowrap {
    white-space: nowrap;
  }

  .sent {
    display: block;
    width: fit-content;
    margin-top: 0.15rem;
    padding: 0 0.3rem;
    border: 1px solid var(--rule);
    border-radius: 3px;
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .icon {
    font-weight: 700;
  }

  .differs {
    background: color-mix(in srgb, var(--critical) 28%, transparent);
    font-weight: 700;
    text-decoration: underline;
  }
</style>
