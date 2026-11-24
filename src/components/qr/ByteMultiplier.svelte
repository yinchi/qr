<script lang="ts">
  import { bitLength } from '../../lib/qr/cyclic';
  import { CYCLE, LOGS, multiplyLongHand, PRIME_MODULUS } from '../../lib/qr/gf256';

  const uid = $props.id();

  /** The product of two polynomials of degree 7 has degree up to 14: 15 bits. */
  const WIDTH = 15;
  const SAMPLES: [number, number][] = [
    [87, 131],
    [3, 3],
    [128, 2],
    [142, 2],
  ];
  const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

  const bitsOf = (value: number, n: number) => Array.from({ length: n }, (_, k) => (value >> (n - 1 - k)) & 1);
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const sup = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('');
  /** A byte as the polynomial it stands for, such as x⁶ + x⁴ + x² + x + 1. */
  const polynomial = (value: number) =>
    bitsOf(value, 8)
      .map((bit, k) => (bit ? 7 - k : -1))
      .filter((power) => power >= 0)
      .map((power) => (power === 0 ? '1' : power === 1 ? 'x' : `x${sup(power)}`))
      .join(' + ') || '0';

  let bytes = $state({ a: 87, b: 131 });
  const long = $derived(multiplyLongHand(bytes.a, bytes.b));

  function set(name: 'a' | 'b', value: number) {
    if (Number.isInteger(value) && value >= 0 && value <= 255) bytes[name] = value;
  }

  interface Row {
    /** Operator and what the row is, such as ⊕ and a·x³. */
    op: string;
    label: string;
    cells: (number | null)[];
    /** Cells left of the leading 1 of a value row. */
    cleared: number;
    kind: 'partial' | 'value' | 'modulus';
  }

  const valueRow = (op: string, label: string, value: number): Row => ({
    op,
    label,
    cells: bitsOf(value, WIDTH),
    cleared: WIDTH - Math.max(bitLength(value), 1),
    kind: 'value',
  });

  /** Only the 8 or 9 cells a shifted copy covers, so each copy stands out. */
  const shiftedRow = (op: string, label: string, value: number, shift: number, bits: number, kind: Row['kind']): Row => ({
    op,
    label,
    cells: bitsOf(value, WIDTH).map((bit, k) => {
      const position = WIDTH - 1 - k;
      return position >= shift && position < shift + bits ? bit : null;
    }),
    cleared: 0,
    kind,
  });

  const xPower = (shift: number) => (shift === 0 ? '' : shift === 1 ? '·x' : `·x${sup(shift)}`);

  const multiplication = $derived([
    ...long.partials.map(({ shift, value }, i) =>
      shiftedRow(i === 0 ? '' : '⊕', `a${xPower(shift)}`, value, shift, 8, 'partial'),
    ),
    ...(long.partials.length ? [valueRow('=', '', long.product)] : []),
  ]);

  const reduction = $derived.by(() => {
    const rows: Row[] = [valueRow('', '', long.product)];
    let value = long.product;
    for (const step of long.steps) {
      rows.push(shiftedRow('⊕', `p${xPower(step.shift)}`, step.shifted, step.shift, 9, 'modulus'));
      value ^= step.shifted;
      rows.push(valueRow('=', '', value));
    }
    return rows;
  });

  const logs = $derived({ a: LOGS[bytes.a], b: LOGS[bytes.b] });
</script>

{#snippet byteInput(name: 'a' | 'b')}
  {@const value = bytes[name]}
  <div class="byte" role="group" aria-label="Byte {name}">
    <span class="name">{name}</span>
    <span class="bit-buttons">
      {#each bitsOf(value, 8) as bit, k (k)}
        <button
          type="button"
          aria-pressed={bit === 1}
          aria-label="Bit {7 - k} of {name}"
          onclick={() => set(name, value ^ (1 << (7 - k)))}>{bit}</button
        >
      {/each}
    </span>
    <label class="decimal">
      <span class="visually-hidden">{name} in decimal</span>
      <input
        type="number"
        min="0"
        max="255"
        {value}
        oninput={(event) => set(name, event.currentTarget.valueAsNumber)}
      />
    </label>
    <span class="poly">= {polynomial(value)}</span>
  </div>
{/snippet}

{#snippet grid(rows: Row[], label: string, final: boolean)}
  <div class="grid" style:--cells={WIDTH} role="group" aria-label={label}>
    {#each rows as row, r (r)}
      <span class="label" aria-hidden="true"><span class="op">{row.op}</span> {row.label}</span>
      {#each row.cells as cell, k (k)}
        <span
          class="cell"
          class:modulus={row.kind === 'modulus'}
          class:cleared={k < row.cleared}
          class:split={k === WIDTH - 8}
          class:result={final && r === rows.length - 1 && k >= WIDTH - 8}>{cell ?? ''}</span
        >
      {/each}
    {/each}
  </div>
{/snippet}

<figure class="multiplier">
  {@render byteInput('a')}
  {@render byteInput('b')}
  <div class="samples">
    <span>Try:</span>
    {#each SAMPLES as [a, b] (`${a}×${b}`)}
      <button type="button" onclick={() => (bytes = { a, b })}>{a} × {b}</button>
    {/each}
  </div>

  <h4>1. Multiply the polynomials</h4>
  {#if long.partials.length === 0}
    <p class="step">b is 0, so there is nothing to add up: the product is 0.</p>
  {:else}
    <p class="step">
      One copy of a for each 1 in b, shifted left by that bit's position, all added together with XOR:
    </p>
    {@render grid(multiplication, 'Multiplication, one row per 1 bit of b', long.steps.length === 0)}
  {/if}

  <h4>2. Divide by p(x) and keep the remainder</h4>
  {#if long.steps.length === 0}
    <p class="step">The product already fits in 8 bits, so there is nothing to divide.</p>
  {:else}
    <p class="step">
      The product has {bitLength(long.product)} bits, too many for a byte. Divide by p(x) =
      <code>{PRIME_MODULUS.toString(2)}</code>, XORing it in under each leading 1 until 8 bits are left:
    </p>
    {@render grid(reduction, 'Long division by p(x), one row per step', true)}
  {/if}
  <p class="key">
    <span class="sample cleared">0</span> zeros left of the leading 1 ·
    <span class="sample modulus">1</span> p(x) ·
    <span class="sample result">1</span> the answer · the dashed line marks the right-hand 8 bits, a byte
  </p>

  <p class="answer" aria-live="polite">
    {bytes.a} × {bytes.b} = <strong>{long.result}</strong>
    <span class="aside">({hex(long.result)} in hexadecimal, <code>{bitsOf(long.result, 8).join('')}</code>)</span>
  </p>

  <h4>Check: add the logs</h4>
  {#if bytes.a === 0 || bytes.b === 0}
    <p class="step">0 isn't a power of 2, so it has no log. Anything times 0 is 0.</p>
  {:else}
    <p class="step">
      Using the log table from the next section: {bytes.a} = 2<sup>{logs.a}</sup> and {bytes.b} = 2<sup>{logs.b}</sup>,
      so their product is 2<sup>{logs.a} + {logs.b}</sup> = 2<sup>{logs.a + logs.b}</sup>{#if logs.a + logs.b >= CYCLE}{' '}= 2<sup
          >{logs.a + logs.b - CYCLE}</sup
        >, since 2<sup>255</sup> = 1{/if}. That's {long.result}.
    </p>
  {/if}
</figure>

<style>
  .multiplier {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .byte {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem 0.5rem;
    margin-bottom: 0.5rem;
  }

  .name {
    width: 1ch;
    font-style: italic;
    font-weight: 600;
  }

  .bit-buttons {
    display: flex;
    gap: 2px;
  }

  .bit-buttons button {
    width: 1.75rem;
    padding: 0.3rem 0;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--surface);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95rem;
    cursor: pointer;
  }

  .bit-buttons button[aria-pressed='true'] {
    border-color: var(--link);
    background: color-mix(in srgb, var(--link) 16%, var(--surface));
    font-weight: 700;
  }

  .decimal input {
    width: 4.25rem;
    padding: 0.25rem 0.375rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }

  .poly {
    color: var(--muted);
  }

  .samples {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.75rem;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .samples button {
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  h4 {
    margin: 1.25rem 0 0.25rem;
  }

  .step {
    margin: 0.5rem 0;
  }

  /* Long multiplication and division: a label column, then one column per bit. */
  .grid {
    display: grid;
    grid-template-columns: max-content repeat(var(--cells), minmax(0, 1.25em));
    width: max-content;
    max-width: 100%;
    margin: 0.75rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95rem;
    line-height: 1.5;
    text-align: center;
  }

  .label {
    padding-right: 0.375rem;
    color: var(--muted);
    font-family: system-ui, sans-serif;
    font-size: 0.75rem;
    line-height: 1.9;
    text-align: right;
    white-space: nowrap;
  }

  .label .op {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95rem;
  }

  .modulus {
    color: var(--link);
  }

  .cleared {
    color: var(--muted);
    opacity: 0.55;
  }

  .cell.split {
    border-left: 1px dashed var(--muted);
  }

  .cell.result,
  .sample.result {
    border-top: 1px solid var(--text);
    background: color-mix(in srgb, var(--link) 14%, transparent);
    font-weight: 700;
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

  .answer {
    margin: 0.75rem 0;
    font-size: 1.0625rem;
  }

  .answer .aside {
    color: var(--muted);
    font-size: 0.9375rem;
  }

  code {
    overflow-wrap: anywhere;
  }
</style>
