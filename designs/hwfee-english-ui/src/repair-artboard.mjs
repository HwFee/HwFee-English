// One-off repair: rebuilds the reading artboard's card as a clean skeleton with
// explicit article-body markers, so the injector can no longer guess at </div>.
import { readFile, writeFile } from 'node:fs/promises';

const page = 'C:/Users/HwFee/Desktop/HwFee-English/designs/hwfee-english-ui/src/index.src.html';
let html = await readFile(page, 'utf8');

const start = html.indexOf('<div class="phone bleed">');
const end = html.indexOf('<div class="tabbar">', start);
if (start < 0 || end < 0) throw new Error('reading artboard not found');

const block = html.slice(start, end);
const title = block.match(/<div class="art-t">([\s\S]*?)<\/div>/)?.[1];
const subtitle = block.match(/<div class="art-cn">([\s\S]*?)<\/div>/)?.[1];
if (!title || !subtitle) throw new Error('article title or subtitle missing');

const clean = `        <div class="phone bleed">
          <div class="scr">
            <div class="paper">
              <div class="art-t">${title}</div>
              <div class="art-cn">${subtitle}</div>
              <p class="body-text" id="hw-excerpt" hidden>—</p>
              <div class="art-body" id="hw-art-body">
                <!--ARTICLE-BODY:START-->
                <!--ARTICLE-BODY:END-->
              </div>
            </div>
          </div>
          `;

html = html.slice(0, start) + clean + html.slice(end);
await writeFile(page, html, 'utf8');
console.log(JSON.stringify({ repaired: true, bytes: html.length }));
