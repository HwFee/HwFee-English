// Shell: the two tabs, lesson import, and the settings screen.
import { parseCookie } from './read/lib.mjs';

const TAB_KEY = 'hwfee:lastTab';
const state = { tab: 'listen' };
const $ = (id) => document.getElementById(id);

const importBtn = $('importBtn');
const listenFrame = $('listenFrame');
const readFrame = $('readFrame');
const toastEl = $('toast');

let toastTimer = 0;

function toast(message, ms = 2600) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function plugins() {
  return window.Capacitor?.Plugins ?? null;
}

// ----------------------------------------------------------------------- tabs

function showTab(name) {
  if (!document.querySelector(`.pane[data-pane="${name}"]`)) return;
  state.tab = name;
  for (const pane of document.querySelectorAll('.pane')) {
    pane.classList.toggle('is-active', pane.dataset.pane === name);
  }
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', String(on));
  }
  importBtn.hidden = name !== 'listen';
  try { localStorage.setItem(TAB_KEY, name); } catch {}
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}

// --------------------------------------------------------------------- import

function reloadLibrary() {
  try {
    listenFrame.contentWindow.location.replace('./listen/library.html?t=' + Date.now());
  } catch {
    listenFrame.src = './listen/library.html?t=' + Date.now();
  }
}

function reloadRead() {
  try {
    readFrame.contentWindow.location.replace('./read/index.html?t=' + Date.now());
  } catch {
    readFrame.src = './read/index.html?t=' + Date.now();
  }
}

async function importLessons() {
  const api = plugins()?.Lessons;
  if (!api) { toast('导入只在 Android app 里可用'); return; }
  importBtn.classList.add('is-busy');
  importBtn.disabled = true;
  toast('正在导入，课程多的时候要等一会儿…', 60000);
  try {
    const result = await api.importZip();
    const imported = result?.imported?.length ?? 0;
    const failed = result?.failed ?? [];
    if (imported === 0 && failed.length) toast('没有导入成功：' + failed[0], 6000);
    else if (failed.length) toast(`导入 ${imported} 节，${failed.length} 节失败`, 5000);
    else toast(`导入 ${imported} 节`);
    reloadLibrary();
    if (!$('settings').hidden) refreshLessonState();
  } catch (error) {
    const message = String(error?.message ?? error);
    toast(message.includes('cancel') || message.includes('取消') ? '已取消' : '导入失败：' + message, 5000);
  } finally {
    importBtn.classList.remove('is-busy');
    importBtn.disabled = false;
  }
}

importBtn.addEventListener('click', importLessons);

/** A zip shared into the app from elsewhere lands here, at boot or while running. */
async function consumeShared() {
  const api = plugins()?.Lessons;
  if (!api) return;
  try {
    const result = await api.consumeShared();
    window.hwfeeLastImport = result;
    const imported = result?.imported?.length ?? 0;
    if (!imported) return;
    toast(`导入 ${imported} 节`);
    reloadLibrary();
    if (!$('settings').hidden) refreshLessonState();
  } catch (error) {
    toast('导入失败：' + error.message, 5000);
  }
}

window.addEventListener('hwfee:shared', consumeShared);
setTimeout(consumeShared, 1200);

// ------------------------------------------------------------------- settings

async function refreshShanbayState() {
  const el = $('shanbayState');
  const api = plugins()?.Shanbay;
  if (!api) { el.textContent = '仅 app 内可用'; el.className = 'state is-off'; return; }
  try {
    const { has } = await api.hasCookie();
    el.textContent = has ? '已连接扇贝' : '未连接 · 词表和短文都取不到';
    el.className = 'state ' + (has ? 'is-ok' : 'is-off');
    $('shanbayClear').disabled = !has;
  } catch (error) {
    el.textContent = '状态读取失败：' + error.message;
    el.className = 'state is-off';
  }
}

async function refreshLlmState() {
  const el = $('llmState');
  const api = plugins()?.Llm;
  if (!api) { el.textContent = '仅 app 内可用'; el.className = 'state is-off'; return; }
  try {
    const config = await api.getConfig();
    el.textContent = config.has
      ? `已配置 · ${config.model}`
      : '未配置 · 长按句子翻译需要它';
    el.className = 'state ' + (config.has ? 'is-ok' : 'is-off');
    $('llmBase').value = config.baseUrl || '';
    $('llmModel').value = config.model || '';
  } catch (error) {
    el.textContent = '状态读取失败：' + error.message;
    el.className = 'state is-off';
  }
}

async function refreshLessonState() {
  const el = $('lessonState');
  const api = plugins()?.Lessons;
  if (!api) { el.textContent = '—'; return; }
  try {
    const result = await api.list();
    const data = JSON.parse(result.data);
    const segments = data.lessons.reduce((sum, lesson) => sum + (lesson.segments || 0), 0);
    el.textContent = `${data.lessons.length} 节课 · 共 ${segments} 段`;
    el.className = 'state is-ok';
  } catch {
    el.textContent = '读取失败';
    el.className = 'state is-off';
  }
}

function refreshSettings() {
  refreshShanbayState();
  refreshLlmState();
  refreshLessonState();
}

function openSettings() {
  $('settings').hidden = false;
  refreshSettings();
}

function closeSettings() {
  $('settings').hidden = true;
}

$('settingsBtn').addEventListener('click', openSettings);
$('settingsClose').addEventListener('click', closeSettings);

$('shanbayLogin').addEventListener('click', async () => {
  const api = plugins()?.Shanbay;
  if (!api) { toast('仅 app 内可用'); return; }
  try {
    const result = await api.login();
    if (result?.connected) {
      toast('已连接扇贝');
      reloadRead();
    } else {
      toast('没有拿到登录态，可以再试或改用粘贴 Cookie', 5000);
    }
    refreshSettings();
  } catch (error) {
    toast('登录失败：' + error.message, 5000);
  }
});

$('shanbayPaste').addEventListener('click', () => {
  const box = $('pasteBox');
  box.hidden = !box.hidden;
  if (!box.hidden) $('cookieInput').focus();
});

$('cookieSave').addEventListener('click', async () => {
  const api = plugins()?.Shanbay;
  if (!api) { toast('仅 app 内可用'); return; }
  let cookie;
  try {
    cookie = parseCookie($('cookieInput').value);
  } catch (error) {
    toast(error.message, 5000);
    return;
  }
  try {
    await api.setCookie({ cookie });
    $('cookieInput').value = '';
    $('pasteBox').hidden = true;
    toast('已保存登录态');
    reloadRead();
    refreshSettings();
  } catch (error) {
    toast('保存失败：' + error.message, 5000);
  }
});

$('shanbayClear').addEventListener('click', async () => {
  const api = plugins()?.Shanbay;
  if (!api) return;
  await api.clearCookie();
  toast('已断开扇贝');
  reloadRead();
  refreshSettings();
});

$('llmSave').addEventListener('click', async () => {
  const api = plugins()?.Llm;
  if (!api) { toast('仅 app 内可用'); return; }
  const key = $('llmKey').value.trim();
  const baseUrl = $('llmBase').value.trim();
  const model = $('llmModel').value.trim();
  try {
    await api.setConfig({ key: key || undefined, baseUrl: baseUrl || undefined, model: model || undefined });
    $('llmKey').value = '';
    toast(key ? '已保存翻译密钥' : '已保存接口设置');
    refreshLlmState();
  } catch (error) {
    toast('保存失败：' + error.message, 5000);
  }
});

$('llmClear').addEventListener('click', async () => {
  const api = plugins()?.Llm;
  if (!api) return;
  await api.clearConfig();
  toast('已清除翻译密钥');
  refreshLlmState();
});

// ----------------------------------------------------------------------- boot

showTab(localStorage.getItem(TAB_KEY) || 'listen');
console.log('[shell] ready', location.origin);
