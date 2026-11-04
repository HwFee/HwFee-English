// Collects the real cover images the artboards show, as small data URLs.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const src = 'C:/Users/HwFee/Desktop/HwFee-English/designs/hwfee-english-ui/src/';
const episodes = 'C:\\Users\\HwFee\\Desktop\\English-listening\\.agents\\skills\\cherina-pod\\episodes\\';
const archive = 'C:\\Users\\HwFee\\Desktop\\扇贝阅读助手\\data\\archive\\';

// The four lessons the 精听 artboard shows, in order: hero first.
const wanted = [
  ['lesson0', 'a-chat-in-english-while-i-paint-my-nails-YaxO03y6akc', 'mqdefault'],
  ['lesson1', 'a-cosy-day-at-home-in-the-uk-ePZJcyI46T8', 'default'],
  ['lesson2', 'a-day-in-london-during-the-heatwave-lvEC6xjsx3k', 'default'],
  ['lesson3', 'a-day-in-sweden-slow-british-english-gnUB8TVM-Y0', 'default'],
];

const out = {};

async function grab(key, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(key + ' ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type') || 'image/jpeg';
  out[key] = `data:${type};base64,${bytes.toString('base64')}`;
  console.log(key.padEnd(9), String(bytes.length).padStart(6), 'bytes');
}

// Each episode records its thumbnail under podcast.image; use that rather than the folder name.
for (const [key, folder, size] of wanted) {
  const meta = JSON.parse(await readFile(join(episodes, folder, 'meta.json'), 'utf8'));
  const image = meta.podcast?.image || meta.episode?.image;
  if (!image) { console.log(key, 'no image recorded'); continue; }
  await grab(key, image.replace(/maxresdefault|hqdefault/, size));
}

// Recent articles: the archive knows each piece's id, the API knows its cover.
let cookie = '';
try {
  const { restoreCookie } = await import('file:///C:/Users/HwFee/Desktop/%E6%89%87%E8%B4%9D%E9%98%85%E8%AF%BB%E5%8A%A9%E6%89%8B/secure-store.mjs');
  const { parseCookie } = await import('file:///C:/Users/HwFee/Desktop/%E6%89%87%E8%B4%9D%E9%98%85%E8%AF%BB%E5%8A%A9%E6%89%8B/lib.mjs');
  const raw = await restoreCookie('file:///C:/Users/HwFee/Desktop/%E6%89%87%E8%B4%9D%E9%98%85%E8%AF%BB%E5%8A%A9%E6%89%8B/data/session.dpapi');
  cookie = parseCookie(raw);
  console.log('shanbay session: ok');
} catch (error) {
  console.log('shanbay session unavailable (' + String(error.message).slice(0, 40) + ') — older rows keep placeholders');
}
const csrf = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];

const dates = (await readdir(archive, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .reverse()
  .filter((date) => date < '2026-11-02')
  .slice(0, 3);

for (const [index, date] of cookie ? dates.entries() : []) {
  const files = (await readdir(join(archive, date))).filter((name) => /^article-.*\.json$/.test(name)).sort();
  if (!files.length) { console.log('recent' + index, 'no archive file in', date); continue; }
  const article = JSON.parse(await readFile(join(archive, date, files.at(-1)), 'utf8'));
  const id = String(article.source || '').match(/articles\/([A-Za-z0-9]+)/)?.[1];
  if (!id) { console.log('recent' + index, 'no id for', date); continue; }
  const response = await fetch(`https://apiv3.shanbay.com/news/articles/${id}?source=1`, {
    headers: {
      Accept: 'application/json', Cookie: cookie, Origin: 'https://web.shanbay.com',
      Referer: 'https://web.shanbay.com/', 'User-Agent': 'Mozilla/5.0',
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
    },
  });
  if (!response.ok) { console.log('recent' + index, 'article', response.status); continue; }
  const detail = await response.json();
  const thumb = detail.thumbnail_urls?.[0];
  if (!thumb) { console.log('recent' + index, 'no thumbnail'); continue; }
  await grab(`recent${index}`, thumb.replace(/w_\d+,h_\d+/, 'w_240,h_240').replace(/q_\d+/, 'q_70'));
}

await writeFile(src + 'thumbs.json', JSON.stringify(out, null, 1), 'utf8');
const total = Object.values(out).reduce((sum, value) => sum + value.length, 0);
console.log('images:', Object.keys(out).length, '| data URL chars:', total);
