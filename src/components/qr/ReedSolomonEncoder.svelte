<script lang="ts">
  import { generatorPolynomial, multiply } from '../../lib/qr/gf256';
  import { errorCorrectionCodewords } from '../../lib/qr/rs';
  import { capacityFor, EC_BYTES, example, setExampleText } from './reed-solomon-example.svelte';

  const uid = $props.id();

  const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sup = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join('');
  /** x to a power, as text: 1, x, x², … */
  const xPower = (power: number) => (power === 0 ? '1' : power === 1 ? 'x' : `x${sup(power)}`);
  const MODE_NAMES = { numeric: 'Numeric', alphanumeric: 'Alphanumeric', byte: 'Byte', kanji: 'Kanji' };
  const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
  /** A number of bits as bytes, with any part byte as a fraction: 41 bits is 5⅛. */
  const bytes = (bits: number) => (bits === 0 ? '0' : `${Math.floor(bits / 8) || ''}${EIGHTHS[bits % 8]}`);

  const g = generatorPolynomial(EC_BYTES);

  let input = $state(example.text);
  let fits = $state(true);
  /** The step shown, from 1 to the number of data bytes. */
  let step = $state(1);

  const k = $derived(example.data.length);
  const length = $derived(k + EC_BYTES);
  const ec = $derived(errorCorrectionCodewords(example.data, EC_BYTES));
  const capacity = $derived(capacityFor(input));

  /** One step of the long division per data byte: subtract (leading byte) × g(x), lined up under the leading byte. */
  const steps = $derived.by(() => {
    const value = [...example.data, ...new Array<number>(EC_BYTES).fill(0)];
    return example.data.map((_, i) => {
      const before = value.slice(i, i + EC_BYTES + 1);
      const factor = value[i];
      const subtracted = g.map((c) => multiply(factor, c));
      subtracted.forEach((c, m) => (value[i + m] ^= c));
      return { factor, before, subtracted, after: value.slice(i, i + EC_BYTES + 1), state: [...value] };
    });
  });
  const shown = $derived(steps[Math.min(step, k) - 1]);
  const i = $derived(Math.min(step, k) - 1);

  function onText(text: string) {
    fits = setExampleText(text);
  }
</script>

<figure class="encoder">
  <div class="field">
    <label for="text-{uid}">Text</label>
    <input
      id="text-{uid}"
      type="text"
      autocomplete="off"
      spellcheck="false"
      bind:value={input}
      oninput={(event) => onText(event.currentTarget.value)}
    />
  </div>
  <p class="note" aria-live="polite">
    {#if fits}
      {MODE_NAMES[example.mode]} mode: {k} data bytes
      {#if example.textBits === 8 * k}
        all encoding the text,
      {:else}
        ({bytes(example.textBits)} encoding the text, {bytes(8 * k - example.textBits)} of padding),
      {/if}
      then {EC_BYTES} error correction bytes.
    {:else}
      Too long for version 1-M, which holds at most {capacity.max} characters in {capacity.mode} mode. Still showing
      “{example.text}”.
    {/if}
  </p>

  <div class="stepper">
    <label for="step-{uid}">Step</label>
    <button type="button" onclick={() => (step = Math.max(1, step - 1))} disabled={step <= 1} aria-label="Previous step"
      >◀</button
    >
    <input id="step-{uid}" type="range" min="1" max={k} bind:value={step} />
    <button type="button" onclick={() => (step = Math.min(k, step + 1))} disabled={step >= k} aria-label="Next step"
      >▶</button
    >
    <output for="step-{uid}">{Math.min(step, k)} of {k}</output>
  </div>

  <p class="step" aria-live="polite">
    {#if shown.factor === 0}
      The leading byte, the coefficient of {xPower(length - 1 - i)}, is already 0, so there is nothing to subtract.
    {:else}
      The leading byte, the coefficient of {xPower(length - 1 - i)}, is {shown.factor}. Subtract
      {shown.factor}{k - 1 - i === 0 ? '' : xPower(k - 1 - i)}·g(x): each coefficient of g(x) times {shown.factor}, lined
      up under it. That clears it to 0.
    {/if}
  </p>

  <div class="window" role="group" aria-label="Step {Math.min(step, k)} of the long division">
    <span class="label"></span>
    {#each shown.before as _, m (m)}
      <span class="power">{xPower(length - 1 - i - m)}</span>
    {/each}
    <span class="label">left</span>
    {#each shown.before as value, m (m)}
      <span class="cell" class:incoming={i + m >= k}>{value}</span>
    {/each}
    <span class="label"><span class="op">⊕</span> {shown.factor}·g</span>
    {#each shown.subtracted as value, m (m)}
      <span class="cell generator">{value}</span>
    {/each}
    <span class="label"><span class="op">=</span></span>
    {#each shown.after as value, m (m)}
      <span class="cell" class:cleared={m === 0}>{value}</span>
    {/each}
  </div>

  <div class="block" role="group" aria-label="The polynomial after step {Math.min(step, k)}">
    {#each shown.state as value, index (index)}
      <span
        class="byte"
        class:cleared={index <= i}
        class:in-window={index > i && index <= i + EC_BYTES}
        class:ec={index >= k}
        class:result={index >= k && step >= k}>{value}</span
      >
    {/each}
  </div>
  <p class="key">
    After this step: <span class="sample cleared">0</span> cleared ·
    <span class="sample in-window">1</span> the 10 bytes after the leading byte, which the next step works on ·
    <span class="sample ec">0</span> the appended zeros, which end up as the remainder
  </p>

  <h4>The result</h4>
  <p class="step">
    After the last step, the remainder is the error correction bytes: <strong>{ec.join(', ')}</strong>. Put after the
    data, they make a block of {length} bytes that is a multiple of g(x):
  </p>
  <div class="block final" role="group" aria-label="The finished block">
    {#each [...example.data, ...ec] as value, index (index)}
      <span class="byte" class:result={index >= k}>{value}</span>
    {/each}
  </div>
</figure>

<style>
  .encoder {
    container-type: inline-size;
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .field,
  .stepper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .field input {
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

  .note {
    margin: 0.375rem 0 0.75rem;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .stepper input {
    flex: 1;
    min-width: 0;
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

  .stepper button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  output {
    min-width: 5.5ch;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
  }

  h4 {
    margin: 1.25rem 0 0.25rem;
  }

  .step {
    margin: 0.75rem 0 0.5rem;
  }

  /* One step of the division: a label column, then the leading byte and the 10 after it. */
  .window {
    display: grid;
    grid-template-columns: max-content repeat(11, minmax(0, 1fr));
    max-width: 34rem;
    margin: 0.5rem 0 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: clamp(0.6875rem, 3.3cqi, 0.9375rem);
    font-variant-numeric: tabular-nums;
    line-height: 1.8;
    text-align: center;
  }

  .label {
    padding-right: 0.375rem;
    color: var(--muted);
    font-family: system-ui, sans-serif;
    font-size: 0.8em;
    line-height: 2.2;
    text-align: right;
    white-space: nowrap;
  }

  .label .op {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 1.2em;
  }

  .power {
    color: var(--muted);
    font-family: system-ui, sans-serif;
    font-size: 0.8em;
  }

  .generator {
    color: var(--link);
  }

  .incoming {
    color: var(--muted);
  }

  .cleared {
    color: var(--muted);
    opacity: 0.55;
  }

  /* The whole polynomial: one cell per byte, wrapping on narrow screens. */
  .block {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .byte,
  .sample {
    display: inline-block;
    min-width: 2.6em;
    padding: 0.15rem 0;
    border: 1px solid var(--rule);
    border-radius: 3px;
    text-align: center;
  }

  .byte.in-window,
  .sample.in-window {
    border-color: var(--link);
  }

  .byte.ec,
  .sample.ec {
    border-style: dashed;
  }

  .byte.result {
    border-style: solid;
    border-color: var(--link);
    background: color-mix(in srgb, var(--link) 14%, transparent);
    font-weight: 700;
  }

  .key {
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .sample {
    min-width: 1.75em;
    padding: 0 0.2em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .final {
    margin-top: 0.5rem;
  }
</style>
