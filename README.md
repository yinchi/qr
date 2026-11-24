# How QR codes work

An interactive explainer of how QR codes store data and survive damage, following the standard, ISO/IEC 18004:2015.

**Read it at <https://yinchi.dev/qr/>.**

1. [Parts of a QR code](https://yinchi.dev/qr/parts/)
2. [Format and version information](https://yinchi.dev/qr/format/)
3. [Encoding the data](https://yinchi.dev/qr/encoding/)
4. [Arithmetic on bytes](https://yinchi.dev/qr/byte-arithmetic/)
5. [Reed-Solomon codes](https://yinchi.dev/qr/reed-solomon/)
6. [Placing the data](https://yinchi.dev/qr/placement/)

Then the [full demo](https://yinchi.dev/qr/demo/): make a QR code, damage it, and see whether it can still be read.

Each chapter has interactive widgets, and introduces the maths it needs just before it's used: polynomials over bits,
arithmetic on bytes, and Reed-Solomon codes.

## Building

The site is static, built with [Astro](https://astro.build), with [Svelte](https://svelte.dev) for the widgets and
[KaTeX](https://katex.org) for the maths. It needs Node.js 22.23 or later.

```sh
npm install
npm run dev     # local server at http://localhost:4321/qr/
npm test        # unit tests
npm run check   # type checks
npm run build   # the site, in dist/
```

The QR code itself is plain TypeScript in [`src/lib/qr/`](src/lib/qr/): encoding, Reed-Solomon codes, placement,
masking, and reading a code back. Its tests check it against the standard's worked example and against the
[qrcode](https://www.npmjs.com/package/qrcode) package. The widgets are in [`src/components/qr/`](src/components/qr/)
and the chapters in [`src/content/chapters/`](src/content/chapters/).

Every push to `main` is published to GitHub Pages by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
