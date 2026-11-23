# Interactive QR code explainer

Seven pages: six chapters, read in order, and a standalone full demo. Each piece of maths is introduced just before it
is needed: polynomials over bits in chapter 2, bytes (GF(2⁸)) in chapter 4, Reed-Solomon codes in chapter 5.

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

- Error correction levels: L, M, Q, H, restoring about 7, 15, 25 and 30 % of the codewords (Table 8), with their format bits (Table 12)
  - How much data can be stored given the code size (version) and error correction level?
  - Conversely, what is the smallest code size (version) needed to store a given amount of data with a specific error correction level?
  - Capacity is given in bytes (data codewords, from Table 9); chapter 3 converts it to characters for each mode (Table 7)
  - Interactive capacity chart: data bytes against version for each level, a version picker with a table of its numbers, and the smallest version for a given number of bytes
  - Repairing a byte takes two error correction bytes; the smallest codes keep a few back for detection only (misdecode protection, 7.5.1)
- Mask pattern: eight valid patterns, three bits in the format strip
  - Table of the eight patterns on a version 1 code with their conditions (Table 10, Figure 21); how they are scored is in chapter 6
- How the format information is encoded
  - Polynomials whose coefficients are bits: adding is XOR, so long division is just shifting and XORing
  - The (15, 5) BCH code: append the remainder of dividing by the generator polynomial, then XOR with the mask 101010000010010 so that no codeword is all zeros
  - Decoding as in the standard: pick the closest of the 32 valid codewords. Any two differ in at least 7 bits, so up to 3 bit errors can be corrected; show this by comparing every pair of codewords rather than with theory (a table of all 496 pairs)
  - BCH(15, 5) interactive encoder/decoder: encode, introduce errors by flipping bits, and verify if code is still recoverable
    - The division shown step by step; flipping 4 or more bits can make the decoder pick the wrong codeword
  - The format information is stored twice, so a decoder can fall back on the second copy
  - Optional aside: why this generator gives a distance of 7 comes from arithmetic in GF(16), beyond the scope of the explainer
- Version information (versions 7 and up)
  - The version number (6 bits) encoded with the (18, 6) Golay code, stored twice, not masked
  - Reuse the encoder/decoder widget: same polynomial division as the BCH code, with a different generator
  - The 34 valid codewords differ in at least 8 bits, so up to 3 bit errors can be corrected (standard, Annex D); table of all 561 pairs
- Where the bits go: which module holds each bit of both copies (Figures 25 and 28)
  - Format information: the first copy wraps around the top-left finder; the second is split between the other two corners, so no corner holds both copies
  - Version information: the top-right block fills row by row, the bottom-left block is its mirror image and fills column by column
  - Interactive close-ups of the three corners, with each bit numbered and shown dark for 1; pointing at a bit highlights both of its copies

## Chapter 3: Encoding the data

- Encoding modes: numeric, alphanumeric, byte, kanji
  - Interactive encoding example for each mode, with Kanji samples so users don't have to input their own
- Building the bitstream
  - Mode indicator and character count indicator (its length depends on the mode and the version)
  - Terminator, padding to a whole number of bytes, then the pad bytes 0xEC and 0x11, repeated to fill the remaining capacity

## Chapter 4: Arithmetic on bytes

- From bits to bytes: chapter 2's polynomials had bit coefficients; Reed-Solomon codes need the same operations on bytes
  - Why ordinary arithmetic modulo 256 doesn't work: division fails (2 has no inverse)
  - A byte as a polynomial of degree below 8 with bit coefficients
- Adding bytes: XOR, with no carries; subtracting is the same as adding
- Multiplying bytes: multiply the polynomials, then take the remainder modulo x⁸ + x⁴ + x³ + x² + 1 (the standard's choice)
  - Interactive byte multiplier showing the bit-level steps
- Powers of 2 and log tables: the powers of 2 run through all 255 non-zero bytes before repeating
  - Interactive view of the cycle of powers
  - Multiplying by adding logs
- Dividing bytes: every non-zero byte has an inverse
- Polynomials with byte coefficients: adding, multiplying and dividing them, ready for chapter 5

## Chapter 5: Reed-Solomon codes

- Encoding
  - The same polynomial long division as the BCH code in chapter 2, now with the byte arithmetic of chapter 4
- Decoding
  - From the received bytes alone, work out whether there are errors, where they are, and what the bytes should have been
- Interactive example: a small example of encoding and decoding with Reed-Solomon codes: introduce errors by changing byte values and verify if the original data can be recovered. Not individual bits as laid out in the actual QR code, as Reed-Solomon codes operate on bytes.
- Splitting into blocks and interleaving
  - The data bytes are split into blocks, with sizes that depend on the version and error correction level; each block gets its own Reed-Solomon error correction bytes
  - The blocks are interleaved, so damage to one area of the code is spread over several blocks

## Chapter 6: Placing the data

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
