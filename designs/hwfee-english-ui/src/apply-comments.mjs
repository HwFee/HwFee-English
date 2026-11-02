// One-off: applies the four review comments to index.src.html.
import { readFile, writeFile } from 'node:fs/promises';

const file = 'C:\\Users\\HwFee\\Desktop\\HwFee-English\\designs\\hwfee-english-ui\\src\\index.src.html';
let html = await readFile(file, 'utf8');
const before = html.length;
const applied = [];

const replace = (label, from, to) => {
  if (!html.includes(from)) { console.error('MISS:', label); return; }
  html = html.replace(from, to);
  applied.push(label);
};

// 1. word button: a clear outlined remove action, not a greyed one
replace('word-remove-state',
  '.hw .pop .pb.done { background: var(--track); color: var(--ink); }',
  `.hw .pop .pb.done { background: transparent; color: var(--ink); border: 1px solid var(--ink3); }

  /* bottom tab switch */
  .hw .tabbar { flex: none; display: flex; gap: 4px; margin: 8px -14px 0; padding: 6px 14px 14px;
                border-top: 1px solid var(--line); background: var(--bg); }
  .hw .tb { flex: 1; text-align: center; font-size: 9px; font-weight: 500; color: var(--ink2); padding: 3px 0; }
  .hw .tb.on { color: var(--acc); font-weight: 600; }

  /* article cover + recent cards, mirroring the lesson cards */
  .hw .hero-top { display: flex; gap: 8px; align-items: flex-start; }
  .hw .coverimg { width: 46px; height: 46px; border-radius: 10px; object-fit: cover; flex: none; }
  .hw .rlist { display: flex; flex-direction: column; gap: 6px; }
  .hw .rcard { display: flex; gap: 8px; align-items: center; background: var(--surface); border-radius: 12px;
               padding: 7px 8px; box-shadow: 0 0 0 .5px rgba(0,0,0,.05); }
  .hw .rth { width: 28px; height: 28px; border-radius: 7px; flex: none;
             background: linear-gradient(150deg,#cfd8e3,#7f97af); }
  .hw .rt2 { flex: 1; font-size: 9.5px; line-height: 1.25; color: var(--ink); min-width: 0;
             display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .hw .rd2 { font-size: 7.5px; color: var(--ink3); flex: none; font-variant-numeric: tabular-nums; }
  .hw .rs2 { font-size: 7.5px; font-weight: 600; color: var(--acc); flex: none; }`);

// 2. hero gets a real cover, like the lesson cards
replace('hero-cover',
  `            <div class="hero tall">
              <div class="hl">今天的一篇 · <span data-source="today" data-field="book" data-row="0">—</span></div>
              <div class="ht" id="hw-art-title" style="font-size:11.5px">—</div>
              <div class="hp" id="hw-art-cn">—</div>`,
  `            <div class="hero tall">
              <div class="hero-top">
                <img class="coverimg" src="{{COVER}}" alt="今天这篇的封面">
                <div>
                  <div class="hl">今天的一篇 · <span data-source="today" data-field="book" data-row="0">—</span></div>
                  <div class="ht" id="hw-art-title" style="font-size:11.5px">—</div>
                </div>
              </div>
              <div class="hp" id="hw-art-cn">—</div>`);

// 3. recent list as podcast-style cards
replace('recent-cards',
  `      for (const row of rows.slice(0, 4)) {
        const line = document.createElement('div');
        line.className = 'rrow';
        const date = document.createElement('span');
        date.className = 'rd';
        date.textContent = String(row.date).slice(5).replace('-', '/');
        const title = document.createElement('span');
        title.className = 'rt';
        title.textContent = row.title;
        line.append(date, title);
        if (row.state === '今天') {
          const state = document.createElement('span');
          state.className = 'rs';
          state.textContent = '今天';
          line.append(state);
        }
        host.append(line);
      }`,
  `      for (const row of rows.slice(0, 3)) {
        const card = document.createElement('div');
        card.className = 'rcard';
        const thumb = document.createElement('div');
        thumb.className = 'rth';
        const title = document.createElement('span');
        title.className = 'rt2';
        title.textContent = row.title;
        card.append(thumb, title);
        if (row.state === '今天') {
          const state = document.createElement('span');
          state.className = 'rs2';
          state.textContent = '今天';
          card.append(state);
        } else {
          const date = document.createElement('span');
          date.className = 'rd2';
          date.textContent = String(row.date).slice(5).replace('-', '/');
          card.append(date);
        }
        host.append(card);
      }`);

// 4. three-tab switch on every artboard
const tab = (active) => `          <div class="tabbar">` +
  ['精听', '阅读', '设置'].map((name) => `<span class="tb${name === active ? ' on' : ''}">${name}</span>`).join('') +
  `</div>\n`;

const notes = [
  ['精听', '这个 tab 现在就能用：课程库、播放页都是 cherina-pod 自己生成的，这次一行不改。'],
  ['阅读', '顶上那个 ↻ 是刷新：抓今天的短文，顺带刷新词表数字。列表是已抓回来过的篇目，今天那行标「今天」，点一行就打开旧文。'],
  ['阅读', '两个手势都是贴着文字的浮层：长按句子=整句翻译，点单词=释义加生词本按钮。浮层都避开被点的那一句或那个词，同一个时刻只开一个。'],
  ['设置', '省掉列表，其余照骨架：卡片十六圆角、白底、0.5px 描边。'],
];
for (const [active, text] of notes) {
  replace(`tabbar-${active}-${text.slice(0, 6)}`,
    `        <p class="note">${text}</p>`,
    tab(active) + `        <p class="note">${text}</p>`);
}

await writeFile(file, html, 'utf8');
console.log(JSON.stringify({ applied, bytesBefore: before, bytesAfter: html.length }, null, 1));
