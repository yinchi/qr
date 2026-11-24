<script lang="ts">
  import { EC_LEVELS, ecInfo, type EcLevel } from '../../lib/qr/ec';
  import { fixedLayout, formatInfoPositions, QUIET_ZONE, symbolSize, versionInfoPositions } from '../../lib/qr/layout';
  import {
    ALPHANUMERIC_CHARS,
    buildBitstream,
    detectMode,
    kanjiCharacters,
    maxCharacters,
    type Mode,
  } from '../../lib/qr/modes';
  import { readSymbol, type FormatCopy, type VersionCopy } from '../../lib/qr/read';
  import { deinterleave, encodeBlocks, interleave } from '../../lib/qr/rs';
  import { applyMask, chooseMask, dataPath, encodeText, placeCodewords, type EncodedText } from '../../lib/qr/symbol';

  const uid = $props.id();

  const MODE_NAMES: Record<Mode, string> = {
    numeric: 'Numeric',
    alphanumeric: 'Alphanumeric',
    byte: 'Byte',
    kanji: 'Kanji',
  };
  const DARK = '#1c1b19';
  const DEFAULT_TEXT = 'QR codes can still be read when part of them is damaged.';
  const RANDOM_FLIPS = 5;

  const initial = encodeText(DEFAULT_TEXT, 'M')!;
  let text = $state(DEFAULT_TEXT);
  let level = $state<EcLevel>('M');
  let encoded = $state<EncodedText>(initial);
  let fits = $state(true);
  /** 1 for each module that has been flipped, row by row. */
  let flips = $state.raw(new Uint8Array(symbolSize(initial.version) ** 2));
  let markModules = $state(true);
  let markBytes = $state(true);
  let svg: SVGSVGElement | undefined = $state();

  function update(nextText: string, nextLevel: EcLevel) {
    text = nextText;
    level = nextLevel;
    const next = encodeText(nextText, nextLevel);
    fits = next !== null;
    if (next) {
      encoded = next;
      flips = new Uint8Array(symbolSize(next.version) ** 2);
    }
  }

  // The code as made.
  const version = $derived(encoded.version);
  const size = $derived(symbolSize(version));
  const layout = $derived(fixedLayout(version));
  const path = $derived(dataPath(layout));
  const info = $derived(ecInfo(version, encoded.level));
  const unmasked = $derived(placeCodewords(version, encoded.codewords));
  const mask = $derived(chooseMask(unmasked, encoded.level).mask);
  const original = $derived(applyMask(unmasked, encoded.level, mask));

  // The code as damaged, and what a scanner makes of it.
  const dark = $derived(original.dark.map((d, m) => (flips[m] ? !d : d)));
  const reading = $derived(readSymbol(dark, size));

  /** Only the parts a scanner decodes can be damaged: the fixed patterns are for finding the grid. */
  const editable = $derived(layout.roles.map((role) => role === 'data' || role === 'format' || role === 'version'));
  const editableModules = $derived(editable.flatMap((e, m) => (e ? [m] : [])));

  /** Each module's byte, as its place in the codeword sequence, or -1 for modules outside the bytes. */
  const owner = $derived.by(() => {
    const own = new Int32Array(size * size).fill(-1);
    const bits = 8 * encoded.codewords.length;
    path.forEach(([row, col], k) => k < bits && (own[row * size + col] = k >> 3));
    return own;
  });

  const damage = $derived.by(() => {
    const count = { data: 0, format: 0, version: 0 };
    const bytes = new Set<number>();
    flips.forEach((flipped, m) => {
      if (!flipped) return;
      const role = layout.roles[m];
      if (role === 'data' || role === 'format' || role === 'version') count[role]++;
      if (owner[m] >= 0) bytes.add(owner[m]);
    });
    return { ...count, total: count.data + count.format + count.version, bytes };
  });

  // Painting: a mouse or pen drags across modules, setting them all to the opposite of the first; a tap flips one,
  // and a touch that moves is left to scroll the page.
  let stroke: { target: boolean; x: number; y: number } | null = null;
  let tap: { id: number; module: number; x: number; y: number } | null = null;

  function toGrid(event: PointerEvent) {
    const matrix = svg?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  }

  function moduleAt(x: number, y: number) {
    const row = Math.floor(y);
    const col = Math.floor(x);
    return row >= 0 && col >= 0 && row < size && col < size ? row * size + col : -1;
  }

  function setModules(modules: Iterable<number>, target: boolean) {
    let next: typeof flips | null = null;
    for (const m of modules) {
      if (!editable[m]) continue;
      const want = original.dark[m] === target ? 0 : 1;
      if (flips[m] === want) continue;
      next ??= flips.slice();
      next[m] = want;
    }
    if (next) flips = next;
  }

  function onPointerDown(event: PointerEvent) {
    const point = toGrid(event);
    const m = point ? moduleAt(point.x, point.y) : -1;
    if (!point || m < 0) return;
    if (event.pointerType === 'touch') {
      tap = { id: event.pointerId, module: m, x: event.clientX, y: event.clientY };
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    svg?.setPointerCapture(event.pointerId);
    stroke = { target: !dark[m], x: point.x, y: point.y };
    setModules([m], stroke.target);
  }

  function onPointerMove(event: PointerEvent) {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) tap = null;
    if (!stroke) return;
    const point = toGrid(event);
    if (!point) return;
    // Every module along the way, so a quick stroke leaves no gaps.
    const steps = Math.ceil(4 * Math.hypot(point.x - stroke.x, point.y - stroke.y));
    const modules = new Set<number>();
    for (let s = 1; s <= steps; s++) {
      const m = moduleAt(stroke.x + ((point.x - stroke.x) * s) / steps, stroke.y + ((point.y - stroke.y) * s) / steps);
      if (m >= 0) modules.add(m);
    }
    stroke = { ...stroke, x: point.x, y: point.y };
    setModules(modules, stroke.target);
  }

  function onPointerUp(event: PointerEvent) {
    if (tap?.id === event.pointerId) setModules([tap.module], !dark[tap.module]);
    tap = null;
    stroke = null;
  }

  function onPointerCancel() {
    tap = null;
    stroke = null;
  }

  function scatter() {
    const next = flips.slice();
    const picked = new Set<number>();
    while (picked.size < Math.min(RANDOM_FLIPS, editableModules.length)) {
      picked.add(editableModules[Math.floor(Math.random() * editableModules.length)]);
    }
    for (const m of picked) next[m] ^= 1;
    flips = next;
  }

  /** A dark disc, centred on a module that can be damaged, wider in bigger codes. */
  function blot() {
    const centre = editableModules[Math.floor(Math.random() * editableModules.length)];
    const row = Math.floor(centre / size);
    const col = centre % size;
    const radius = Math.max(1.6, size / 11);
    const modules: number[] = [];
    for (let r = Math.floor(row - radius); r <= row + radius; r++) {
      for (let c = Math.floor(col - radius); c <= col + radius; c++) {
        if (Math.hypot(r - row, c - col) <= radius && moduleAt(c, r) >= 0) modules.push(r * size + c);
      }
    }
    setModules(modules, true);
  }

  /** The text with one character changed to another the same mode can encode, so it encodes to the same length. */
  function alteredText(t: string, mode: Mode): string | null {
    const chars = [...t];
    const next = (c: string, set: string) => set[(set.indexOf(c) + 1) % set.length];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      let changed: string | null = null;
      if (/[0-9]/.test(c)) changed = next(c, '0123456789');
      else if (mode === 'alphanumeric') changed = /[A-Z]/.test(c) ? next(c, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') : next(c, ALPHANUMERIC_CHARS);
      else if (mode === 'byte' && /[a-z]/i.test(c)) changed = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
      else if (mode === 'kanji') {
        const all = [...kanjiCharacters().keys()];
        changed = all[(all.indexOf(c) + 1) % all.length];
      }
      if (changed) {
        chars[i] = changed;
        return chars.join('');
      }
    }
    return null;
  }

  const altered = $derived(alteredText(encoded.text, encoded.mode));

  /**
   * Damage that makes the decoder correct a block to a different valid block: the blocks for the text with one
   * character changed, with all but r of the bytes that differ taken from them. Each such block is then within r
   * bytes of the wrong block, and more than r from the right one.
   */
  function misread() {
    if (!altered) return;
    const stream = buildBitstream(encoded.mode, altered, version, encoded.level);
    if (!stream.fits) return;
    const wrong = encodeBlocks(stream.codewords, version, encoded.level);
    const r = info.blocks[0].correctable;
    const received = encoded.blocks.map((block, b) => {
      const sent = [...block.data, ...block.ec];
      const other = [...wrong[b].data, ...wrong[b].ec];
      const differ = sent.flatMap((value, i) => (value !== other[i] ? [i] : []));
      const keep = new Set(differ.slice(0, r));
      const bytes = sent.map((value, i) => (keep.has(i) ? value : other[i]));
      return { data: bytes.slice(0, block.data.length), ec: bytes.slice(block.data.length) };
    });
    const sequence = interleave(received);
    const next = new Uint8Array(size * size);
    path.slice(0, 8 * sequence.length).forEach(([row, col], k) => {
      next[row * size + col] = ((sequence[k >> 3] ^ encoded.codewords[k >> 3]) >> (7 - (k & 7))) & 1;
    });
    flips = next;
  }

  function repair() {
    flips = new Uint8Array(size * size);
  }

  // What the reading means, checked against what was made.
  const readFormat = $derived(reading.formatUsed === null ? null : reading.formatCopies[reading.formatUsed]);
  const formatRight = $derived(readFormat?.level === encoded.level && readFormat.mask === mask);
  const readInfo = $derived(readFormat && ecInfo(version, readFormat.level));

  /** For each block read: its size, how many of its bytes are damaged, and whether it came back right. */
  const blockResults = $derived.by(() => {
    if (!reading.blocks || !readFormat) return null;
    const sent = deinterleave(encoded.codewords, version, readFormat.level);
    return reading.blocks.map((block, b) => {
      const right = [...sent[b].data, ...sent[b].ec];
      const received = [...block.received.data, ...block.received.ec];
      const corrected = block.decoding.corrected;
      return {
        data: block.received.data.length,
        ec: block.received.ec.length,
        damaged: received.filter((value, i) => value !== right[i]).length,
        corrections: block.decoding.corrections.length,
        outcome: !corrected ? 'failed' : corrected.some((value, i) => value !== right[i]) ? 'wrong' : 'right',
      } as const;
    });
  });

  /** Which block each byte of the sequence went to, as the scanner sorted them. */
  const blockOf = $derived.by(() => {
    if (!readFormat || !reading.blocks) return null;
    const which = new Int32Array(encoded.codewords.length);
    const indexes = Array.from({ length: encoded.codewords.length }, (_, k) => k);
    deinterleave(indexes, version, readFormat.level).forEach((block, b) => {
      for (const k of [...block.data, ...block.ec]) which[k] = b;
    });
    return which;
  });

  const bytesWrong = $derived(
    reading.codewords ? reading.codewords.filter((value, k) => value !== encoded.codewords[k]).length : 0,
  );
  const textRight = $derived(reading.bitstream?.error === null && reading.bitstream.text === encoded.text);

  type Status = 'right' | 'wrong' | 'skipped';
  const formatStatus: Status = $derived(formatRight ? 'right' : 'wrong');
  const versionStatus: Status = $derived(reading.version === version ? 'right' : 'wrong');
  const maskRight = $derived(readFormat?.mask === mask);
  const bytesStatus: Status = $derived(!reading.codewords ? 'skipped' : maskRight ? 'right' : 'wrong');
  const blocksStatus: Status = $derived(
    !blockResults ? 'skipped' : blockResults.every((b) => b.outcome === 'right') ? 'right' : 'wrong',
  );
  const textStatus: Status = $derived(!reading.bitstream ? 'skipped' : textRight ? 'right' : 'wrong');

  const plural = (n: number, word: string, words = `${word}s`) => `${n.toLocaleString('en')} ${n === 1 ? word : words}`;
  const reference = (m: number) => m.toString(2).padStart(3, '0');
  const list = (items: string[]) =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

  const damageText = $derived.by(() => {
    if (damage.total === 0) return 'No damage yet.';
    const parts = [
      damage.data && `${damage.data.toLocaleString('en')} in the data area`,
      damage.format && `${damage.format} in the format information`,
      damage.version && `${damage.version} in the version information`,
    ].filter((part): part is string => Boolean(part));
    const where = parts.length === 1 ? parts[0].replace(/^[\d,]+ /, ' ') : `: ${list(parts)}`;
    const bytes = damage.bytes.size ? `, damaging ${plural(damage.bytes.size, 'byte')}` : '';
    return `${plural(damage.total, 'module')} changed${where}${bytes}.`;
  });

  const verdict = $derived.by(() => {
    switch (reading.failure) {
      case 'format':
        return { tone: 'fail', text: "Can't be read: neither copy of the format information can be corrected." };
      case 'version':
        return reading.version === null
          ? { tone: 'fail', text: "Can't be read: neither copy of the version information can be corrected." }
          : { tone: 'fail', text: "Can't be read: the version information gives the wrong version." };
      case 'blocks': {
        if (!formatRight) {
          return { tone: 'fail', text: "Can't be read: the format information was misread, so the bytes come out wrong." };
        }
        const blocks = blockResults?.length ?? 0;
        const failed = blockResults?.filter((b) => b.outcome === 'failed').length ?? 0;
        const which = blocks === 1 ? 'the block has' : `${failed} of the ${blocks} blocks ${failed === 1 ? 'has' : 'have'}`;
        return { tone: 'fail', text: `Can't be read: ${which} more damage than error correction can repair.` };
      }
      case 'bitstream':
        return { tone: 'fail', text: "Can't be read: the corrected bytes don't make sense." };
    }
    if (!textRight) return { tone: 'fail', text: "Read wrongly: the scanner gets different text, and can't tell." };
    const corrected = blockResults?.reduce((n, b) => n + b.corrections, 0) ?? 0;
    return {
      tone: 'ok',
      text: corrected
        ? `Read correctly, after correcting ${plural(corrected, 'damaged byte')}.`
        : damage.total
          ? 'Read correctly: no damaged bytes to correct.'
          : 'Read correctly. Damage the code to see how much it can take.',
    };
  });

  /** One copy of the format or version information, as the scanner sees it. */
  function describeCopy(copy: FormatCopy | VersionCopy) {
    const value = 'version' in copy ? `version ${copy.version}` : `level ${copy.level}, mask ${reference(copy.mask)}`;
    return copy.distance === 0
      ? `matches ${value} exactly`
      : `is ${plural(copy.distance, 'bit')} from ${value}, the nearest valid string`;
  }

  const FORMAT_COPIES = ['around the top-left finder pattern', 'split between the other two finder patterns'];
  const VERSION_COPIES = ['beside the top-right finder pattern', 'beside the bottom-left finder pattern'];

  const formatDamage = $derived.by(() => {
    const { first, second } = formatInfoPositions(version);
    return [first, second].map((ps) => ps.filter(([row, col]) => flips[row * size + col]).length);
  });
  const versionDamage = $derived.by(() => {
    const { topRight, bottomLeft } = versionInfoPositions(version);
    return [topRight, bottomLeft].map((ps) => ps.filter(([row, col]) => flips[row * size + col]).length);
  });

  // Drawing.
  const darkPath = $derived.by(() => {
    let d = '';
    for (let row = 0; row < size; row++) {
      let col = 0;
      while (col < size) {
        if (!dark[row * size + col]) {
          col++;
          continue;
        }
        let end = col + 1;
        while (end < size && dark[row * size + end]) end++;
        d += `M${col} ${row}h${end - col}v1h${col - end}z`;
        col = end;
      }
    }
    return d;
  });

  const changed = $derived(editableModules.filter((m) => flips[m]));

  /** Outlines of the damaged bytes: those in blocks that came back right, and the rest. */
  const byteOutlines = $derived.by(() => {
    const d = { fixed: '', lost: '' };
    const at = (row: number, col: number) =>
      row < 0 || col < 0 || row >= size || col >= size ? -1 : owner[row * size + col];
    for (const k of damage.bytes) {
      const block = blockOf?.[k];
      const kind = block !== undefined && blockResults?.[block]?.outcome === 'right' ? 'fixed' : 'lost';
      for (const [row, col] of path.slice(8 * k, 8 * k + 8)) {
        if (at(row - 1, col) !== k) d[kind] += `M${col} ${row}h1`;
        if (at(row + 1, col) !== k) d[kind] += `M${col} ${row + 1}h1`;
        if (at(row, col - 1) !== k) d[kind] += `M${col} ${row}v1`;
        if (at(row, col + 1) !== k) d[kind] += `M${col + 1} ${row}v1`;
      }
    }
    return d;
  });

  const capacity = $derived.by(() => {
    const mode = detectMode(text);
    return { mode, max: maxCharacters(mode, 40, level) };
  });

  const remainderBits = $derived(path.length - 8 * encoded.codewords.length);
</script>

<figure class="demo">
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
  <div class="layout">
    <div class="make">
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
          {MODE_NAMES[encoded.mode]} mode, version {version}-{encoded.level}, mask {reference(mask)}: {size} × {size} modules.
        {:else}
          Too long: version 40-{level} holds at most {capacity.max.toLocaleString('en')} characters in {capacity.mode} mode.
          Still showing the last text that fitted.
        {/if}
      </p>

      <div class="body">
        <svg
          bind:this={svg}
          viewBox="{-QUIET_ZONE} {-QUIET_ZONE} {size + 2 * QUIET_ZONE} {size + 2 * QUIET_ZONE}"
          role="img"
          aria-label="The QR code, with {plural(damage.total, 'module')} changed"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerCancel}
        >
          <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={size + 2 * QUIET_ZONE} height={size + 2 * QUIET_ZONE} fill="#ffffff" />
          <path d={darkPath} fill={DARK} shape-rendering="crispEdges" />
          {#if markBytes}
            <path class="byte fixed" d={byteOutlines.fixed} />
            <path class="byte lost" d={byteOutlines.lost} />
          {/if}
          {#if markModules}
            {#each changed as m (m)}
              <circle class="dot" cx={(m % size) + 0.5} cy={Math.floor(m / size) + 0.5} r="0.22" />
            {/each}
          {/if}
        </svg>

        <div class="tools">
          <p class="hint">
            Click or tap modules to flip them, or drag across the code with a mouse. Only the parts a scanner decodes can be
            damaged: the data area and the format and version information.
          </p>
          <div class="buttons">
            <button type="button" onclick={scatter}>Flip {RANDOM_FLIPS} at random</button>
            <button type="button" onclick={blot}>Add a blot</button>
            <button type="button" onclick={misread} disabled={!altered}>Cause a misread</button>
            <button type="button" onclick={repair} disabled={damage.total === 0}>Repair</button>
          </div>
          <p class="damage">{damageText}</p>
          <div class="marks">
            <label
              ><input type="checkbox" bind:checked={markModules} />
              <svg class="swatch" viewBox="0 0 16 16" aria-hidden="true"><circle class="dot" cx="8" cy="8" r="3.5" /></svg>
              Mark changed modules</label
            >
            <label><input type="checkbox" bind:checked={markBytes} /> Outline damaged bytes</label>
            <p class="key">
              <span
                ><svg class="swatch" viewBox="0 0 16 16" aria-hidden="true"
                  ><rect class="byte fixed" x="2" y="2" width="12" height="12" /></svg
                >corrected</span
              >
              <span
                ><svg class="swatch" viewBox="0 0 16 16" aria-hidden="true"
                  ><rect class="byte lost" x="2" y="2" width="12" height="12" /></svg
                >not corrected</span
              >
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="read">
      <h3 class="steps-title">How a scanner reads it</h3>
      <p class="outcome {verdict.tone}" aria-live="polite">
        <span class="icon" aria-hidden="true">{verdict.tone === 'ok' ? '✓' : '✗'}</span>{verdict.text}
      </p>
      <ol class="steps">
        <li class={formatStatus}>
          <p class="step-head">
            <span class="status" role="img" aria-label={formatStatus === 'right' ? 'Right' : 'Failed'}
              >{formatStatus === 'right' ? '✓' : '✗'}</span
            >
            <strong>Format information</strong> <a href="../format/#two-copies">Chapter 2</a>
          </p>
          <p>
            {#if reading.formatUsed === 0}
              The copy {FORMAT_COPIES[0]}
              {describeCopy(reading.formatCopies[0])}.
            {:else if reading.formatUsed === 1}
              The copy {FORMAT_COPIES[0]} is {plural(reading.formatCopies[0].distance, 'bit')} from the nearest valid string,
              too far to correct, so the scanner reads the other copy. It {describeCopy(reading.formatCopies[1])}.
            {:else}
              Both copies are more than 3 bits from every valid string, so the scanner can't tell the error correction level
              or the mask, and gives up.
            {/if}
            {#if readFormat && !formatRight}
              <strong>Wrong:</strong> the code was made with level {encoded.level}, mask {reference(mask)}. With
              {plural(formatDamage[reading.formatUsed ?? 0], 'bit')} damaged, the copy came out closer to another valid string.
            {/if}
          </p>
        </li>

        <li class={versionStatus}>
          <p class="step-head">
            <span class="status" role="img" aria-label={versionStatus === 'right' ? 'Right' : 'Failed'}
              >{versionStatus === 'right' ? '✓' : '✗'}</span
            >
            <strong>Version</strong>
            {#if version >= 7}<a href="../format/#version-information">Chapter 2</a>{:else}<a href="../parts/"
                >Chapter 1</a
              >{/if}
          </p>
          <p>
            {#if version < 7}
              {size} × {size} modules: version {version}. Up to version 6, the size is enough.
            {:else}
              A scanner can only estimate the size, so from version 7 it reads the version information.
              {#if reading.versionUsed === 0}
                The block {VERSION_COPIES[0]}
                {describeCopy(reading.versionCopies[0])}.
              {:else if reading.versionUsed === 1}
                The block {VERSION_COPIES[0]} is {plural(reading.versionCopies[0].distance, 'bit')} from the nearest valid
                string, too far to correct, so the scanner reads the other block. It {describeCopy(reading.versionCopies[1])}.
              {:else}
                Both blocks are more than 3 bits from every valid string, so the scanner can't tell the version, and gives up.
              {/if}
              {#if reading.version !== null && reading.version !== version}
                <strong>Wrong:</strong> the code is version {version}, and with
                {plural(versionDamage[reading.versionUsed ?? 0], 'bit')} damaged, the block came out closer to another valid
                string. The scanner would read the modules on the wrong grid, so it can't go on.
              {/if}
            {/if}
          </p>
        </li>

        <li class={bytesStatus}>
          <p class="step-head">
            <span class="status" role="img" aria-label={{ right: 'Right', wrong: 'Failed', skipped: 'Not reached' }[bytesStatus]}
              >{{ right: '✓', wrong: '✗', skipped: '–' }[bytesStatus]}</span
            >
            <strong>Bytes</strong> <a href="../placement/">Chapter 6</a>
          </p>
          <p>
            {#if reading.codewords && readFormat}
              Undo mask {reference(readFormat.mask)} and read the {reading.codewords.length.toLocaleString('en')} bytes along
              the zigzag{#if remainderBits}, leaving out the {remainderBits} remainder bits{/if}.
              {#if bytesWrong === 0}
                None of them are damaged.
              {:else}
                {bytesWrong.toLocaleString('en')} of them {bytesWrong === 1 ? 'differs' : 'differ'} from the bytes that were
                placed{#if !maskRight}, since the scanner is using the wrong mask{/if}.
              {/if}
            {:else}
              Not reached.
            {/if}
          </p>
        </li>

        <li class={blocksStatus}>
          <p class="step-head">
            <span class="status" role="img" aria-label={{ right: 'Right', wrong: 'Failed', skipped: 'Not reached' }[blocksStatus]}
              >{{ right: '✓', wrong: '✗', skipped: '–' }[blocksStatus]}</span
            >
            <strong>Error correction</strong> <a href="../reed-solomon/#decoding">Chapter 5</a>
          </p>
          {#if blockResults && readInfo}
            <p>
              {#if blockResults.length === 1}
                The bytes form a single block
              {:else}
                Sort the bytes back into their {blockResults.length}
                <a href="../reed-solomon/#splitting-into-blocks-and-interleaving">blocks</a>
              {/if}, with {readInfo.ecPerBlock} error correction bytes each. A block can correct up to
              {plural(readInfo.blocks[0].correctable, 'damaged byte')}{#if readInfo.misdecodeProtection}; the other
                {readInfo.ecPerBlock - 2 * readInfo.blocks[0].correctable} error correction bytes only check the result{/if}.
              {#if readFormat && readFormat.level !== encoded.level}
                <strong>Wrong:</strong> the code is level {encoded.level}, so these aren't its blocks.
              {/if}
            </p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Block</th>
                    <th scope="col" class="num">Bytes</th>
                    <th scope="col" class="num">Damaged</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {#each blockResults as b, i (i)}
                    <tr class={b.outcome}>
                      <th scope="row">{i + 1}</th>
                      <td class="num">{b.data} + {b.ec}</td>
                      <td class="num">{b.damaged}</td>
                      <td class="result">
                        {#if b.outcome === 'failed'}
                          <span class="icon" aria-hidden="true">✗</span> Too much damage
                        {:else if b.outcome === 'wrong'}
                          <span class="icon" aria-hidden="true">✗</span> Corrected to the wrong block
                        {:else if b.corrections === 0}
                          <span class="icon" aria-hidden="true">✓</span> No errors
                        {:else}
                          <span class="icon" aria-hidden="true">✓</span> {plural(b.corrections, 'byte')} corrected
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="table-note">
              Bytes are data + error correction. “Damaged” counts the bytes that differ from those sent; the scanner can't see
              this, only the result.
            </p>
          {:else}
            <p>Not reached.</p>
          {/if}
        </li>

        <li class={textStatus}>
          <p class="step-head">
            <span class="status" role="img" aria-label={{ right: 'Right', wrong: 'Failed', skipped: 'Not reached' }[textStatus]}
              >{{ right: '✓', wrong: '✗', skipped: '–' }[textStatus]}</span
            >
            <strong>Text</strong> <a href="../encoding/">Chapter 3</a>
          </p>
          {#if reading.bitstream?.error}
            <p>The bits don't make sense: {reading.bitstream.error}. The scanner gives up.</p>
          {:else if reading.bitstream}
            {@const segment = reading.bitstream.segments[0]}
            <p>
              {#if !segment}
                No segments: the text is empty.
              {:else if reading.bitstream.segments.length > 1}
                {reading.bitstream.segments.length} segments, in {list(reading.bitstream.segments.map((s) => s.mode))} mode:
              {:else}
                {MODE_NAMES[segment.mode]} mode{#if segment.eci !== null}, with ECI {segment.eci}{/if},
                {plural(segment.count, segment.mode === 'byte' ? 'byte' : 'character')}:
              {/if}
            </p>
            {#if segment}<p class="decoded">{reading.bitstream.text}</p>{/if}
            <p>
              {#if textRight}
                The same text that was encoded.
              {:else}
                <strong>Wrong:</strong> not the text that was encoded.
              {/if}
            </p>
          {:else}
            <p>Not reached.</p>
          {/if}
        </li>
      </ol>
    </div>
  </div>
</figure>

<style>
  .demo {
    /* Status colours from the dataviz reference palette; each outcome also has an icon and a label. */
    --good: #0ca30c;
    --critical: #d03b3b;
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    border-radius: 8px;
    container: demo / inline-size;
  }

  /* Laid out by the widget's own width: one column on phones, the code beside its tools on wider screens, and, when
     the page gives it the room, the code and tools beside the steps, so they change as you draw. The text box is
     always across the top. */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    margin-top: 0.5rem;
  }

  @container demo (min-width: 52rem) {
    .layout {
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
      gap: 2rem;
      align-items: start;
    }

    .read .steps-title {
      margin-top: 0;
    }
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

  @container demo (36rem <= width < 52rem) {
    .body {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      align-items: start;
    }
  }

  .body > svg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 4px;
    cursor: crosshair;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .dot {
    fill: #e34948;
  }

  .byte {
    fill: none;
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }

  .byte.fixed {
    stroke: #2a78d6;
  }

  .byte.lost {
    stroke: #e34948;
    stroke-dasharray: 4 2;
  }

  .tools {
    font-size: 0.9375rem;
  }

  .hint {
    margin: 0;
    color: var(--muted);
  }

  /* Two buttons to a row wherever the tools are narrow, which is everywhere but the middle layout's wide column. */
  .buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: 0.375rem;
    margin: 0.625rem 0 0;
  }

  .buttons button {
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .buttons button:hover:not(:disabled) {
    border-color: var(--muted);
  }

  .buttons button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .damage {
    margin: 0.5rem 0 0;
  }

  .marks {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin-top: 0.5rem;
  }

  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1rem;
    margin: 0 0 0 1.6rem;
    color: var(--muted);
  }

  .key span {
    white-space: nowrap;
  }

  .swatch {
    width: 1em;
    height: 1em;
    margin: 0 0.25em 0 0.125em;
    vertical-align: -0.15em;
  }

  .swatch .byte {
    stroke-width: 2px;
  }

  .outcome {
    display: flex;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
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

  .steps-title {
    margin: 1.5rem 0 0.5rem;
    font-size: 1.0625rem;
  }

  .steps {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.9375rem;
  }

  .steps > li {
    padding: 0.5rem 0 0.5rem 1.75rem;
    border-top: 1px solid var(--rule);
  }

  .steps p {
    margin: 0.25rem 0 0;
  }

  .steps .step-head {
    position: relative;
    margin: 0;
  }

  .step-head a {
    margin-left: 0.375rem;
    font-size: 0.875rem;
  }

  .status {
    position: absolute;
    left: -1.75rem;
    width: 1.25rem;
    font-weight: 700;
    text-align: center;
  }

  .right .status {
    color: var(--good);
  }

  .wrong .status {
    color: var(--critical);
  }

  .skipped {
    color: var(--muted);
  }

  /* The site's table style, more compact, scrolling within itself when there are many blocks. */
  .table-wrap {
    max-height: 20rem;
    margin: 0.5rem 0 0;
    overflow: auto;
  }

  .table-wrap table {
    font-size: 0.875rem;
  }

  .table-wrap th,
  .table-wrap td {
    padding: 0.25rem 0.625rem;
    white-space: nowrap;
  }

  .table-wrap td.result {
    width: 100%;
    white-space: normal;
  }

  @media (max-width: 30rem) {
    .table-wrap table {
      font-size: 0.8125rem;
    }

    .table-wrap th,
    .table-wrap td {
      padding-inline: 0.375rem;
    }
  }

  .table-wrap thead th {
    position: sticky;
    top: 0;
  }

  .table-wrap tbody th {
    border-bottom: 0;
    background: none;
    font-weight: normal;
  }

  .table-wrap .num {
    text-align: right;
  }

  tr.right .icon {
    color: var(--good);
  }

  tr.failed .icon,
  tr.wrong .icon {
    color: var(--critical);
  }

  .table-note {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .decoded {
    max-height: 8rem;
    padding: 0.375rem 0.5rem;
    overflow: auto;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--surface);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
