// Fills the reading artboard with a real article body, so text sits behind the glass switcher.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const page = 'C:/Users/HwFee/Desktop/HwFee-English/designs/hwfee-english-ui/src/index.src.html';
const archive = 'C:\\Users\\HwFee\\Desktop\\扇贝阅读助手\\data\\archive\\2026-10-31';

const files = (await readdir(archive)).filter((name) => /^article-.*\.json$/.test(name)).sort();
if (!files.length) throw new Error('no archived article to read');
const article = JSON.parse(await readFile(join(archive, files.at(-1)), 'utf8'));

// The sentence the mock long-presses, and the translation the card shows.
const target = 'the devil-dog Black Shuck lurking in the mist';
// Skip paragraphs with numerals: on a page of prose they read as unsourced figures.
const paragraphs = article.paragraphs.filter((text) => !/\d/.test(text)).slice(0, 9);
if (!paragraphs.some((text) => text.includes(target))) throw new Error('target sentence not in article');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The translation card sits directly under the pressed sentence, never over it.
const popover = `                <div class="pop glass">
                  <div class="pk">译文 · 长按句子</div>
                  <div class="pt">在雾中出没的魔犬「黑夏克」。</div>
                  <div class="pa">点浮层外关闭 · 打开另一个时先关这个</div>
                </div>`;

const body = paragraphs
  .map((text) => {
    const shown = escape(text).replace(target, `<mark>${target}</mark>`);
    const paragraph = `                <p class="body-text">${shown}</p>`;
    return text.includes(target) ? paragraph + '\n' + popover : paragraph;
  })
  .join('\n');

let html = await readFile(page, 'utf8');
if (!html.includes('<!--ARTICLE-BODY:START-->') || !html.includes('<!--ARTICLE-BODY:END-->')) {
  throw new Error('article-body markers not found');
}
// Markers, not a </div> guess: the article contains its own divs for the popover.
html = html.replace(
  /(<!--ARTICLE-BODY:START-->)[\s\S]*?(<!--ARTICLE-BODY:END-->)/,
  `$1\n${body}\n                $2`,
);
await writeFile(page, html, 'utf8');

const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
console.log(JSON.stringify({ file: files.at(-1), paragraphs: paragraphs.length, words, bytes: html.length }));
