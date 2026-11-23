// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import svelte from '@astrojs/svelte';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  // GitHub Pages serves a project site at https://<user>.github.io/<repo>/,
  // so every URL needs the repo name as a prefix. Use '/' for a custom domain.
  base: '/qr',
  trailingSlash: 'always',
  // $...$ and $$...$$ in Markdown and MDX are typeset by KaTeX when the site is built. Astro's default Markdown
  // processor (Sätteri) doesn't support remark/rehype plugins, so use the unified one; MDX inherits its plugins.
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
  },
  integrations: [mdx(), svelte()],
});
