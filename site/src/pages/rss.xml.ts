import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
  return rss({
    title: "The Chillin' Bear",
    description: 'Trasee montane și ghiduri de drumeție în Munții Carpați',
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.date,
      link: p.data.url,
    })),
  });
}
