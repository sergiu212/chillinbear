// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ro.thechillinbear.com',
  // URL-uri identice cu cele din WordPress: /traseul-spre-varful-giumalau/
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap()],
});
