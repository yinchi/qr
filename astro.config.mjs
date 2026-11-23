// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import svelte from '@astrojs/svelte';

export default defineConfig({
  // GitHub Pages serves a project site at https://<user>.github.io/<repo>/,
  // so every URL needs the repo name as a prefix. Use '/' for a custom domain.
  base: '/qr',
  trailingSlash: 'always',
  integrations: [mdx(), svelte()],
});
