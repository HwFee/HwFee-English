import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'android/app/src/main/res');
let count = 0;
for (const mode of ['', 'night-']) {
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    for (const [name, base] of [['ic_launcher', 48], ['ic_launcher_round', 48], ['ic_launcher_foreground', 108]]) {
      const file = path.join(res, `mipmap-${mode}${density}`, `${name}.png`);
      const data = fs.readFileSync(file);
      assert.equal(data.subarray(1, 4).toString(), 'PNG', file);
      assert.equal(data.readUInt32BE(16), base * scale, file);
      assert.equal(data.readUInt32BE(20), base * scale, file);
      assert.equal(data[25], 6, `${file}: RGBA required for adaptive layers/masks`);
      if (name === 'ic_launcher_foreground') {
        const size = base * scale;
        const pixels = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${data.toString('base64')}"/></svg>`, { font: { loadSystemFonts: false } }).render().pixels;
        assert.equal(pixels[3], 0, `${file}: foreground corners must be transparent`);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (pixels[(y * size + x) * 4 + 3] > 16) {
              assert.ok((x + .5 - size / 2) ** 2 + (y + .5 - size / 2) ** 2 <= (33 * scale + .5) ** 2,
                `${file}: artwork outside adaptive safe circle at ${x},${y}`);
            }
          }
        }
      }
      count++;
    }
  }
}
for (const api of [26, 33]) {
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const xml = fs.readFileSync(path.join(res, `mipmap-anydpi-v${api}`, `${name}.xml`), 'utf8');
    assert.match(xml, /<adaptive-icon\b/);
    assert.match(xml, /@color\/ic_launcher_background/);
    assert.ok(xml.includes(`@${api === 26 ? 'mipmap' : 'drawable'}/ic_launcher_foreground`));
    assert.match(xml, /<monochrome[^>]+@drawable\/ic_launcher_monochrome/);
  }
}
for (const name of ['ic_launcher_foreground', 'ic_launcher_monochrome', 'splash_mark']) {
  const xml = fs.readFileSync(path.join(res, 'drawable', `${name}.xml`), 'utf8');
  assert.match(xml, /<vector\b/);
  assert.match(xml, /viewportWidth="108"/);
  if (name === 'ic_launcher_monochrome') assert.ok(!xml.includes('@color/'), 'Monochrome must have one alpha silhouette');
}
for (const qualifier of ['values', 'values-night']) {
  const colors = fs.readFileSync(path.join(res, qualifier, 'brand_colors.xml'), 'utf8');
  assert.match(colors, /name="splash_background"/);
  assert.match(colors, /name="ic_launcher_background"/);
}
const styles = fs.readFileSync(path.join(res, 'values/styles.xml'), 'utf8');
assert.match(styles, /name="windowSplashScreenAnimatedIcon">@drawable\/splash_mark/);
assert.match(styles, /name="postSplashScreenTheme">@style\/AppTheme.NoActionBar/);
assert.ok(!fs.existsSync(path.join(res, 'drawable/splash.png')), 'Capacitor splash must be removed');
assert.ok(!fs.existsSync(path.join(res, 'drawable-v24/ic_launcher_foreground.xml')), 'Template foreground must be removed');
console.log(`Brand assets valid: ${count} density PNGs, transparent foregrounds inside the safe circle, 4 adaptive XMLs, 3 vectors, day/night colors and splash theme.`);
