// Shell: the three tabs, lesson import, and the settings pane.
import { getUsage, getDeepSeekBalance, getShanbayQuota } from './read/llm.mjs';
import { hydrateIcons, setIcon, icon } from './icons/icons.mjs';

hydrateIcons();

const TAB_KEY = 'hwfee:lastTab';
const state = { tab: 'listen' };
const $ = (id) => document.getElementById(id);

const app = $('app');
const importBtn = $('importBtn');
const listenFrame = $('listenFrame');
const playerFrame = $('playerFrame');
const readFrame = $('readFrame');
const toastEl = $('toast');

let toastTimer = 0;
let toastInProgress = false;
let deferredToast = null;

const TOAST_ICONS = { success: 'check-bold', error: 'exclamation-mark-bold', info: 'info-bold' };

/** The prompt island: one message at a time, dropping in from the top like the Dynamic Island. */
function toast(message, options = {}) {
  const { kind = 'info', detail = '', ms = kind === 'progress' ? 60000 : kind === 'error' ? 5000 : 2600 } =
    typeof options === 'number' ? { ms: options } : options;
  if (options.background && toastInProgress) { deferredToast = { message, options }; return; }
  toastInProgress = kind === 'progress';
  const mark = document.createElement('span');
  mark.className = 'toast-mark';
  if (kind === 'progress') mark.append(document.createElement('i'));
  else mark.append(icon(TOAST_ICONS[kind] || 'info-bold', kind === 'info' ? 20 : 13));
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.append(Object.assign(document.createElement('b'), { textContent: message }));
  if (detail) text.append(Object.assign(document.createElement('small'), { textContent: detail }));
  toastEl.className = 'toast is-' + kind;
  toastEl.replaceChildren(mark, text);
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('is-on'));
  clearTimeout(toastTimer);
  if (kind === 'progress') return;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-on');
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
      const pending = deferredToast;
      deferredToast = null;
      if (pending) toast(pending.message, pending.options);
    }, 220);
  }, ms);
}

window.hwfeeToast = toast;

function plugins() {
  return window.Capacitor?.Plugins ?? null;
}

// The native liquid-glass bar replaces the web island when the plugin exists.
const tabBarApi = plugins()?.TabBar ?? null;
let nativeChromeFailed = false;
function useNativeChrome(enabled) {
  document.documentElement.classList.toggle('hwfee-native-chrome', enabled);
  const tabs = document.querySelector('.tabs');
  tabs.hidden = enabled;
  tabs.style.display = enabled ? 'none' : '';
  propagateReserve();
  placeGlider();
}

function fallbackChrome() {
  nativeChromeFailed = true;
  useNativeChrome(false);
  // A bridge that applied a state but lost its reply must not leave duplicate bars.
  tabBarApi?.setState({ hidden: true }).catch(() => {});
}

if (tabBarApi) {
  tabBarApi.getMetrics().then((m) => {
    if (!m?.available || nativeChromeFailed) return;
    useNativeChrome(true);
    const root = document.documentElement.style;
    if (Number.isFinite(m?.reserve)) root.setProperty('--island-reserve', m.reserve + 'px');
    // The WebView is only inset below the status bar, so pages that anchor to the
    // bottom (the lesson player's dock) need the gesture bar's height explicitly.
    if (Number.isFinite(m?.navInset)) root.setProperty('--hwfee-nav-inset', m.navInset + 'px');
    propagateReserve();
  }).catch(fallbackChrome);
  tabBarApi.addListener('tabSelected', ({ tab }) => showTab(tab));
  tabBarApi.addListener('actionPressed', ({ action }) => {
    if (action === 'import' && state.tab === 'listen') importLessons();
    if (action === 'refresh' && state.tab === 'read') readFrame.contentWindow?.hwfeeRefreshRead?.();
  });
}

// CSS vars do not cross document boundaries — mirror the bar metrics onto each
// iframe root so their padding rules see the native bar's footprint.
const PROXIED_VARS = ['--island-reserve', '--hwfee-nav-inset'];

function propagateReserve() {
  const root = document.documentElement.style;
  for (const frame of [listenFrame, playerFrame, readFrame]) {
    try {
      const target = frame.contentDocument?.documentElement?.style;
      if (!target) continue;
      frame.contentDocument.documentElement.classList.toggle('hwfee-native-chrome',
        document.documentElement.classList.contains('hwfee-native-chrome'));
      for (const name of PROXIED_VARS) {
        const value = root.getPropertyValue(name);
        if (value) target.setProperty(name, value);
      }
    } catch {}
  }
}

async function pushTabBarState() {
  // The island collapses inside a lesson player, exactly like the import button: the
  // player owns the bottom of the screen. Going back brings both of them back.
  if (!tabBarApi || nativeChromeFailed) return;
  let timer;
  try {
    await Promise.race([
      tabBarApi.setState({ tab: state.tab, hidden: app.classList.contains('is-immersive') }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Chrome did not settle')), 2000); }),
    ]);
  } catch { fallbackChrome(); }
  finally { clearTimeout(timer); }
}

// ----------------------------------------------------------------------- tabs

const glider = document.querySelector('.glider');

/** The glass pill sits under whichever tab is selected. */
function placeGlider() {
  const active = document.querySelector('.tab.is-active');
  if (!glider || !active) return;
  glider.style.width = active.offsetWidth + 'px';
  // .tabs has 5px of padding, which is also the glider's left offset.
  glider.style.transform = `translateX(${active.offsetLeft - 5}px)`;
}

function showTab(name) {
  const known = document.querySelector(`.pane[data-pane="${name}"]`);
  if (!known) return;

  // The native tab bar is outside the reader iframe, so its taps do not reach
  // the card's document-level outside-tap handler.
  if (state.tab === 'read') {
    try { readFrame.contentWindow?.hwfeeDismissPopover?.(); } catch {}
  }

  state.tab = name;

  for (const pane of document.querySelectorAll('.pane')) {
    pane.classList.toggle('is-active', pane.dataset.pane === name);
  }
  for (const tab of document.querySelectorAll('.tab')) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    const glyph = tab.querySelector('svg[data-base]');
    if (glyph) setIcon(glyph, glyph.dataset.base + (on ? '-fill' : ''));
    tab.setAttribute('aria-selected', String(on));
  }
  importBtn.hidden = name !== 'listen';
  if (name === 'settings') refreshSettings();
  if (name === 'read') void readFrame.contentWindow?.hwfeePrepareDaily?.();

  placeGlider();
  updateImmersive();
  decorateLibrary();
  try { localStorage.setItem(TAB_KEY, name); } catch {}
}

// The read iframe uses this to navigate between tabs.
window.hwfeeShowTab = showTab;

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}

window.addEventListener('resize', placeGlider);
if (document.fonts?.ready) document.fonts.ready.then(placeGlider);

// --------------------------------------------------------------------- import

function reloadLibrary() {
  try {
    listenFrame.contentWindow.location.replace('/listen/library.html?t=' + Date.now());
  } catch {
    listenFrame.src = '/listen/library.html?t=' + Date.now();
  }
}

function reloadRead() {
  try {
    readFrame.contentWindow.location.replace('/read/index.html?t=' + Date.now());
  } catch {
    readFrame.src = '/read/index.html?t=' + Date.now();
  }
}

function clearVocabCache() {
  try { localStorage.removeItem('hwfee:vocab'); } catch {}
}

async function importLessons() {
  const api = plugins()?.Lessons;
  if (!api) { toast('导入只在 Android app 里可用'); return; }
  if (importBtn.disabled) return;
  importBtn.classList.add('is-busy');
  importBtn.disabled = true;
  tabBarApi?.setState({ importBusy: true }).catch(() => {});
  toast('正在导入课程', { kind: 'progress', detail: '课程多的时候要等一会儿' });
  try {
    const result = await api.importZip();
    const imported = result?.imported?.length ?? 0;
    const failed = result?.failed ?? [];
    if (imported === 0 && failed.length) toast('没有导入成功', { kind: 'error', detail: failed[0], ms: 6000 });
    else if (failed.length) toast(`导入 ${imported} 节，${failed.length} 节失败`, { kind: 'error' });
    else toast(`已导入 ${imported} 节课`, { kind: 'success' });
    reloadLibrary();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message.includes('cancel') || message.includes('取消')) toast('已取消导入');
    else toast('导入失败', { kind: 'error', detail: message });
  } finally {
    importBtn.classList.remove('is-busy');
    importBtn.disabled = false;
    tabBarApi?.setState({ importBusy: false }).catch(() => {});
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
    toast(`已导入 ${imported} 节课`, { kind: 'success' });
    reloadLibrary();
  } catch (error) {
    toast('导入失败', { kind: 'error', detail: error.message });
  }
}

window.addEventListener('hwfee:shared', consumeShared);
setTimeout(consumeShared, 1200);

// ------------------------------------------------------- listen frame fixes

// The player has its own frame and is never unloaded by going back. "Back" only hides
// it, so a lesson keeps playing while the library is browsed; its card's round button
// turns into a pause glyph, and reopening the card returns to the same player document.
let nowPlaying = null; // { dir, title }

const PLAY_GLYPH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">'
  + '<path d="M8.2 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.1-6.4a1.2 1.2 0 0 0 0-2.04l-10.1-6.4A1.2 1.2 0 0 0 8.2 5.6z"/></svg>';
const PAUSE_GLYPH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">'
  + '<rect x="6" y="4.8" width="4.3" height="14.4" rx="1.5"/><rect x="13.7" y="4.8" width="4.3" height="14.4" rx="1.5"/></svg>';

function lessonDir(href) {
  try {
    const path = new URL(href, location.origin + '/listen/library.html').pathname;
    return /^\/lessons\/([^/]+)\//.exec(path)?.[1] || '';
  } catch { return ''; }
}

function playerPlaying() {
  try {
    const audio = playerFrame.contentDocument?.querySelector('audio');
    return Boolean(audio) && !audio.paused;
  } catch { return false; }
}

function togglePlayer() {
  if (playerFrame.dataset.savedClip === '1') { openLesson(playerFrame.dataset.src); return; }
  try {
    const audio = playerFrame.contentDocument?.querySelector('audio');
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  } catch {}
  setTimeout(decorateLibrary, 150);
}

/** The playing lesson's round button becomes pause; the card itself stays a way back in. */
function decorateLibrary() {
  const doc = listenFrame.contentDocument;
  if (!doc) return;
  try { listenFrame.contentWindow?.hwfeeUpdateLibrary?.(nowPlaying ? {
    ...nowPlaying, playing: playerPlaying(),
  } : null); } catch {}
  if (!nowPlaying) return;
  const playing = playerPlaying();
  for (const link of doc.querySelectorAll('a[href*="player.html"]')) {
    const active = lessonDir(link.getAttribute('href')) === nowPlaying.dir;
    link.classList.toggle('is-playing', active);
    const circle = link.querySelector('.go');
    if (circle) {
      const glyphState = active && playing ? 'pause' : 'play';
      if (circle.dataset.hwfeeGlyph !== glyphState) {
        circle.innerHTML = glyphState === 'pause' ? PAUSE_GLYPH : PLAY_GLYPH;
        circle.dataset.hwfeeGlyph = glyphState;
      }
    }
  }
}

async function showPlayer() {
  showPlayerWhenLoaded = true;
  const revision = ++playerNavigation;
  await updateImmersive();
  if (!showPlayerWhenLoaded || revision !== playerNavigation || state.tab !== 'listen') return;
  showPlayerWhenLoaded = false;
  playerFrame.hidden = false;
  listenFrame.hidden = true;
  updateImmersive();
}

let showPlayerWhenLoaded = false;
let playerReloads = 0;
let playerNavigation = 0;
let listenNavigating = false;
let readerPageOpen = false;
let playerReady = false;
let playerReadyTimer = 0;

function waitForPlayer() {
  clearTimeout(playerReadyTimer);
  playerReadyTimer = setTimeout(() => {
    if (!showPlayerWhenLoaded || playerReady) return;
    closePlayer();
    nowPlaying = null;
    toast('课程没有打开，请重试', { kind: 'error' });
  }, 8000);
}

function openLesson(href) {
  if (!href) return;
  if (playerFrame.dataset.savedClip === '1') {
    const revision = ++playerNavigation;
    let stopping;
    try { stopping = listenFrame.contentWindow?.__hwfeeSaved?.pause(); } catch {}
    Promise.resolve(stopping).then(() => {
      if (revision !== playerNavigation || state.tab !== 'listen') return;
      delete playerFrame.dataset.savedClip;
      nowPlaying = null;
      openLesson(href);
    });
    return;
  }
  let url;
  try { url = new URL(href, location.origin + '/listen/library.html'); } catch { return; }
  const dir = lessonDir(href);
  try { listenFrame.contentWindow?.__hwfeeSaved?.pause(); } catch {}
  // Same lesson: keep the document and its audio, just bring it back to the front.
  if (nowPlaying && dir && dir === nowPlaying.dir && playerFrame.dataset.savedClip !== '1') {
    if (playerReady && lessonDir(playerFrame.contentWindow.location.href) === dir
        && playerFrame.contentDocument?.querySelector('audio')) showPlayer();
    else { showPlayerWhenLoaded = true; updateImmersive(); waitForPlayer(); }
    return;
  }
  try { playerFrame.contentWindow?.__hwfeeFlushProgress?.(); } catch {}
  delete playerFrame.dataset.savedClip;
  playerFrame.dataset.src = url.pathname + url.search + url.hash;
  nowPlaying = { dir, title: '' };
  playerReloads = 0;
  playerReady = false;
  // Keep the library on screen until the lesson has painted; an empty frame flashes white.
  showPlayerWhenLoaded = true;
  ++playerNavigation;
  updateImmersive();
  playerFrame.hidden = true;
  listenFrame.hidden = false;
  playerFrame.src = playerFrame.dataset.src;
  waitForPlayer();
}

/**
 * Last resort for a dead media pipeline: a fresh player document re-runs the audio request.
 * The shim asks for this after its in-place retries fail; capped so a lesson whose file is
 * really missing cannot loop.
 */
window.hwfeeReloadPlayer = () => {
  const src = playerFrame.dataset.src;
  if (!src || playerReloads >= 2) return false;
  playerReloads++;
  playerReady = false;
  playerFrame.src = src.split('#')[0];
  return true;
};

/** Hide the player without unloading it. Returns false when no player was open. */
function closePlayer() {
  if (playerFrame.hidden && !showPlayerWhenLoaded) return false;
  showPlayerWhenLoaded = false;
  clearTimeout(playerReadyTimer);
  ++playerNavigation;
  playerFrame.hidden = true;
  listenFrame.hidden = false;
  updateImmersive();
  decorateLibrary();
  try { listenFrame.contentWindow?.hwfeeRefreshSaved?.(); } catch {}
  return true;
}

window.hwfeeClosePlayer = closePlayer;
window.hwfeeSavedChanged = () => { try { listenFrame.contentWindow?.hwfeeRefreshSaved?.(); } catch {} };
window.hwfeeBeforeSavedClip = () => {
  try {
    playerFrame.contentDocument?.querySelector('audio')?.pause();
    playerFrame.contentWindow?.__hwfeeFlushProgress?.();
    playerFrame.dataset.savedClip = '1';
  } catch {}
};

// Library CSS fixes (island clearance, cover stacking) are injected while the
// page is served by LessonServer, so they survive the library's own reloads.
function wireListenFrame() {
  listenNavigating = false;
  propagateReserve();
  updateImmersive();
  try {
    const doc = listenFrame.contentDocument;
    if (doc?.body && doc.body.dataset.hwfeeLessons !== '1') {
      doc.body.dataset.hwfeeLessons = '1';
      // Lesson links would otherwise navigate the library frame itself; the player frame
      // has to own the document so going back leaves the audio alone.
      doc.addEventListener('click', (event) => {
        const link = event.target.closest?.('a[href*="player.html"],a[href*="handout.html"]');
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        if (link.getAttribute('href').includes('handout.html')) {
          listenNavigating = true;
          updateImmersive().then(() => {
            if (listenNavigating) listenFrame.contentWindow.location.href = link.href;
          });
          return;
        }
        const circle = event.target.closest?.('.go');
        const isHere = nowPlaying && lessonDir(link.getAttribute('href')) === nowPlaying.dir;
        // The round button is the transport for the lesson that is open: tap pauses,
        // the card around it is still the way back into the player.
        if (circle && isHere && playerFrame.contentDocument?.querySelector('audio')) {
          togglePlayer();
          return;
        }
        openLesson(link.getAttribute('href'));
      }, true);
    }
  } catch {}
  decorateLibrary();
}

listenFrame.addEventListener('load', wireListenFrame);
window.hwfeeListenReady = (source) => {
  if (source === listenFrame.contentWindow) wireListenFrame();
};
// Images may still be pending: links need their handlers as soon as the DOM is usable.
if (['interactive', 'complete'].includes(listenFrame.contentDocument?.readyState)) wireListenFrame();

window.hwfeePlayerReady = (source) => {
  if (source !== playerFrame.contentWindow || playerReady) return;
  if (!nowPlaying || lessonDir(source.location.href) !== nowPlaying.dir) return;
  if (!playerFrame.contentDocument?.querySelector('audio')) return;
  playerReady = true;
  clearTimeout(playerReadyTimer);
  propagateReserve();
  try {
    const title = playerFrame.contentDocument?.title || '';
    if (nowPlaying && title) nowPlaying.title = title;
  } catch {}
  if (showPlayerWhenLoaded) {
    showPlayer();
  }
  decorateLibrary();
};
playerFrame.addEventListener('load', () => window.hwfeePlayerReady(playerFrame.contentWindow));

readFrame.addEventListener('load', propagateReserve);

// Android back: the native layer calls this before finishing the activity.
// true = handled; false = let the system background the task.
window.hwfeeBack = () => {
  try {
    if (state.tab === 'read' && readFrame.contentWindow?.hwfeeReadBack?.()) return true;
    if (state.tab === 'listen') {
      if (listenNavigating) { listenNavigating = false; updateImmersive(); return true; }
      if (closePlayer()) return true;
      const path = listenFrame.contentWindow?.location?.pathname || '';
      if (path && !/library\.html$/.test(path)) {
        listenFrame.contentWindow.history.back();
        return true;
      }
    }
    if (state.tab !== 'listen') { showTab('listen'); return true; }
  } catch {}
  return false;
};

/** 'player' while a lesson player is on screen, 'page' for a handout or any other lesson page. */
function lessonPageOpen() {
  if (state.tab === 'read') return readerPageOpen ? 'reader' : '';
  if (state.tab !== 'listen') return '';
  if (showPlayerWhenLoaded || !playerFrame.hidden) return 'player';
  if (listenNavigating) return 'page';
  try {
    const path = listenFrame.contentWindow?.location?.pathname || '';
    if (path && !/\/listen\/library\.html$/.test(path)) return 'page';
  } catch {}
  return '';
}

function updateImmersive() {
  const page = lessonPageOpen();
  // A player and a handout both own the bottom of the screen. One class drives both the
  // island and the import button, from one state change, so they cannot drift apart.
  app.classList.toggle('is-immersive', page !== '');
  return pushTabBarState();
}

window.hwfeeReadView = (open) => {
  readerPageOpen = Boolean(open);
  return updateImmersive();
};
window.hwfeeReadBusy = (busy) => tabBarApi?.setState({ refreshBusy: Boolean(busy) }).catch(() => {});
window.hwfeePlayerState = (detail) => {
  if (!nowPlaying || detail.dir !== nowPlaying.dir) return;
  Object.assign(nowPlaying, detail);
  decorateLibrary();
};

// ------------------------------------------------------------------- settings

// Official defaults as of 2026-11-02. A saved key can refresh the current provider's list.
const DEEPSEEK_BASE = 'https://api.deepseek.com';
const DEEPSEEK_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
];
let llmConfig = null;
let modelCache = null;
let modelsLoading = false;
let llmRevision = 0;

function comparableBase(value) {
  const source = String(value || '').trim() || DEEPSEEK_BASE;
  try {
    const url = new URL(source);
    if (url.protocol === 'https:' && url.hostname === 'api.deepseek.com'
        && (!url.port || url.port === '443') && !url.username && !url.password
        && !url.search && !url.hash && ['', '/', '/v1', '/v1/'].includes(url.pathname)) return DEEPSEEK_BASE;
  } catch {}
  return source.replace(/\/+$/, '');
}

function presetsFor(base) {
  try {
    const url = new URL(base);
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com'
      && (!url.port || url.port === '443') ? DEEPSEEK_MODELS : [];
  } catch { return []; }
}

function selectedModel() {
  return $('llmModel').value.trim();
}

function renderModelOptions(models, selected) {
  const list = $('llmModelList');
  list.replaceChildren();
  const found = models.some(model => model.id === selected);
  const nameFor = (id) => id === ''
    ? '手动输入模型 ID'
    : (models.find(model => model.id === id)?.name || id);
  const makeRow = (id, name, sub) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'model-row' + (id ? '' : ' is-manual');
    row.dataset.id = id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    const label = document.createElement('span');
    label.className = 'm-name';
    label.textContent = name;
    row.append(label);
    if (sub) {
      const detail = document.createElement('span');
      detail.className = 'm-id';
      detail.textContent = sub;
      row.append(detail);
    }
    const check = icon('check', 15);
    check.classList.add('m-check');
    row.append(check);
    row.onclick = () => pick(id, { focus: true });
    return row;
  };
  for (const model of models) {
    list.append(makeRow(model.id, model.name,
      model.name === model.id ? '' : model.id));
  }
  list.append(makeRow('', '手动输入模型 ID'));

  function pick(id, { focus = false } = {}) {
    for (const row of list.children) {
      row.setAttribute('aria-selected', String(row.dataset.id === id));
    }
    $('llmModel').value = id;
    $('llmModelCurrent').textContent = nameFor(id);
    $('llmManualField').hidden = Boolean(id);
    if (focus && !id) $('llmModel').focus();
  }
  pick(found ? selected : '');
  $('llmModel').value = selected || '';
  if (!found) $('llmModelCurrent').textContent = selected || '未选择';
  $('llmManualField').hidden = found;
}

$('llmModelHead').addEventListener('click', () => {
  const list = $('llmModelList');
  list.hidden = !list.hidden;
  $('llmModelHead').setAttribute('aria-expanded', String(!list.hidden));
  $('llmModelHead').classList.toggle('is-open', !list.hidden);
});
$('llmModelHead').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  $('llmModelHead').click();
});
$('llmModelRefresh').addEventListener('click', refreshModelList);

async function refreshModelList() {
  const hint = $('llmModelsHint');
  const api = plugins()?.Llm;
  if (!api) { hint.textContent = '模型列表仅在 app 内可用'; return; }
  if (!llmConfig?.has) { hint.textContent = '请先保存 API Key，再更新模型列表'; return; }
  if ($('llmKey').value.trim() || comparableBase($('llmBase').value) !== comparableBase(llmConfig.baseUrl)) {
    hint.textContent = '请先保存修改的密钥和接口地址';
    return;
  }
  if (modelsLoading) return;
  const requestedBase = llmConfig.baseUrl;
  const requestedRevision = llmRevision;
  modelsLoading = true;
  $('llmModelRefresh').disabled = true;
  hint.textContent = '正在获取模型列表…';
  try {
    const result = await api.listModels();
    if (!llmConfig || llmConfig.baseUrl !== requestedBase || requestedRevision !== llmRevision) return;
    if ($('llmKey').value.trim() || comparableBase($('llmBase').value) !== comparableBase(requestedBase)) {
      hint.textContent = '请先保存修改的密钥和接口地址';
      return;
    }
    const models = Array.isArray(result?.models) ? result.models.filter(model =>
      model && typeof model.id === 'string' && model.id.trim() && typeof model.name === 'string') : [];
    modelCache = { base: requestedBase, models };
    renderModelOptions(models, selectedModel());
    hint.textContent = models.length ? '' : '接口没有返回模型，可以手动输入模型 ID';
  } catch (error) {
    if (llmConfig?.baseUrl === requestedBase) hint.textContent = '获取模型失败：' + error.message;
  } finally {
    modelsLoading = false;
    $('llmModelRefresh').disabled = false;
    if (requestedRevision !== llmRevision && llmConfig?.has) void refreshModelList();
  }
}



async function refreshShanbayState() {
  const el = $('shanbayState');
  const api = plugins()?.Shanbay;
  if (!api) { el.textContent = '仅 app 内可用'; el.className = 'state'; return; }
  try {
    const { has } = await api.hasCookie();
    el.textContent = has ? '已连接' : '未连接';
    el.className = 'state ' + (has ? 'is-ok' : '');
    $('shanbayClear').disabled = !has;
    $('shanbayClear').hidden = !has;
  } catch (error) {
    el.textContent = '状态读取失败：' + error.message;
    el.className = 'state';
  }
}

async function refreshLlmState() {
  const el = $('llmState');
  const api = plugins()?.Llm;
  if (!api) { el.textContent = '仅 app 内可用'; el.className = 'state'; return; }
  try {
    const config = await api.getConfig();
    llmConfig = config;
    $('autoTranslate').checked = Boolean(config.autoTranslate);
    $('autoTranslate').disabled = typeof api.setPreferences !== 'function';
    el.textContent = config.hasShanbay ? '扇贝优先' : config.has ? '个人 API' : '未配置';
    el.className = 'state ' + ((config.canTranslate ?? config.has) ? 'is-ok' : '');
    const selected = (modelCache?.base === config.baseUrl ? modelCache.models : presetsFor(config.baseUrl))?.find(m => m.id === config.model);
    $('apiModelName').textContent = config.has ? (selected?.name || config.model || '已配置') : '未配置';
    $('llmClear').hidden = !config.has;
    $('llmBase').value = config.baseUrl || '';
    const cached = modelCache?.base === config.baseUrl ? modelCache.models : null;
    renderModelOptions(cached ?? presetsFor(config.baseUrl), config.model || '');
    $('llmModelsHint').textContent = config.has && !cached ? '正在获取模型列表…' : '';
    if (config.has && !cached) void refreshModelList();
  } catch (error) {
    el.textContent = '状态读取失败：' + error.message;
    el.className = 'state';
  }
}

function refreshSettings() {
  refreshShanbayState();
  refreshLlmState();
  void refreshUsage();
}

// ------------------------------------------------------------------- usage card

// Keep the last good snapshots: a failed re-read must not blank the card.
let usageSnapshot = null;
let balanceSnapshot = null;
let usageLoading = false;
let usageRevision = 0, usageQueued = false, usageForceQueued = false;

function invalidateUsage() {
  usageRevision++;
  usageSnapshot = null; balanceSnapshot = null;
  renderUsage();
}

const CURRENCY_MARK = { CNY: '¥', USD: '$' };
const moneyText = (info) =>
  `${CURRENCY_MARK[info.currency] ?? info.currency + ' '}${info.totalBalance}`;
const compactNum = (n) => n == null ? '—'
  : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

function fmtTime(ms) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ms));
  } catch { return ''; }
}

function balanceErrorText(error) {
  const byCode = {
    NO_API_KEY: '保存 API Key 后可查询余额',
    UNSUPPORTED_PROVIDER: '仅 DeepSeek 官方端点支持余额查询',
    NO_BRIDGE: '余额查询需要新版 App',
    CONFIG_CHANGED: '配置已变更，请重新读取',
  };
  return byCode[error?.code] ?? '查询失败：' + (error?.message ?? error);
}

function renderUsage({ usageError = null, balanceError = null, quotaError = null } = {}) {
  const u = usageSnapshot;
  const sb = u?.shanbay;
  const quota = sb?.remainingPercent;
  $('usageQuotaFill').style.width = (quota ?? 0) + '%';
  $('usageQuotaFill').parentElement.setAttribute('aria-valuenow', String(quota ?? 0));
  if (!u) {
    $('usageQuotaVal').textContent = '—';
    $('usageQuotaSub').textContent = usageError ? '读取失败：' + usageError.message : '读取中…';
  } else if (!sb?.connected) {
    $('usageQuotaVal').textContent = '未连接';
    $('usageQuotaSub').textContent = '连接扇贝后开始记录额度';
  } else if (quota == null) {
    $('usageQuotaVal').textContent = '未获取';
    $('usageQuotaSub').textContent = '点击重新读取查询额度';
  } else {
    $('usageQuotaVal').textContent = `剩余 ${quota}%`;
    $('usageQuotaSub').textContent = '账号共享额度';
  }
  if (quotaError) $('usageQuotaSub').textContent = '查询失败：' + quotaError.message
    + (quota == null ? '' : ' · 已保留旧值');

  const b = balanceSnapshot;
  const infos = Array.isArray(b?.balanceInfos) ? b.balanceInfos : [];
  if (!b || balanceError) {
    if (!b) {
      $('usageBalanceVal').textContent = '—';
      $('usageBalanceComp').textContent = balanceError ? balanceErrorText(balanceError) : '读取中…';
    } else {
      // Keep the stale amount; just annotate it.
      $('usageBalanceComp').textContent = balanceErrorText(balanceError)
        + ` · 上方为 ${fmtTime(b.observedAt)} 的旧值`;
    }
  } else {
    $('usageBalanceVal').textContent = infos.length ? infos.map(moneyText).join(' · ') : '—';
    const bi = infos[0];
    const parts = [];
    if (bi) {
      const mark = CURRENCY_MARK[bi.currency] ?? bi.currency + ' ';
      if (bi.toppedUpBalance != null) parts.push(`充值 ${mark}${bi.toppedUpBalance}`);
      if (bi.grantedBalance != null) parts.push(`赠送 ${mark}${bi.grantedBalance}`);
    }
    if (!b.isAvailable) parts.push('余额不可用');
    if (b.cached) parts.push('缓存');
    $('usageBalanceComp').textContent = parts.join(' · ');
  }

  for (const [name, value] of [['usageQuotaTime', sb?.usageAt], ['usageBalanceTime', b?.observedAt]]) {
    const time = $(name);
    time.hidden = value == null;
    time.textContent = value == null ? '' : `${fmtTime(value)} 更新`;
    time.title = value == null ? '' : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  const t = u?.llm?.stats;
  if (u && u.llm?.configured === false) {
    $('usageTokensVal').textContent = '—';
    $('usageTokensComp').textContent = '配置个人 API 后开始统计';
  } else if (!u) {
    $('usageTokensVal').textContent = '—';
    $('usageTokensComp').textContent = usageError ? '读取失败' : '读取中…';
  } else {
    $('usageTokensVal').innerHTML = t?.totalTokens != null
      ? `${compactNum(t.totalTokens)} <small>tokens</small>` : '—';
    const parts = [];
    if (t?.inputTokens != null) parts.push(`输入 ${compactNum(t.inputTokens)}`);
    if (t?.outputTokens != null) parts.push(`输出 ${compactNum(t.outputTokens)}`);
    if (t?.cachedInputTokens != null) parts.push(`缓存 ${compactNum(t.cachedInputTokens)}`);
    $('usageTokensComp').textContent = parts.length ? parts.join(' · ') : '暂无用量记录';
  }

  if (u) {
    const s = u.shanbay?.stats ?? {}, l = u.llm?.stats ?? {}, p = u.pretranslation ?? {};
    // One line, always: the card title already says 近 30 天, so the period label is dropped and
    // the counters are compressed to label+number. Units are in the labels, not repeated per value.
    const bits = [`请求 ${(s.requests ?? 0) + (l.requests ?? 0)}`,
      `缓存 ${(s.cacheHits ?? 0) + (l.cacheHits ?? 0)}`, `预译 ${p.completedSentences ?? 0}`, `分析 ${p.analyzedSentences ?? 0}`];
    if (u.recording && u.recording.available === false) bits.push('不完整');
    $('usageFoot').replaceChildren(...(usageError
      ? [Object.assign(document.createElement('span'), { textContent: '读取失败：' + usageError.message + ' · 已保留上次记录' })]
      : bits.map(t => Object.assign(document.createElement('span'), { textContent: t }))));
  } else {
    $('usageFoot').replaceChildren(Object.assign(document.createElement('span'),
      { textContent: usageError ? '读取失败：' + usageError.message : '仅统计本机记录' }));
  }
}

async function refreshUsage({ force = false } = {}) {
  if (usageLoading) { usageQueued = true; usageForceQueued ||= force; return; }
  const api = plugins()?.Llm;
  if (typeof api?.getUsage !== 'function' && typeof api?.getDeepSeekBalance !== 'function') {
    $('usageQuotaVal').textContent = '—';
    $('usageQuotaSub').textContent = '用量统计需要新版 App';
    $('usageBalanceComp').textContent = '余额查询需要新版 App';
    $('usageTokensComp').textContent = '—';
    $('usageFoot').textContent = '仅 app 内可用';
    return;
  }
  usageLoading = true;
  const revision = usageRevision;
  $('usageRefresh').disabled = true;
  $('usageRefresh').textContent = '读取中…';
  const [u, b, q] = await Promise.allSettled([
    typeof api.getUsage === 'function'
      ? getUsage({ days: 30 }) : Promise.reject(Object.assign(new Error('需要新版 App'), { code: 'NO_BRIDGE' })),
    typeof api.getDeepSeekBalance === 'function'
      ? getDeepSeekBalance({ forceRefresh: force }) : Promise.resolve(balanceSnapshot),
    typeof api.getShanbayQuota === 'function'
      ? getShanbayQuota({ forceRefresh: force })
      : Promise.reject(new Error('额度查询需要新版 App')),
  ]);
  usageLoading = false;
  $('usageRefresh').disabled = false;
  $('usageRefresh').textContent = '重新读取';
  if (revision === usageRevision) {
    if (u.status === 'fulfilled') usageSnapshot = u.value;
    if (q.status === 'fulfilled' && q.value) {
      usageSnapshot = { ...(usageSnapshot ?? {}), shanbay: q.value };
    }
    if (q.status === 'rejected' && q.reason?.code === 'CONFIG_CHANGED') {
      if (usageSnapshot) usageSnapshot = { ...usageSnapshot, shanbay: null };
    }
    if (b.status === 'fulfilled' && b.value) balanceSnapshot = b.value;
    if (b.status === 'rejected' && b.reason?.code === 'CONFIG_CHANGED') balanceSnapshot = null;
    renderUsage({
      usageError: u.status === 'rejected' ? u.reason : null,
      balanceError: b.status === 'rejected' ? b.reason : null,
      quotaError: q.status === 'rejected' ? q.reason : null,
    });
  }
  if (usageQueued || revision !== usageRevision) {
    const forceNext = usageForceQueued;
    usageQueued = false; usageForceQueued = false;
    void refreshUsage({ force: forceNext });
  }
}

$('usageRefresh').addEventListener('click', () => void refreshUsage({ force: true }));

window.hwfeePretranslationStatus = (message, { error, notify = false } = {}) => {
  $('pretranslationState').textContent = error ? '未完成 · 已暂停自动重试' : message;
  $('pretranslationRetry').hidden = !error;
  $('pretranslationDetail').hidden = !error;
  $('pretranslationDetail').textContent = error ? '本次未完成：' + error : '';
  if (error && notify) toast('文章预加载未完成', { kind: 'error', background: true,
    detail: error + '；已完成的翻译和分析保留在缓存中' });
};

const help = $('autoTranslateHint'), helpButton = $('pretranslationHelp');
function closePretranslationHelp() { help.hidden = true; helpButton.setAttribute('aria-expanded', 'false'); }
helpButton.addEventListener('click', () => {
  help.hidden = !help.hidden;
  helpButton.setAttribute('aria-expanded', String(!help.hidden));
});
document.addEventListener('pointerdown', event => {
  if (!help.contains(event.target) && !helpButton.contains(event.target)) closePretranslationHelp();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !help.hidden) { closePretranslationHelp(); helpButton.focus(); }
});
const routingHint = $('routingHint'), routingButton = $('routingHelp');
const closeRoutingHelp = () => { routingHint.hidden = true; routingButton.setAttribute('aria-expanded', 'false'); };
routingButton.addEventListener('click', () => {
  routingHint.hidden = !routingHint.hidden;
  routingButton.setAttribute('aria-expanded', String(!routingHint.hidden));
});
document.addEventListener('pointerdown', event => {
  if (!routingHint.contains(event.target) && !routingButton.contains(event.target)) closeRoutingHelp();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !routingHint.hidden) { closeRoutingHelp(); routingButton.focus(); }
});
$('pretranslationRetry').addEventListener('click', () => {
  void readFrame.contentWindow?.hwfeePrepareDaily?.({ forceTranslation: true });
});

$('autoTranslate').addEventListener('change', async (event) => {
  const input = event.target;
  const api = plugins()?.Llm;
  if (!api?.setPreferences) { input.checked = false; toast('请先安装新版 App'); return; }
  input.disabled = true;
  try {
    llmConfig = await api.setPreferences({ autoTranslate: input.checked });
    input.checked = Boolean(llmConfig.autoTranslate);
    $('pretranslationRetry').hidden = true;
    $('pretranslationState').textContent = input.checked
      ? ((llmConfig.canTranslate ?? llmConfig.has) ? '正在准备今日文章…' : '连接扇贝或配置回退 API 后开始预加载') : '已关闭自动预加载';
    if (input.checked) void readFrame.contentWindow?.hwfeePrepareDaily?.({ forceTranslation: true });
  } catch (error) {
    input.checked = !input.checked;
    toast('保存失败', { kind: 'error', detail: error.message });
  } finally { input.disabled = false; }
});

// --------------------------------------------------------------- appearance

const darkModeInput = $('darkMode');
const appearanceSystem = $('appearanceSystem');
let appearanceSnapshot = { mode: 'system', dark: false };
let appearanceRevision = 0;

function renderAppearance(snapshot, available = true) {
  appearanceSnapshot = snapshot;
  darkModeInput.checked = Boolean(snapshot.dark);
  darkModeInput.disabled = !available;
  appearanceSystem.hidden = snapshot.mode === 'system' || !available;
  $('appearanceState').textContent = !available ? '仅 App 内可手动切换'
    : snapshot.mode === 'system' ? `跟随系统 · 当前${snapshot.dark ? '深色' : '浅色'}`
      : snapshot.dark ? '已固定为深色' : '已固定为浅色';
}

async function loadAppearance() {
  if (typeof tabBarApi?.getAppearance !== 'function') {
    renderAppearance({ mode: 'system', dark: false }, false);
    return;
  }
  const revision = ++appearanceRevision;
  try {
    const snapshot = await tabBarApi.getAppearance();
    if (revision === appearanceRevision) renderAppearance(snapshot);
  } catch {
    if (revision === appearanceRevision) renderAppearance(appearanceSnapshot, false);
  }
}

async function changeAppearance(mode) {
  if (typeof tabBarApi?.setAppearance !== 'function') return;
  const previous = appearanceSnapshot;
  const revision = ++appearanceRevision;
  darkModeInput.disabled = true;
  appearanceSystem.disabled = true;
  try {
    const snapshot = await tabBarApi.setAppearance({ mode });
    if (revision === appearanceRevision) renderAppearance(snapshot);
  } catch (error) {
    if (revision === appearanceRevision) renderAppearance(previous);
    toast('外观切换失败', { kind: 'error', detail: error.message });
  } finally {
    appearanceSystem.disabled = false;
  }
}

darkModeInput.addEventListener('change', () => void changeAppearance(darkModeInput.checked ? 'dark' : 'light'));
appearanceSystem.addEventListener('click', () => void changeAppearance('system'));
window.hwfeeAppearanceChanged = loadAppearance;

const prepareDaily = () => { void readFrame.contentWindow?.hwfeePrepareDaily?.(); };
window.hwfeeAppResumed = () => { prepareDaily(); void loadAppearance(); };
window.addEventListener('focus', prepareDaily);
document.addEventListener('visibilitychange', () => { if (!document.hidden) prepareDaily(); });

$('shanbayLogin').addEventListener('click', async () => {
  const api = plugins()?.Shanbay;
  if (!api) { toast('仅 app 内可用'); return; }
  try {
    const result = await api.login();
    if (result?.connected) {
      invalidateUsage();
      toast('已连接扇贝', { kind: 'success' });
      clearVocabCache();
      reloadRead();
    } else {
      toast('没有拿到登录态', { kind: 'error', detail: '可以再试，或改用粘贴 Cookie' });
    }
    refreshSettings();
  } catch (error) {
    toast('登录失败', { kind: 'error', detail: error.message });
  }
});

$('shanbayClear').addEventListener('click', async () => {
  const api = plugins()?.Shanbay;
  if (!api) return;
  if (!confirm('断开扇贝？词表和短文将无法刷新。')) return;
  await api.clearCookie();
  invalidateUsage();
  toast('已断开扇贝');
  clearVocabCache();
  reloadRead();
  refreshSettings();
});

$('llmSave').addEventListener('click', async () => {
  const api = plugins()?.Llm;
  if (!api) { toast('仅 app 内可用'); return; }
  const key = $('llmKey').value.trim();
  const baseUrl = $('llmBase').value.trim();
  const model = selectedModel();
  try {
    const previousBase = llmConfig?.baseUrl;
    const saved = await api.setConfig({ key: key || undefined, baseUrl, model });
    llmRevision++;
    invalidateUsage();
    if (key || saved.baseUrl !== previousBase) modelCache = null;
    $('llmKey').value = '';
    toast(key ? '已保存翻译密钥' : '已保存接口设置', { kind: 'success' });
    refreshLlmState();
    void refreshUsage();
    void readFrame.contentWindow?.hwfeePrepareDaily?.({ forceTranslation: true });
  } catch (error) {
    toast('保存失败', { kind: 'error', detail: error.message });
  }
});

$('llmClear').addEventListener('click', async () => {
  const api = plugins()?.Llm;
  if (!api) return;
  if (!confirm('清除翻译密钥？')) return;
  await api.clearConfig();
  llmRevision++;
  invalidateUsage();
  modelCache = null;
  toast('已清除翻译密钥');
  refreshLlmState();
  void refreshUsage();
});

// ----------------------------------------------------------------------- boot

// Settings is a destination, not a place to resume into.
void loadAppearance();
const savedTab = localStorage.getItem(TAB_KEY);
showTab(savedTab === 'read' ? 'read' : 'listen');
console.log('[shell] ready', location.origin);
