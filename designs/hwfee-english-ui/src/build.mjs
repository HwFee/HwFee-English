// Builds the stored page: index.src.html + the cover data URL -> index.html
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('.', import.meta.url);
const source = await readFile(new URL('index.src.html', dir), 'utf8');
const cover = (await readFile(new URL('cover.dataurl', dir), 'utf8')).trim();
const thumbs = JSON.parse(await readFile(new URL('thumbs.json', dir), 'utf8'));

// A switcher outside its phone anchors to the editor and covers all artboards.
// Refuse to publish that structure, even if the dashboard's data checks pass.
const markup = source.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const stack = [];
const phones = [];
for (const [tag] of markup.matchAll(/<\/?div\b[^>]*>/gi)) {
  if (tag.startsWith('</')) {
    if (!stack.length) throw new Error('Unmatched closing div in the artboards');
    stack.pop();
    continue;
  }
  const classes = (tag.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/);
  const node = { classes, switchers: 0 };
  if (classes.includes('phone')) phones.push(node);
  if (classes.includes('tabbar')) {
    const parent = stack.at(-1);
    if (!parent?.classes.includes('phone')) {
      throw new Error('Every floating switcher must be a direct child of its phone frame');
    }
    parent.switchers++;
  }
  stack.push(node);
}
if (stack.length || !phones.length || phones.some((phone) => phone.switchers !== 1)) {
  throw new Error('Each balanced phone frame must contain exactly one floating switcher');
}

if (!cover.startsWith('data:image/')) throw new Error('cover.dataurl is not an image data URL');
let out = source.split('{{COVER}}').join(cover);
for (const [key, value] of Object.entries(thumbs)) {
  if (!value.startsWith('data:image/')) throw new Error(`thumbs.json: ${key} is not an image`);
  out = out.split(`{{IMG:${key}}}`).join(value);
}
if (out.includes('{{')) throw new Error('unreplaced placeholder left in the page');

await writeFile(new URL('index.html', dir), out, 'utf8');
console.log(JSON.stringify({ bytes: Buffer.byteLength(out), coverChars: cover.length, thumbs: Object.keys(thumbs).length,
  phoneFrames: phones.length, containedSwitchers: phones.reduce((sum, phone) => sum + phone.switchers, 0) }));
