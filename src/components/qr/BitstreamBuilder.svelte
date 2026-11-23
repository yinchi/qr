<script lang="ts">
  import { EC_LEVELS, type EcLevel } from '../../lib/qr/ec';
  import { MAX_VERSION, MIN_VERSION } from '../../lib/qr/layout';
  import {
    buildBitstream,
    detectMode,
    maxCharacters,
    MODES,
    smallestVersionFor,
    unencodable,
    type Mode,
    type Part,
  } from '../../lib/qr/modes';

  const uid = $props.id();

  const NAMES: Record<Mode, string> = { numeric: 'numeric', alphanumeric: 'alphanumeric', byte: 'byte', kanji: 'kanji' };
  const PART_NAMES: Record<Part['kind'], string> = {
    eci: 'ECI header',
    mode: 'Mode indicator',
    count: 'Character count',
    data: 'Data',
    terminator: 'Terminator',
    padding: 'Padding to the end of the byte',
    pad: 'Pad bytes',
  };
  /** Codewords drawn before the rest are summarised, so very large codes stay quick to draw. */
  const SHOWN = 40;

  // The standard's own example (Annex I.2): 01234567 at level M.
  let text = $state('01234567');
  let level: EcLevel = $state('M');
  let modeChoice: 'auto' | Mode = $state('auto');
  let autoVersion = $state(true);
  let chosenVersion = $state(1);
  /** The part being pointed at. */
  let active: number | null = $state(null);

  const mode = $derived(modeChoice === 'auto' ? detectMode(text) : modeChoice);
  const invalid = $derived([...new Set(unencodable(mode, text))]);
  const smallest = $derived(invalid.length ? null : smallestVersionFor(mode, text, level));
  const version = $derived(autoVersion ? smallest : chosenVersion);
  const stream = $derived(version && !invalid.length ? buildBitstream(mode, text, version, level) : null);

  /** Every bit, with the index of the part it belongs to, and which data group it is in (for alternating shades). */
  const cells = $derived.by(() => {
    if (!stream?.fits) return [];
    let group = 0;
    return stream.parts.flatMap((part, index) => {
      if (part.kind === 'data') group++;
      return Array.from({ length: part.width }, (_, k) => ({
        bit: Math.floor(part.value / 2 ** (part.width - 1 - k)) % 2,
        part: index,
        kind: part.kind,
        odd: part.kind === 'data' && group % 2 === 0,
      }));
    });
  });
  const codewords = $derived(
    Array.from({ length: Math.min(cells.length / 8, SHOWN) }, (_, i) => ({
      cells: cells.slice(8 * i, 8 * i + 8),
      value: stream!.codewords[i],
    })),
  );

  const bin = (value: number, width: number) => value.toString(2).padStart(width, '0');
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;

  /** A table row per kind of part, with data groups and pad bytes summarised. */
  const rows = $derived.by(() => {
    if (!stream?.fits) return [];
    const { parts } = stream;
    const out: { kind: Part['kind']; bits: string; meaning: string }[] = [];
    for (const kind of ['eci', 'mode', 'count', 'data', 'terminator', 'padding', 'pad'] as const) {
      const of = parts.filter((p) => p.kind === kind);
      if (!of.length) continue;
      const bits = of
        .slice(0, 3)
        .map((p) => bin(p.value, p.width))
        .join(' ');
      const more = of.length > 3 ? ' …' : '';
      const width = of.reduce((n, p) => n + p.width, 0);
      const meaning = {
        eci: 'ECI 26: the bytes that follow are UTF-8',
        mode: `${NAMES[mode][0].toUpperCase()}${NAMES[mode].slice(1)} mode`,
        count: `${plural(of[0].value, mode === 'byte' ? 'byte' : 'character')}, in ${of[0].width} bits for versions ${version! <= 9 ? '1–9' : version! <= 26 ? '10–26' : '27–40'}`,
        data: `${plural(of.length, 'group')}, ${plural(width, 'bit')}`,
        terminator: of[0].width === 4 ? 'End of the data' : `End of the data, cut to ${plural(of[0].width, 'bit')} for lack of room`,
        padding: plural(width, 'bit'),
        pad: `${plural(of.length, 'byte')}, alternating, to fill the code`,
      }[kind];
      out.push({ kind, bits: bits + more, meaning });
    }
    return out;
  });

  const activePart = $derived(active === null || !stream ? null : stream.parts[active]);
  const readout = $derived.by(() => {
    if (!activePart || active === null) return 'Point at a bit to pick out the part it belongs to.';
    const start = stream!.parts.slice(0, active).reduce((n, p) => n + p.width, 0);
    const where = activePart.width === 1 ? `Bit ${start}` : `Bits ${start}–${start + activePart.width - 1}`;
    const what = activePart.kind === 'data' ? `data for “${activePart.chars}”` : PART_NAMES[activePart.kind].toLowerCase();
    return `${where}: ${what}, ${bin(activePart.value, activePart.width)}.`;
  });

  function point(event: PointerEvent) {
    const target = (event.target as Element).closest<HTMLElement>('[data-part]');
    active = target ? Number(target.dataset.part) : null;
  }
</script>

<figure class="bitstream">
  <div class="controls">
    <div class="field text">
      <label for="text-{uid}">Text</label>
      <input id="text-{uid}" type="text" spellcheck="false" autocomplete="off" bind:value={text} />
    </div>
    <div class="field" role="radiogroup" aria-labelledby="level-label-{uid}">
      <span id="level-label-{uid}">Level</span>
      {#each EC_LEVELS as l (l)}
        <label class="choice"><input type="radio" name="level-{uid}" value={l} bind:group={level} /> {l}</label>
      {/each}
    </div>
    <div class="field">
      <label for="mode-{uid}">Mode</label>
      <select id="mode-{uid}" bind:value={modeChoice}>
        <option value="auto">Automatic ({NAMES[detectMode(text)]})</option>
        {#each MODES as m (m)}
          <option value={m}>{NAMES[m]}</option>
        {/each}
      </select>
    </div>
    <div class="field version">
      <label class="choice"><input type="checkbox" bind:checked={autoVersion} /> Smallest version that fits</label>
      {#if !autoVersion}
        <label for="version-{uid}" class="visually-hidden">Version</label>
        <input id="version-{uid}" type="range" min={MIN_VERSION} max={MAX_VERSION} bind:value={chosenVersion} />
        <output for="version-{uid}">{chosenVersion}</output>
      {/if}
    </div>
  </div>

  {#if invalid.length}
    <p class="problem">
      The text has characters that {NAMES[mode]} mode can't encode: {invalid.map((c) => `“${c}”`).join(', ')}.
    </p>
  {:else if !version}
    <p class="problem">This text is too long for any version at level {level} in {NAMES[mode]} mode.</p>
  {:else if stream && !stream.fits}
    <p class="problem">
      Version {version}-{level} has room for {plural(stream.capacityBits, 'bit')}, but this text needs {plural(
        stream.segmentBits,
        'bit',
      )}. Try a larger version{smallest ? `: the smallest that fits is ${smallest}` : ''}.
    </p>
  {:else if stream}
    <p class="summary">
      Version {version}-{level} has {plural(stream.capacityBits / 8, 'data byte')}, or {plural(stream.capacityBits, 'bit')}.
      The text takes {plural(stream.segmentBits, 'bit')} in {NAMES[mode]} mode; the rest is filled as below.
    </p>

    <ul class="legend" aria-label="Parts">
      {#each rows as row (row.kind)}
        <li><span class="swatch" style:--c="var(--part-{row.kind})"></span>{PART_NAMES[row.kind]}</li>
      {/each}
    </ul>

    <div class="codewords" role="group" aria-label="Data codewords, bit by bit" onpointerover={point} onpointerleave={() => (active = null)}>
      {#each codewords as cw, i (i)}
        <div class="codeword">
          <div class="cells">
            {#each cw.cells as cell, k (k)}
              <span
                class="cell"
                class:odd={cell.odd}
                class:on={cell.part === active}
                style:--c="var(--part-{cell.kind})"
                data-part={cell.part}>{cell.bit}</span
              >
            {/each}
          </div>
          <span class="hex">{hex(cw.value)}</span>
        </div>
      {/each}
    </div>
    {#if cells.length / 8 > SHOWN}
      <p class="more">…and {plural(cells.length / 8 - SHOWN, 'more byte')}.</p>
    {/if}
    <p class="readout">{readout}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Part</th>
            <th>Bits</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.kind)}
            <tr>
              <td><span class="swatch" style:--c="var(--part-{row.kind})"></span>{PART_NAMES[row.kind]}</td>
              <td class="mono">{row.bits}</td>
              <td>{row.meaning}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="capacity">
      Version {version}-{level} holds up to {plural(maxCharacters('numeric', version, level), 'digit')},
      {plural(maxCharacters('alphanumeric', version, level), 'alphanumeric character')},
      {plural(maxCharacters('byte', version, level), 'byte')} or {maxCharacters('kanji', version, level).toLocaleString('en')}
      kanji, in a single mode.
    </p>
  {/if}
</figure>

<style>
  /* Parts in the order they appear, from the dataviz reference palette; neighbouring parts were checked to be distinguishable. */
  .bitstream {
    --part-eci: light-dark(#e34948, #e66767);
    --part-mode: light-dark(#2a78d6, #3987e5);
    --part-count: light-dark(#eb6834, #d95926);
    --part-data: light-dark(#1baf7a, #199e70);
    --part-terminator: light-dark(#eda100, #c98500);
    --part-padding: light-dark(#e87ba4, #d55181);
    --part-pad: light-dark(#008300, #0ca30c);
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
    margin-bottom: 0.75rem;
  }

  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.6rem;
  }

  .field.text {
    flex: 1 1 100%;
  }

  .field.text input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }

  .version input[type='range'] {
    width: 9rem;
  }

  .choice {
    white-space: nowrap;
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

  .problem,
  .summary,
  .capacity,
  .more {
    margin: 0.75rem 0 0;
  }

  .problem,
  .more {
    color: var(--muted);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0.75rem 0;
    padding: 0;
    list-style: none;
    font-size: 0.875rem;
  }

  .swatch {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    margin-right: 0.35em;
    border-bottom: 3px solid var(--c);
    background: color-mix(in srgb, var(--c) 30%, transparent);
    vertical-align: -0.05em;
  }

  /* The data codewords, eight bits each, coloured by the part each bit belongs to. */
  .codewords {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
  }

  .codeword {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .cells {
    display: flex;
  }

  .cell {
    width: 1.05rem;
    border-bottom: 3px solid var(--c);
    background: color-mix(in srgb, var(--c) 22%, transparent);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9rem;
    line-height: 1.6;
    text-align: center;
    cursor: default;
  }

  .cell.odd {
    background: color-mix(in srgb, var(--c) 42%, transparent);
  }

  .cell.on {
    outline: 2px solid var(--text);
    outline-offset: -2px;
    font-weight: 700;
  }

  .hex {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8125rem;
  }

  .readout {
    min-height: 1.5em;
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .table-wrap {
    margin: 0.75rem 0 0;
  }

  .table-wrap :global(th),
  .table-wrap :global(td) {
    padding-inline: 0.6rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
</style>
