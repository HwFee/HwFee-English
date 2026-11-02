// Builds the stored page: index.src.html + the cover data URL -> index.html
import { readFile, writeFile } from 'node:fs/promises';

const dir = 'C:\\Users\\HwFee\\Desktop\\HwFee-English\\designs\\hwfee-english-ui\\src\\';
const source = await readFile(dir + 'index.src.html', 'utf8');
const cover = (await readFile(dir + 'cover.dataurl', 'utf8')).trim();

if (!cover.startsWith('data:image/')) throw new Error('cover.dataurl is not an image data URL');
const out = source.split('{{COVER}}').join(cover);
if (out.includes('{{')) throw new Error('unreplaced placeholder left in the page');

await writeFile(dir + 'index.html', out, 'utf8');
console.log(JSON.stringify({ bytes: out.length, coverChars: cover.length }));
