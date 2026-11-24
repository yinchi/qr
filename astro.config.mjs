// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import svelte from '@astrojs/svelte';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  // Published by GitHub Pages as a project site (see .github/workflows/deploy.yml). Project sites are served under the
  // custom domain of the owner's <user>.github.io site, at /<repo>/, so every URL needs the repo name as a prefix.
  site: 'https://yinchi.dev',
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
