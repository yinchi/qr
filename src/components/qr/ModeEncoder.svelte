<script lang="ts">
  import {
    ALPHANUMERIC_CHARS,
    byteCharset,
    byteLength,
    encodeGroups,
    MODES,
    unencodable,
    type Group,
    type Mode,
  } from '../../lib/qr/modes';

  const uid = $props.id();

  const NAMES: Record<Mode, string> = { numeric: 'Numeric', alphanumeric: 'Alphanumeric', byte: 'Byte', kanji: 'Kanji' };
  const KANJI_SAMPLES = ['点茗', '漢字', '東京', 'こんにちは', 'カタカナ'];
  const SHOWN = 12;

  let mode: Mode = $state('numeric');
  // The standard's own examples (7.4.3, 7.4.4 and 7.4.6), and some text for byte mode.
  let texts: Record<Mode, string> = $state({
    numeric: '01234567',
    alphanumeric: 'AC-42',
    byte: 'Hello, wörld!',
    kanji: '点茗',
  });

  const text = $derived(texts[mode]);
  const invalid = $derived([...new Set(unencodable(mode, text))]);
  const groups = $derived(invalid.length ? [] : encodeGroups(mode, text));
  const chars = $derived([...text].length);
  const bits = $derived(groups.reduce((n, g) => n + g.width, 0));
  const byteBits = $derived(8 * byteLength(text));

  const hex = (n: number, digits = 2) => n.toString(16).toUpperCase().padStart(digits, '0');
  const binary = (g: Group) => g.value.toString(2).padStart(g.width, '0');
  const alnum = (c: string) => ALPHANUMERIC_CHARS.indexOf(c);
  const show = (c: string) => (c === ' ' ? 'space' : c);

  /** How a group's value is worked out, for the middle column. */
  function working(g: Group): string {
    switch (mode) {
      case 'numeric':
        return String(g.value);
      case 'alphanumeric': {
        const [a, b] = [...g.chars];
        return b === undefined ? `${alnum(a)}` : `${alnum(a)} × 45 + ${alnum(b)} = ${g.value}`;
      }
      case 'byte':
        return g.codes!.map((b) => hex(b)).join(' ');
      case 'kanji': {
        const code = g.codes![0];
        const base = code <= 0x9ffc ? 0x8140 : 0xc140;
        const shifted = code - base;
        return `${hex(code, 4)} − ${hex(base, 4)} = ${hex(shifted, 4)}; ${hex(shifted >> 8)} × C0 + ${hex(shifted & 0xff)} = ${hex(g.value, 3)}`;
      }
    }
  }

  const headers: Record<Mode, [string, string, string]> = {
    numeric: ['Digits', 'Value', 'Bits'],
    alphanumeric: ['Characters', 'Value', 'Bits'],
    byte: ['Character', 'Bytes (hex)', 'Bits'],
    kanji: ['Character', 'Shift JIS → value (hex)', 'Bits'],
  };
</script>

<figure class="mode-encoder">
  <div class="modes" role="radiogroup" aria-label="Mode">
    {#each MODES as m (m)}
      <label class="mode" class:selected={mode === m}>
        <input type="radio" name="mode-{uid}" value={m} bind:group={mode} />
        {NAMES[m]}
      </label>
    {/each}
  </div>

  <div class="input">
    <label for="text-{uid}">Text</label>
    <input
      id="text-{uid}"
      type="text"
      lang={mode === 'kanji' ? 'ja' : undefined}
      spellcheck="false"
      autocomplete="off"
      bind:value={texts[mode]}
    />
  </div>
  {#if mode === 'kanji'}
    <div class="samples">
      <span>Try:</span>
      {#each KANJI_SAMPLES as sample (sample)}
        <button type="button" lang="ja" onclick={() => (texts.kanji = sample)}>{sample}</button>
      {/each}
    </div>
  {/if}

  {#if invalid.length}
    <p class="problem">
      {NAMES[mode]} mode can't encode {invalid.map((c) => `“${show(c)}”`).join(', ')}.
      {#if mode === 'numeric'}It only has the digits 0–9.{/if}
      {#if mode === 'alphanumeric'}It only has 0–9, capital A–Z, space and <code>$ % * + - . / :</code>{/if}
      {#if mode === 'kanji'}It only has the double-byte characters of Shift JIS: kanji, kana and some symbols.{/if}
    </p>
  {:else if chars === 0}
    <p class="problem">Type some text to encode.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{headers[mode][0]}</th>
            <th>{headers[mode][1]}</th>
            <th>{headers[mode][2]}</th>
          </tr>
        </thead>
        <tbody>
          {#each groups.slice(0, SHOWN) as g, i (i)}
            <tr>
              <td class="chars" lang={mode === 'kanji' ? 'ja' : undefined}>{[...g.chars].map(show).join(' ')}</td>
              <td class="working">{working(g)}</td>
              <td class="bits">{binary(g)} <span class="width">({g.width})</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if groups.length > SHOWN}
      <p class="more">…and {groups.length - SHOWN} more groups.</p>
    {/if}
    <p class="summary" aria-live="polite">
      {chars} character{chars === 1 ? '' : 's'} in {bits} bits, {(bits / chars).toFixed(2).replace(/\.?0+$/, '')} bits per
      character.
      {#if mode !== 'byte'}
        Byte mode would need {byteBits} bits.
      {:else if byteCharset(text) === 'latin1'}
        Every character is in ISO/IEC 8859-1, the standard's default, so each takes one byte.
      {:else}
        Some characters aren't in ISO/IEC 8859-1, so the text is stored as UTF-8, one to four bytes per character, which
        needs an extra header (see below).
      {/if}
    </p>
  {/if}
</figure>

<style>
  .mode-encoder {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
  }

  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-bottom: 0.75rem;
  }

  .mode {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
    cursor: pointer;
  }

  .mode input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .mode.selected {
    border-color: var(--link);
    background: color-mix(in srgb, var(--link) 14%, transparent);
    font-weight: 600;
  }

  .mode:has(input:focus-visible) {
    outline: 2px solid var(--link);
    outline-offset: 2px;
  }

  .input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .input input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  .samples {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
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

  .problem {
    margin: 0.75rem 0 0;
    color: var(--muted);
  }

  .table-wrap {
    margin: 0.75rem 0 0;
  }

  .table-wrap :global(th),
  .table-wrap :global(td) {
    padding-inline: 0.6rem;
  }

  .chars {
    white-space: pre;
  }

  .working {
    font-variant-numeric: tabular-nums;
  }

  .bits {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  .width {
    color: var(--muted);
    font-family: system-ui, sans-serif;
    font-size: 0.8125rem;
  }

  .more,
  .summary {
    margin: 0.75rem 0 0;
  }

  .more {
    color: var(--muted);
  }
</style>
