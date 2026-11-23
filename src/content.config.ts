import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const chapters = defineCollection({
  // The file name (without extension) becomes the chapter's URL slug.
  loader: glob({ pattern: '*.mdx', base: './src/content/chapters' }),
  schema: z.object({
    order: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { chapters };
