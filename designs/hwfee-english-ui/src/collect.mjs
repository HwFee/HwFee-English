// Gathers the live numbers the design board cites: today's study status, the four vocabulary
// categories, and the current article. Uses the desktop app's stored session.
import { pathToFileURL } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';

const repo = 'C:\\Users\\HwFee\\Desktop\\扇贝阅读助手\\';
const { restoreCookie } = await import(pathToFileURL(repo + 'secure-store.mjs').href);
const { parseCookie } = await import(pathToFileURL(repo + 'lib.mjs').href);

const raw = await restoreCookie(pathToFileURL(repo + 'data\\session.dpapi'));
if (!raw) throw new Error('no stored desktop session');
const cookie = parseCookie(raw);
const csrf = cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];

async function get(path) {
  const res = await fetch('https://apiv3.shanbay.com' + path, {
    headers: {
      Accept: 'application/json',
      Cookie: cookie,
      Origin: 'https://web.shanbay.com',
      Referer: 'https://web.shanbay.com/',
      'User-Agent': 'Mozilla/5.0',
      ...(csrf ? { 'X-CSRFToken': csrf } : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const outDir = 'C:\\Users\\HwFee\\Desktop\\HwFee-English\\designs\\hwfee-english-ui\\src';

// --- today's study status
// Shanbay answers 412 until the day's session is opened ("今日学习数据尚未就绪"), so a fresh
// morning has no status yet: fall back to the last recorded day from the desktop app.
const book = await get('/wordsapp/user_material_books/current');
const bookId = book.materialbook_id || book.materialbook?.id;
let status = null;
let statusSource = 'live';
try {
  status = await get(`/wordsapp/user_material_books/${bookId}/learning/statuses`);
} catch (error) {
  statusSource = 'last recorded';
  const desktop = JSON.parse(await readFile('C:\\Users\\HwFee\\Desktop\\扇贝阅读助手\\data\\today.json', 'utf8'));
  status = { ...desktop.status, date: desktop.date };
}
const today = [{
  date: status.date ?? '',
  book: book.materialbook?.name ?? '当前词书',
  new_done: status.a_finished_count ?? 0,
  new_total: status.a_count ?? 0,
  review_done: status.c_finished_count ?? 0,
  review_total: status.c_count ?? 0,
  finished: status.is_finished === true ? '完成' : '进行中',
}];
console.error('status source:', statusSource);

// --- vocabulary per category
const labelled = { today: '今日学习', wordbook: '生词本', learned: '已掌握', unlearned: '未掌握' };
const vocab = [];
for (const [key, label] of Object.entries(labelled)) {
  const page = await get(`/bay-translate/user_vocabs?categories=${key}&page=1&ipp=1`);
  vocab.push({ category: key, label, words: page.total ?? 0 });
}

// --- the current article
let article = [];
try {
  const matched = await get('/abc/applets/cross_learning/article');
  const id = matched?.id || matched?.article?.id;
  if (id) {
    const data = await get(`/news/articles/${id}?source=1`);
    const paragraphs = [...String(data.content || '').matchAll(/<para\b[^>]*>([\s\S]*?)<\/para>/g)]
      .map((m) => [...m[1].matchAll(/<sent\b[^>]*>([\s\S]*?)<\/sent>/g)]
        .map((s) => {
          const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s[1]);
          return (cdata ? cdata[1] : s[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        })
        .join(' ')
        .trim())
      .filter(Boolean);
    const text = paragraphs.join(' ');
    const words = text.match(/[A-Za-z]+(?:[-’'][A-Za-z]+)*/g)?.length ?? 0;
    article = [{
      title: String(data.title_en || '').trim(),
      title_cn: String(data.title_cn || '').trim(),
      words,
      paragraphs: paragraphs.length,
      minutes: Math.ceil(words / 60),
      source: data.source?.name_cn || '扇贝阅读',
      excerpt: paragraphs.slice(1, 2).join(' ').slice(0, 220),
    }];
  }
} catch (error) {
  console.error('article failed:', error.message);
}

await writeFile(`${outDir}\\today.json`, JSON.stringify(today, null, 1), 'utf8');
await writeFile(`${outDir}\\vocab.json`, JSON.stringify(vocab, null, 1), 'utf8');
await writeFile(`${outDir}\\article.json`, JSON.stringify(article, null, 1), 'utf8');
console.log(JSON.stringify({ today: today[0], vocab, article: article[0]?.title ?? null }, null, 1));
