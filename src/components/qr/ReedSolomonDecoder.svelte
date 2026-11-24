<script lang="ts">
  import { generatorPolynomial } from '../../lib/qr/gf256';
  import { decode, errorCorrectionCodewords, powerOf, protectionFor } from '../../lib/qr/rs';
  import { EC_BYTES, example, PROTECTION } from './reed-solomon-example.svelte';

  const uid = $props.id();

  const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sup = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('');
  const xPower = (power: number) => (power === 0 ? '1' : power === 1 ? 'x' : `x${sup(power)}`);
  /** A polynomial with byte coefficients, highest power first, as text: x² + 233x + 24. */
  const polynomial = (p: readonly number[]) =>
    p
      .map((c, m) => ({ c, power: p.length - 1 - m }))
      .filter(({ c }) => c !== 0)
      .map(({ c, power }) => (power === 0 ? String(c) : `${c === 1 ? '' : c}${xPower(power)}`))
      .join(' + ') || '0';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const list = (items: (string | number)[]) =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

  type Damage = { kind: 'error'; delta: number } | { kind: 'erasure' };
  type Tool = 'change' | 'erase' | 'restore';

  const g = generatorPolynomial(EC_BYTES);
  /** Damage patterns to try, by codeword index. The last one lands 5 bytes from another valid block: g(x)·x¹⁵ away. */
  const PRESETS: { label: string; damage: Record<number, Damage> }[] = [
    { label: '1 error', damage: { 5: { kind: 'error', delta: 127 } } },
    { label: '2 errors', damage: { 2: { kind: 'error', delta: 90 }, 20: { kind: 'error', delta: 49 } } },
    {
      label: '4 errors',
      damage: Object.fromEntries(
        [0, 7, 16, 25].map((index, k) => [index, { kind: 'error', delta: [1, 200, 33, 99][k] } as Damage]),
      ),
    },
    {
      label: '2 errors, 4 erasures',
      damage: {
        3: { kind: 'error', delta: 17 },
        18: { kind: 'error', delta: 160 },
        9: { kind: 'erasure' },
        10: { kind: 'erasure' },
        11: { kind: 'erasure' },
        12: { kind: 'erasure' },
      },
    },
    {
      label: '7 erasures',
      damage: Object.fromEntries([8, 9, 10, 11, 12, 13, 14].map((index) => [index, { kind: 'erasure' } as Damage])),
    },
    {
      label: '6 errors that fool it',
      damage: Object.fromEntries(g.slice(0, 6).map((delta, index) => [index, { kind: 'error', delta } as Damage])),
    },
  ];

  let damage: Record<number, Damage> = $state({});
  let tool: Tool = $state('change');
  let protect = $state(true);

  const k = $derived(example.data.length);
  const sent = $derived([...example.data, ...errorCorrectionCodewords(example.data, EC_BYTES)]);
  const length = $derived(sent.length);
  /** Erased bytes are read as 0; the decoder ignores their values. */
  const received = $derived(
    sent.map((c, i) => (damage[i]?.kind === 'error' ? c ^ (damage[i] as { delta: number }).delta : damage[i] ? 0 : c)),
  );
  const erasures = $derived(sent.map((_, i) => i).filter((i) => damage[i]?.kind === 'erasure'));
  const errorCount = $derived(Object.values(damage).filter((d) => d.kind === 'error').length);
  const p = $derived(protect ? protectionFor(PROTECTION, EC_BYTES, erasures.length) : 0);
  const usable = $derived(EC_BYTES - p);
  const used = $derived(2 * errorCount + erasures.length);
  const result = $derived(decode(received, EC_BYTES, { erasures, protection: p }));
  const reducedCount = $derived(result.reduced.length);
  /** No erasures, and every syndrome 0: the block is accepted as it is. */
  const nothingWrong = $derived(erasures.length === 0 && result.syndromes.every((s) => s === 0));

  /** One square per error correction byte: what the damage uses, and which are kept back. */
  const slots = $derived(
    Array.from({ length: Math.max(EC_BYTES, used) }, (_, s) => ({
      fill: s < 2 * errorCount ? 'error' : s < used ? 'erasure' : 'none',
      kept: s >= usable && s < EC_BYTES,
      over: s >= usable,
    })),
  );

  const outcome = $derived.by(() => {
    const repaired = result.corrected;
    if (!repaired) {
      if (result.failure === 'erasures') {
        return {
          tone: 'fail',
          text: `Can't correct: ${plural(erasures.length, 'erasure')} need as many syndromes, but only ${usable} can be used. The scanner reports the block as unreadable.`,
        };
      }
      return {
        tone: 'fail',
        text: `Can't correct: no error locator with up to ${plural(result.maxErrors, 'error')} explains the syndromes. The decoder knows the block is too badly damaged, and the scanner reports it as unreadable.`,
      };
    }
    const wrongData = repaired.slice(0, k).filter((c, i) => c !== sent[i]).length;
    if (repaired.some((c, i) => c !== sent[i])) {
      return {
        tone: 'fail',
        text: `Wrong: the decoder found ${plural(result.errors.length, 'error')} and corrected them, but that made a different valid block. ${wrongData} of the ${k} data bytes now differ from what was sent, and the scanner can't tell.`,
      };
    }
    if (result.corrections.length === 0) return { tone: 'ok', text: 'No errors: every syndrome is 0.' };
    return {
      tone: 'ok',
      text: `Corrected ${list([
        ...(result.errors.length ? [plural(result.errors.length, 'error')] : []),
        ...(erasures.length ? [plural(erasures.length, 'erasure')] : []),
      ])}: the block is back to what was sent.`,
    };
  });

  function select(index: number) {
    if (tool === 'restore') {
      delete damage[index];
    } else if (tool === 'erase') {
      if (damage[index]?.kind === 'erasure') delete damage[index];
      else damage[index] = { kind: 'erasure' };
    } else {
      const current = damage[index]?.kind === 'error' ? (damage[index] as { delta: number }).delta : 0;
      let delta = current;
      while (delta === current) delta = 1 + Math.floor(Math.random() * 255);
      damage[index] = { kind: 'error', delta };
    }
  }

  const byteName = (index: number) => `byte ${index + 1} (${xPower(powerOf(index, length))})`;
</script>

<figure class="decoder">
  <p class="intro">
    The block encoded above, “{example.text}”: {k} data bytes, then {EC_BYTES} error correction bytes.
  </p>

  <div class="tools" role="radiogroup" aria-label="What selecting a byte does">
    <span>Select a byte to:</span>
    <label class="choice"><input type="radio" name="tool-{uid}" value="change" bind:group={tool} /> Change it</label>
    <label class="choice"><input type="radio" name="tool-{uid}" value="erase" bind:group={tool} /> Erase it</label>
    <label class="choice"><input type="radio" name="tool-{uid}" value="restore" bind:group={tool} /> Restore it</label>
  </div>

  <div class="bytes" role="group" aria-label="The block as read">
    {#each received as value, index (index)}
      {@const d = damage[index]}
      <button
        type="button"
        class="byte"
        class:ec={index >= k}
        class:error={d?.kind === 'error'}
        class:erasure={d?.kind === 'erasure'}
        title="Byte {index + 1}, the coefficient of {xPower(powerOf(index, length))}"
        aria-label="{byteName(index)}: {d?.kind === 'erasure' ? 'erased' : value}{d?.kind === 'error'
          ? `, changed from ${sent[index]}`
          : ''}"
        onclick={() => select(index)}>{d?.kind === 'erasure' ? '?' : value}</button
      >
    {/each}
  </div>
  <p class="key">
    <span class="sample">16</span> data · <span class="sample ec">165</span> error correction ·
    <span class="sample error">255</span> changed: an error · <span class="sample erasure">?</span> erased
  </p>

  <div class="presets">
    <span>Try:</span>
    {#each PRESETS as preset (preset.label)}
      <button type="button" onclick={() => (damage = { ...preset.damage })}>{preset.label}</button>
    {/each}
    <button type="button" onclick={() => (damage = {})} disabled={Object.keys(damage).length === 0}>Reset</button>
  </div>

  <label class="protect">
    <input type="checkbox" bind:checked={protect} />
    Keep back {protectionFor(PROTECTION, EC_BYTES, erasures.length)} error correction bytes to check the answer (misdecode
    protection, 7.5.1)
  </label>

  <div class="budget">
    <div class="slots" aria-hidden="true">
      {#each slots as slot, s (s)}
        <span class="slot {slot.fill}" class:kept={slot.kept} class:over={slot.over && slot.fill !== 'none'}></span>
      {/each}
    </div>
    <p class="budget-text">
      {errorCount} × 2 for errors + {erasures.length} for erasures = <strong>{used}</strong>
      {used <= usable ? 'of' : 'is more than'} the {usable} this block can use{p
        ? `: ${EC_BYTES} error correction bytes, ${p} kept back`
        : ''}.
    </p>
  </div>

  <h4>1. Syndromes</h4>
  <p class="step">
    <span class="values"
      >{#each result.syndromes as s, i (i)}<span class:zero={s === 0}>S<sub>{i}</sub> = {s}</span>{/each}</span
    >
    {#if result.syndromes.every((s) => s === 0)}
      All 0{erasures.length ? '.' : ': nothing to correct.'}
    {/if}
  </p>

  {#if erasures.length}
    <h4>Cancel the erasures</h4>
    {#if reducedCount === 0}
      <p class="step">With {plural(erasures.length, 'erasure')}, no syndromes are left over.</p>
    {:else}
      <p class="step">
        Cancelling {plural(erasures.length, 'erasure')} ({list(erasures.map((i) => i + 1))}) leaves {reducedCount}
        reduced {reducedCount === 1 ? 'syndrome' : 'syndromes'}:
        <span class="values"
          >{#each result.reduced as s, i (i)}<span class:zero={s === 0}>{s}</span>{/each}</span
        >
      </p>
    {/if}
  {/if}

  {#if result.failure !== 'erasures' && !nothingWrong}
    <h4>2. Find the error locator</h4>
    <ul class="trials">
      {#each result.trials as trial (trial.count)}
        <li>
          {plural(trial.count, 'error')}?
          {#if trial.count === 0}
            {trial.fits ? 'Yes: once the erasures are cancelled, every syndrome is 0.' : 'No: the syndromes aren’t all 0.'}
          {:else if !trial.locator}
            No: the equations for σ(x) have no single solution.
          {:else}
            σ(x) = {polynomial(trial.locator)}, which
            {trial.fits ? 'fits every syndrome.' : 'doesn’t fit them all.'}
          {/if}
        </li>
      {/each}
    </ul>
    {#if result.failure === 'errors' && !result.locator}
      <p class="step">
        None of them fits, and {result.maxErrors} is the most errors the decoder may look for here, as
        {erasures.length} + 2 × {result.maxErrors} ≤ {usable}.
      </p>
    {/if}
  {/if}

  {#if result.locator && result.locator.length > 1}
    <p class="step">
      Trying all {length} bytes:
      {#if result.errors.length}
        σ(α<sup>j</sup>) = 0 for j = {list(result.errors.map((i) => powerOf(i, length)))}, so the
        {result.errors.length === 1 ? 'error is in byte' : 'errors are in bytes'}
        {list(result.errors.map((i) => i + 1))}.
      {:else}
        σ(α<sup>j</sup>) is never 0.
      {/if}
      {#if result.failure === 'roots'}
        That's {result.errors.length} roots, not {result.locator.length - 1}, so these can't be the errors.
      {/if}
    </p>
  {/if}

  {#if result.corrections.length}
    <h4>3. Find the error values, and correct</h4>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Byte</th>
            <th>Read</th>
            <th>Error value</th>
            <th>Corrected</th>
          </tr>
        </thead>
        <tbody>
          {#each [...result.corrections].sort((a, b) => a.index - b.index) as { index, value } (index)}
            {@const corrected = received[index] ^ value}
            <tr>
              <td class="nowrap">{index + 1} <span class="power">{xPower(powerOf(index, length))}</span></td>
              <td>{damage[index]?.kind === 'erasure' ? '?' : received[index]}</td>
              <td>{value}</td>
              <td class="nowrap"
                >{corrected}
                {#if corrected === sent[index]}<span class="match">✓</span>{:else}<span class="mismatch"
                    >✗ sent {sent[index]}</span
                  >{/if}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <p class="outcome {outcome.tone}" aria-live="polite">
    <span class="icon" aria-hidden="true">{outcome.tone === 'ok' ? '✓' : '✗'}</span>{outcome.text}
  </p>
</figure>

<style>
  .decoder {
    /* Status colours from the dataviz reference palette; each outcome also has an icon and a label. */
    --good: #0ca30c;
    --critical: #d03b3b;
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .intro {
    margin: 0 0 0.75rem;
  }

  .tools,
  .presets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    margin: 0.5rem 0;
    font-size: 0.9375rem;
  }

  .choice {
    white-space: nowrap;
  }

  .presets {
    gap: 0.375rem;
    color: var(--muted);
  }

  .presets button {
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .presets button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .bytes {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin: 0.75rem 0 0.5rem;
  }

  .byte,
  .sample {
    min-width: 2.75em;
    padding: 0.3rem 0;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .byte {
    cursor: pointer;
  }

  .byte.ec,
  .sample.ec {
    border-style: dashed;
    border-color: var(--muted);
  }

  .byte.error,
  .sample.error {
    border-style: solid;
    border-color: var(--critical);
    background: color-mix(in srgb, var(--critical) 18%, var(--surface));
    font-weight: 700;
  }

  .byte.erasure,
  .sample.erasure {
    border-style: solid;
    border-color: var(--muted);
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--muted) 28%, var(--surface)) 0 2px,
      var(--surface) 2px 6px
    );
    color: var(--muted);
    font-weight: 700;
  }

  .key {
    margin: 0 0 0.5rem;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .sample {
    display: inline-block;
    min-width: 2.5em;
    padding: 0;
    font-size: 0.8125rem;
  }

  .protect {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0.75rem 0;
    font-size: 0.9375rem;
  }

  .budget {
    margin: 0.75rem 0 1rem;
  }

  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .slot {
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid var(--muted);
    border-radius: 3px;
  }

  .slot.error {
    border-color: var(--critical);
    background: color-mix(in srgb, var(--critical) 55%, var(--surface));
  }

  .slot.erasure {
    background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 5px);
  }

  .slot.kept {
    border-style: dashed;
  }

  .slot.over {
    outline: 2px solid var(--critical);
    outline-offset: 1px;
  }

  .budget-text {
    margin: 0.375rem 0 0;
    font-size: 0.9375rem;
  }

  h4 {
    margin: 1.25rem 0 0.25rem;
  }

  .step {
    margin: 0.5rem 0;
  }

  .values {
    display: flex;
    flex-wrap: wrap;
    gap: 0.125rem 0.75rem;
    margin: 0.25rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .values .zero {
    color: var(--muted);
  }

  .trials {
    margin: 0.25rem 0;
    padding-left: 1.25rem;
  }

  .power {
    color: var(--muted);
    font-size: 0.875em;
  }

  .nowrap {
    white-space: nowrap;
  }

  .match,
  .mismatch {
    font-weight: 700;
  }

  .mismatch {
    font-size: 0.875em;
  }

  .table-wrap {
    margin: 0.5rem 0;
  }

  .table-wrap :global(th),
  .table-wrap :global(td) {
    padding-inline: 0.5rem;
    font-variant-numeric: tabular-nums;
  }

  .outcome {
    display: flex;
    gap: 0.5rem;
    margin: 0.75rem 0 0;
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

  .icon {
    font-weight: 700;
  }
</style>
