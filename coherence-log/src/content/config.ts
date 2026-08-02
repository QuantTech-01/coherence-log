import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.date(),
    // which track this post belongs to — drives the accent color
    track: z.enum(['quantum', 'software']),
    summary: z.string(),
    // links to the sources a generated post was drafted from
    sources: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
