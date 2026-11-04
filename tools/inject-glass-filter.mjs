// Embeds the baked refraction map into the shell as an inline SVG filter.
// Idempotent: re-running replaces the block instead of stacking duplicates.
import { readFile, writeFile } from 'node:fs/promises';

const page = new URL('../web/index.html', import.meta.url);
const mapFile = new URL('../.tmp/island-map.b64', import.meta.url);

const base64 = (await readFile(mapFile, 'utf8')).trim();
if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('island-map.b64 is not valid base64');

const block = `<!-- Liquid glass refraction map, baked by tools/gen-glass-map.py (352x58, radius 29,
     band 14, displacement 10). Regenerate with:
     python tools/gen-glass-map.py 352 58 29 14 10 .tmp/island-map.b64 && node tools/inject-glass-filter.mjs
     Keep this <svg> in the DOM: a filter reference that resolves to nothing silently
     drops the whole backdrop-filter, blur included. -->
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
  <filter id="lg-refract" x="0" y="0" width="100%" height="100%"
          primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <feImage href="data:image/png;base64,${base64}"
             x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="20"
                       xChannelSelector="R" yChannelSelector="G"/>
  </filter>
</svg>
`;

let html = await readFile(page, 'utf8');
const pattern = /<!-- Liquid glass refraction map[\s\S]*?<\/svg>\n/;
if (pattern.test(html)) {
  html = html.replace(pattern, block);
} else {
  html = html.replace('</body>', `${block}</body>`);
  if (!html.includes('id="lg-refract"')) throw new Error('could not place the filter block');
}
await writeFile(page, html, 'utf8');
console.log(JSON.stringify({ page: 'web/index.html', mapChars: base64.length, bytes: html.length }));
