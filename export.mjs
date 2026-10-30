// export.mjs — exportă ro.thechillinbear.com (WordPress) în fișiere Markdown + imagini,
// păstrând exact URL-urile. Rulare:  npm i cheerio turndown  &&  node export.mjs
//
// Rezultat, în folderul ./export:
//   content/posts/<slug>.md     articolele (frontmatter + text curățat)
//   content/pages/<slug>.md     paginile (Trasee, Cabane etc.)
//   public/wp-content/uploads/  pozele, la aceleași căi ca pe site-ul vechi
//   old-urls.txt                toate URL-urile din sitemap-ul vechi (pentru verificare)
//   report.json                 ce s-a găsit la fiecare articol + avertismente

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const BASE = 'https://ro.thechillinbear.com';
const OUT = path.resolve('export');
const CONCURRENCY = 4;
const UA = { 'User-Agent': 'chillinbear-export/1.0' };

// ---------- utilitare ----------

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} la ${url}`);
  return { data: await res.json(), headers: res.headers };
}

async function getText(url) {
  try {
    const res = await fetch(url, { headers: UA });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

const decode = (html = '') => cheerio.load(`<div>${html}</div>`)('div').text().trim();

// Transformă orice URL de pe site într-o cale relativă: https://ro.thechillinbear.com/x/ → /x/
// și repară vechile căi /wp/wp-content/ → /wp-content/
export function normalizeUrl(u) {
  if (!u) return u;
  return u
    .trim()
    .replace(/^(?:https?:)?\/\/ro\.thechillinbear\.com\/wp\/wp-content\//, '/wp-content/')
    .replace(/^(?:https?:)?\/\/ro\.thechillinbear\.com(?=\/|$)/, '')
    .replace(/^$/, '/');
}

const isUpload = (u) => typeof u === 'string' && u.startsWith('/wp-content/uploads/');

// ---------- 1. lista de URL-uri din sitemap-ul vechi ----------

async function collectSitemapUrls() {
  const queue = [`${BASE}/sitemap_index.xml`, `${BASE}/sitemap.xml`, `${BASE}/wp-sitemap.xml`];
  const seen = new Set();
  const urls = new Set();
  while (queue.length) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const xml = await getText(u);
    if (!xml || !xml.includes('<loc>')) continue;
    const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].trim());
    const isIndex = /<sitemapindex/i.test(xml);
    for (const l of locs) (isIndex ? queue.push(l) : urls.add(l));
  }
  return [...urls].sort();
}

// ---------- 2. toate articolele și paginile prin API ----------

async function fetchAll(type) {
  const items = [];
  for (let page = 1; ; page++) {
    const { data, headers } = await getJSON(`${BASE}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_embed=1`);
    items.push(...data);
    if (page >= Number(headers.get('x-wp-totalpages') || 1)) break;
  }
  return items;
}

// ---------- 3. curățarea conținutului ----------

const STAT_LABELS = { Dificultate: 'difficulty', Durata: 'duration', 'Altitudine Maximă': 'altitude' };
const ICON_RE = /(Dificultate|Timp|Altitudine)-accent|icons8-/i;

export function cleanContent(html, images, warnings) {
  // eventuale shortcode-uri rămase nerandate
  html = html.replace(/\[\/?(?:vc_|tlg_|nd_)[^\]]*\]/g, '');
  const $ = cheerio.load(html, null, false);

  $('script, style, noscript, .page-nav, .clearfix, .tlg-spacer, a#home, .breadcrumb').remove();

  // WPBakery pune articolul de două ori: o dată pentru desktop, o dată pentru mobil.
  // Păstrăm doar versiunea de desktop, dacă asta nu golește pagina.
  const mobile = $('.vc_hidden-lg.vc_hidden-md');
  if (mobile.length) {
    const total = $.root().text().trim().length;
    const mobileLen = mobile.text().trim().length;
    if (total - mobileLen > total * 0.3) mobile.remove();
    else warnings.push('am păstrat versiunea de mobil (cea de desktop părea goală)');
  }

  // Extragem dificultatea, durata și altitudinea în frontmatter
  const stats = {};
  $('p').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    for (const [label, key] of Object.entries(STAT_LABELS)) {
      const m = t.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'i'));
      if (m && !stats[key]) {
        stats[key] = m[1].trim();
        const row = $(el).closest('.vc_inner');
        if (row.length) row.remove();
        else $(el).remove();
      }
    }
  });
  $('img').filter((_, el) => ICON_RE.test($(el).attr('src') || '')).remove();

  // Imagini: o singură sursă, căi relative, caption folosit ca alt dacă lipsește
  $('img').each((_, el) => {
    const img = $(el);
    const src = normalizeUrl(img.attr('data-src') || img.attr('src'));
    img.attr('src', src);
    img.removeAttr('srcset').removeAttr('sizes').removeAttr('data-src').removeAttr('class').removeAttr('style');
    if (isUpload(src)) images.add(src.split('?')[0]);
  });
  $('figure').each((_, el) => {
    const fig = $(el);
    const img = fig.find('img').first();
    const cap = fig.find('figcaption').text().trim();
    if (!img.length) return void fig.remove();
    if (!img.attr('alt') && cap) img.attr('alt', cap);
    fig.replaceWith(`<p>${$.html(img)}</p>${cap ? `<p><em>${cap}</em></p>` : ''}`);
  });

  // Linkuri interne relative
  $('a[href]').each((_, el) => $(el).attr('href', normalizeUrl($(el).attr('href'))));

  // Iframe-uri (Google Maps): păstrăm doar atributele utile
  $('iframe').each((_, el) => {
    const f = $(el);
    f.replaceWith(`<iframe src="${f.attr('src')}" width="100%" height="450" loading="lazy" style="border:0" allowfullscreen></iframe>`);
  });

  return { html: $.html(), stats };
}

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*' });
td.keep(['iframe']);

export function toMarkdown(html) {
  return td
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- 4. un articol → fișier .md ----------

function frontmatter(obj) {
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

async function processItem(item, kind, images, report) {
  const warnings = [];
  const url = new URL(item.link).pathname; // ex: /traseul-spre-varful-giumalau/

  // Conținutul îl luăm din pagina randată (WPBakery nu se randează mereu corect prin API)
  let raw = null;
  const page = await getText(item.link);
  if (page) {
    const $ = cheerio.load(page);
    const wrap = $('.tlg-page-wrapper').first();
    if (wrap.length) raw = wrap.html();
  }
  if (!raw) {
    warnings.push('conținut luat din API, nu din pagină');
    raw = item.content?.rendered || '';
  }

  const { html, stats } = cleanContent(raw, images, warnings);
  const body = toMarkdown(html);

  const yoast = item.yoast_head_json || {};
  const featured = normalizeUrl(item._embedded?.['wp:featuredmedia']?.[0]?.source_url);
  if (isUpload(featured)) images.add(featured);
  const terms = item._embedded?.['wp:term'] || [];

  const data = {
    title: decode(item.title?.rendered),
    url,
    seoTitle: yoast.title ? decode(yoast.title) : undefined,
    description: yoast.description || decode(item.excerpt?.rendered).slice(0, 160) || undefined,
    date: item.date_gmt ? `${item.date_gmt}Z` : item.date,
    updated: item.modified_gmt ? `${item.modified_gmt}Z` : item.modified,
    hero: featured,
    difficulty: stats.difficulty,
    duration: stats.duration,
    altitude: stats.altitude,
    categories: (terms[0] || []).map((t) => decode(t.name)),
    tags: (terms[1] || []).map((t) => decode(t.name)),
  };

  const slug = item.slug || url.split('/').filter(Boolean).pop() || 'index';
  const file = path.join(OUT, 'content', kind, `${slug}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, frontmatter(data) + body + '\n');

  if (body.length < 300) warnings.push('text foarte scurt — verifică manual');
  report.push({ url, file: path.relative(OUT, file), stats, words: body.split(/\s+/).length, warnings });
  console.log(`  ✓ ${url}${warnings.length ? '  ⚠ ' + warnings.join('; ') : ''}`);
}

// ---------- 5. descărcarea imaginilor ----------

async function downloadImage(p, failed) {
  const dest = path.join(OUT, 'public', decodeURIComponent(p));
  try {
    await fs.access(dest);
    return; // deja descărcată
  } catch {}
  for (const url of [BASE + p, BASE + p.replace('/wp-content/', '/wp/wp-content/')]) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) continue;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch {}
  }
  failed.push(p);
}

// ---------- main ----------

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  console.log('1/4 Citesc sitemap-ul vechi…');
  const oldUrls = await collectSitemapUrls();
  await fs.writeFile(path.join(OUT, 'old-urls.txt'), oldUrls.join('\n') + '\n');
  console.log(`  ${oldUrls.length} URL-uri salvate în export/old-urls.txt`);

  console.log('2/4 Citesc articolele și paginile din API…');
  const posts = await fetchAll('posts');
  const pages = await fetchAll('pages');
  console.log(`  ${posts.length} articole, ${pages.length} pagini`);

  console.log('3/4 Convertesc conținutul…');
  const images = new Set();
  const report = [];
  const jobs = [...posts.map((p) => [p, 'posts']), ...pages.map((p) => [p, 'pages'])];
  await pool(jobs, CONCURRENCY, async ([item, kind]) => {
    try {
      await processItem(item, kind, images, report);
    } catch (e) {
      report.push({ url: item.link, error: String(e) });
      console.log(`  ✗ ${item.link}: ${e.message}`);
    }
  });

  console.log(`4/4 Descarc ${images.size} imagini…`);
  const failed = [];
  await pool([...images], CONCURRENCY, (p) => downloadImage(p, failed));

  report.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ failedImages: failed, items: report }, null, 2));

  const withWarnings = report.filter((r) => r.error || r.warnings?.length).length;
  console.log(`\nGata. ${report.length} fișiere, ${images.size - failed.length}/${images.size} imagini.`);
  if (failed.length) console.log(`⚠ ${failed.length} imagini nu s-au putut descărca — vezi export/report.json`);
  if (withWarnings) console.log(`⚠ ${withWarnings} fișiere au avertismente — vezi export/report.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('Eroare:', e.message);
    process.exit(1);
  });
}
