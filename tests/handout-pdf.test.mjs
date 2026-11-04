import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const script = await readFile(new URL('../web/listen/handout-shim.js', import.meta.url), 'utf8');

test('PDF uses the native bridge, preserves dictation/range state, and excludes app controls/scripts', async () => {
  const dom = new JSDOM('<html><head><style>.off{display:none}</style></head><body class="dict">'
    + '<div class="tool"><button onclick="print()">打印 / 存为 PDF</button></div><a class="hbf">Back</a>'
    + '<h1>Lesson</h1><section class="seg off">Excluded part</section><section class="seg">Selected part</section>'
    + '<script>throw Error("must not run in PDF")</script></body></html>', {
    url: 'https://localhost/lessons/course/handout.html', runScripts: 'outside-only',
  });
  const w = dom.window, calls = [];
  w.Capacitor = { Plugins: { Lessons: { saveHandoutPdf: async data => calls.push(data) } } };
  w.eval(script);
  const button = w.document.getElementById('hwfee-save-pdf');
  assert.equal(button.textContent, '存为 PDF');
  button.click(); for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].baseUrl, 'https://localhost/lessons/course/handout.html');
  assert.match(calls[0].html, /body class="dict"/);
  assert.match(calls[0].html, /class="seg off"/);
  assert.doesNotMatch(calls[0].html, /<script|class="tool"|class="hbf"/);
  assert.equal(button.disabled, false);
  dom.window.close();
});

test('desktop handouts keep the browser PDF saver', () => {
  const dom = new JSDOM('<div class="tool"><button onclick="print()">Print</button></div>', { runScripts: 'outside-only' });
  let calls = 0; dom.window.print = () => calls++;
  dom.window.eval(script); dom.window.document.querySelector('button').click();
  assert.equal(calls, 1); dom.window.close();
});
