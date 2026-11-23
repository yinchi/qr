# Interactive QR code explainer

Six pages: five chapters, read in order, and a standalone full demo.

## Across all pages

- Previous/next links between chapters
- Each chapter links to the earlier chapters it builds on
- Header with a chapter menu and a light/dark/system theme toggle
- "On this page" contents: a sticky sidebar on wide screens, a collapsible box on narrow ones
- A link on each section heading, for sharing
- A 404 page listing the chapters

## Chapter 1: Parts of a QR code

- Interactive widget at the top of the page: the fixed parts for a given version, starting at version 7
  - Pick a version (1–40) and see only the fixed parts, with the size of the code (17 + 4 × version modules per side)
  - Show where the alignment patterns go and how their number grows with the version
  - Toggle the area reserved for the format information, left blank because its bits depend on the error correction level and mask
  - From version 7, show the actual version information bits, since they depend only on the version
  - Count the modules left over for the data area
  - The sections below follow the order of the widget's legend
- The fixed parts
  - Finder patterns: the three large squares in the corners, used to locate the code and work out its orientation
  - Separators: light strips, one module wide, on the sides of each finder pattern that face into the code
  - Timing patterns
  - Alignment patterns: none in version 1, more as the version increases
  - Dark module: a single module next to the bottom-left finder pattern that is always dark
- Quiet zone: the light margin, four modules wide, around the whole code
- Format information: two copies of 15 bits beside the finder patterns
- Version information, only in versions 7 and up: a block 6 modules tall and 3 wide left of the top-right finder pattern, and the same block turned on its side above the bottom-left one
- Data area

## Chapter 2: Format and version information

- Error correction levels: L, M, Q, H
  - How much data can be stored given the code size (version) and error correction level?
  - Conversely, what is the smallest code size (version) needed to store a given amount of data with a specific error correction level?
- Mask pattern: eight valid patterns, three bits in the format strip
- How the format information is encoded
  - How BCH codes work
  - BCH(15, 5) interactive encoder/decoder: encode, introduce errors by flipping bits, and verify if code is still recoverable
  - The format information is stored twice, so a decoder can fall back on the second copy
- Version information (versions 7 and up)
  - The version number (6 bits) encoded with the (18, 6) Golay code, stored twice, not masked
  - Reuse the encoder/decoder widget: same polynomial division as the BCH code, with a different generator

## Chapter 3: Encoding the data

- Encoding modes: numeric, alphanumeric, byte, kanji
  - Interactive encoding example for each mode, with Kanji samples so users don't have to input their own
- Building the bitstream
  - Mode indicator and character count indicator (its length depends on the mode and the version)
  - Terminator, padding to a whole number of bytes, then the pad bytes 0xEC and 0x11, repeated to fill the remaining capacity

## Chapter 4: Error correction

- Arithmetic in GF(2^8)
- Reed-Solomon error correction codes
  - The same polynomial long division as the BCH codes in chapter 2, but on bytes instead of bits
  - A small example of encoding and decoding with Reed-Solomon codes: introduce errors by changing byte values and verify if the original data can be recovered. Not individual bits as laid out in the actual QR code, as Reed-Solomon codes operate on bytes.
- Splitting into blocks and interleaving
  - The data bytes are split into blocks, with sizes that depend on the version and error correction level; each block gets its own Reed-Solomon error correction bytes
  - The blocks are interleaved, so damage to one area of the code is spread over several blocks

## Chapter 5: Placing the data

- Laying out the bytes in the data area
  - How the placement follows a zigzag pattern
  - How the fixed patterns and the format and version information (chapters 1 and 2) affect the layout
  - Remainder bits: the few modules left over in some versions after all the bytes are placed
- Applying the mask pattern to the data area
  - Scoring each of the eight mask patterns according to the penalty rules

## Full interactive QR code demo (standalone page)

- Generate a QR code from input data and error correction level
- Introduce errors into the QR code
- Attempt to decode the QR code and verify if the original data can be recovered
  - Show the result for each block: how many errors were corrected, or that the block could not be recovered
- Each stage of the decode result links to the chapter that explains it
