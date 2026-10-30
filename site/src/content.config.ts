import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    url: z.string().startsWith('/').endsWith('/'),
    seoTitle: z.string().optional(),
    description: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    hero: z.string().optional(),
    difficulty: z.string().optional(),
    duration: z.string().optional(),
    altitude: z.string().optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { posts };
