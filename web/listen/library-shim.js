// Live library state, injected by LessonServer after the generated library has rendered.
(() => {
  const previewStyle = document.createElement('style');
  previewStyle.id = 'hwfee-library-v3';
  previewStyle.textContent = `
    @font-face{font-family:'Noto Sans SC';src:url('/fonts/NotoSansSC.woff2') format('woff2');font-weight:100 900;font-display:swap}
    html,body{font-family:'Noto Sans SC',-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Microsoft YaHei',sans-serif}
    .wrap{padding-bottom:calc(var(--island-reserve,92px) + env(safe-area-inset-bottom) + 64px)}
    .stat{padding:15px 17px}.stat .k{display:flex;align-items:center;justify-content:space-between}
    .stat .v{font-size:29px;line-height:1.18}.stat .v small{font-size:14.5px}.stat.rev .v{color:var(--acc)}
    .stat .chev-mini{color:var(--ink3);font-size:18px;line-height:1}.week{gap:5px;margin-top:9px}.week i{height:5px}
    .hero .cover{width:96px;height:96px}.hero .hk{font-size:12.5px;font-weight:600;color:var(--acc)}
    .hero .tt{font-size:16.5px;-webkit-line-clamp:2}.hero .ss{font-size:12.5px;margin-top:5px}
    .hero .hact{justify-content:space-between}.hero .st{flex:1}.hero .go{width:44px;height:44px}
    h2{font-size:21px;margin:30px 0 12px}#hSaved,#hLib{display:flex;align-items:center;justify-content:space-between;gap:10px}
    #hSaved .saved-title,#hLib .library-title{display:flex;align-items:baseline;min-width:0}
    #hSaved .saved-title small{margin-left:5px;color:var(--ink3);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
    .review-link{display:inline-flex;align-items:center;justify-content:center;flex:none;height:28px;padding:0 11px;border-radius:999px;background:var(--acc-soft);color:var(--acc-ink);font-size:12.5px;font-weight:600}
    .saved{display:block;overflow:hidden;border-radius:20px;background:var(--surface);box-shadow:0 0 0 .5px rgba(0,0,0,.04)}
    .saved .sv{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 16px;border-radius:0;box-shadow:none}
    .saved .sv+.sv{border-top:.5px solid var(--line)}
    .sv-main{flex:1;min-width:0;text-align:left;cursor:pointer;outline:none}.sv-main:active{opacity:.72}
    .sv-main:focus-visible{border-radius:6px;box-shadow:0 0 0 2px var(--acc)}
    .saved .sv .s{font-size:14.5px;line-height:1.42;letter-spacing:-.01em}
    .saved .sv .t{font-size:13px;line-height:1.45;margin-top:3px}
    .saved .sv .w{display:flex;align-items:center;gap:5px;min-width:0;margin-top:6px;line-height:1.35}
    .sv-source-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sv-source-seg{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums}
    .sv-actions{display:flex;align-items:center;gap:6px;flex:none}
    .saved .sv button{display:grid;place-items:center;padding:0}
    .saved .sv .sv-play{width:36px;height:36px;border-radius:50%;background:var(--acc-soft);color:var(--acc);transition:transform .14s ease}
    .saved .sv .sv-play:active{transform:scale(.92)}
    .saved .sv .sv-remove{width:30px;height:30px;border-radius:50%;background:none;color:var(--acc);opacity:.75}
    .saved .sv .sv-remove:active{background:var(--track);opacity:1}
    .saved .empty{padding:22px;background:none;border-radius:0}
    .saved-toggle{display:flex;align-items:center;justify-content:center;gap:4px;width:100%;height:42px;border-top:.5px solid var(--line);color:var(--acc-ink);font-size:13px;font-weight:600}
    .saved-toggle:active{background:var(--track)}
    .mini-seg{display:inline-flex;flex:none;padding:2px;border-radius:9px;background:var(--track)}
    .mini-seg button{height:26px;padding:0 10px;border-radius:7px;color:var(--ink2);font-size:12px;font-weight:600;white-space:nowrap;transition:background .16s var(--ease),color .16s var(--ease)}
    .mini-seg button.is-on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
    .grid{gap:11px}.card{position:relative;gap:11px}.card:hover{transform:none}.card[hidden]{display:none}
    .card .top>div:nth-child(2){flex:1}.card .tt{font-size:15px}.card .cover{width:54px;height:54px}
    .dots{margin-left:auto;display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:50%;color:var(--ink3);font-size:20px;line-height:1}
    .dots:active,.dots.is-open{background:var(--track);color:var(--ink)}
    .course-menu{position:absolute;top:44px;right:14px;z-index:20;min-width:124px;padding:4px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 10px 28px rgba(0,0,0,.16)}
    .course-menu[hidden]{display:none}.course-menu button{display:block;width:100%;padding:8px 11px;border-radius:8px;color:var(--danger);text-align:left;font-size:13px;font-weight:600}
    .course-menu button:active{background:var(--track)}
    .links a{display:grid;place-items:center;height:35px;padding:0 8px}
    .rv-b{gap:22px}.rv-b .big{width:108px;height:108px}.rv-b .flip{min-height:136px;padding:20px}
    .rv-b .flip .q{font-size:15px;letter-spacing:0}.rv-b .grade button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:54px;font-size:14px}
    .rv-b .grade button::after{font-size:10.5px;font-weight:500;opacity:.75}
    .rv-b .grade button[data-g='0']::after{content:'保留 · 本轮再练'}.rv-b .grade button[data-g='1']::after{content:'保留收藏'}.rv-b .grade button[data-g='2']::after{content:'移出收藏'}
    @media(max-width:360px){.mini-seg button{padding:0 8px}.saved .sv{gap:8px;padding-left:14px}.sv-actions{gap:3px}.review-link{padding:0 9px}}
    @media(prefers-reduced-motion:reduce){.mini-seg button,.saved .sv .sv-play{transition:none}}
  `;
  document.head.append(previewStyle);
  let lessons;
  try { lessons = JSON.parse(document.getElementById('data').textContent).lessons; } catch { return; }
  let active = null;
  let lastRender = '';
  // Progress includes every stage checkpoint. Reparse only the keys whose stored text changed.
  const parsed = new Map();
  let renderProgress;
  const read = (key) => {
    try {
      const raw = localStorage.getItem(key);
      if (parsed.get(key)?.raw === raw) return parsed.get(key).value;
      const value = JSON.parse(raw);
      parsed.set(key, { raw, value });
      return value;
    } catch { return null; }
  };
  const idOf = (value) => {
    if (!value) return '';
    const id = /^\/lessons\/([^/]+)/.exec(value.dir || '')?.[1] || value.dir || value.id || '';
    return lessons.find(lesson => lesson.legacyIds?.includes(id))?.id || id;
  };
  const progress = (lesson) => {
    if (!renderProgress.has(lesson.id)) {
      const existing = read('cherina-lesson:' + lesson.id);
      const legacy = (lesson.legacyIds || []).map(id => read('cherina-lesson:' + id)).filter(Boolean)
        .sort((a, b) => Math.max(0, ...Object.values(b.parts || {}).map(p => p.at || 0))
          - Math.max(0, ...Object.values(a.parts || {}).map(p => p.at || 0)));
      const value = existing || legacy[0] || read('cherina-lesson:' + lesson.id.replace(/^(cet4|cet6)-/, '')) || {};
      renderProgress.set(lesson.id, value);
    }
    return renderProgress.get(lesson.id);
  };
  const make = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const glyph = (playing) => playing
    ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.8" width="4.3" height="14.4" rx="1.5"/><rect x="13.7" y="4.8" width="4.3" height="14.4" rx="1.5"/></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8.2 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.1-6.4a1.2 1.2 0 0 0 0-2.04l-10.1-6.4A1.2 1.2 0 0 0 8.2 5.6z"/></svg>';

  function render() {
    renderProgress = new Map();
    renderActivity();
    renderCourseFilter();
    const last = read('hwfee:listen:last') || read('cherina-pod:last');
    const pick = lessons.find((lesson) => lesson.id === idOf(active))
      || lessons.find((lesson) => lesson.id === idOf(last))
      || lessons.find((lesson) => lesson.id === last?.id)
      || lessons.find((lesson) => Object.values(progress(lesson).steps || {}).filter(n => n >= 4).length < lesson.segments)
      || lessons[0];
    const hero = document.getElementById('hero');
    if (!pick || !hero) return;
    const st = progress(pick);
    const isActive = pick.id === idOf(active);
    const segment = Math.min(pick.segments || 1, Math.max(1,
      isActive ? active.segment || st.seg + 1 || 1 : pick.id === idOf(last) ? last?.segment || last?.seg || st.seg + 1 || 1 : st.seg + 1 || 1));
    const signature = JSON.stringify([pick.id, segment, active?.playing, active?.step, st.step,
      Boolean(last), lessons.map(lesson => progress(lesson).steps)]);
    if (signature === lastRender) return;
    lastRender = signature;
    hero.href = pick.dir + '/player.html#seg=' + segment;
    const cover = make('div', undefined, 'cover');
    if (pick.image) {
      const img = make('img'); img.src = pick.image; img.alt = '';
      img.onerror = () => img.remove(); cover.append(img);
    }
    cover.append(make('span', (pick.podcast || pick.title || '?').trim()[0].toUpperCase()));
    const body = make('div', undefined, 'm');
    const status = isActive ? active.playing ? '正在播放' : '已暂停'
      : last || st.steps ? '继续练习' : null;
    hero.classList.toggle('is-playing', isActive && Boolean(active.playing));
    const kicker = isActive ? active.playing ? '正在精听' : '继续精听'
      : last || st.steps ? '继续精听' : '开始精听';
    body.append(make('div', kicker, 'hk'));
    const step = isActive ? active.step ?? st.step : st.step;
    const stText = status
      ? `${status} · 第 ${segment} 段${Number.isInteger(step) ? ' · ' + ['盲听', '精听', '对照', '再盲听'][step] : ''}`
      : `从第 ${segment} 段开始`;
    body.append(make('div', pick.title, 'tt'), make('div', pick.podcast || '', 'ss'),
      make('div', `共 ${pick.segments} 段${pick.duration ? ' · ' + Math.round(pick.duration / 60) + ' 分钟' : ''}`, 'ss'));
    const go = make('span', undefined, 'go'); go.innerHTML = glyph(isActive && active.playing);
    go.setAttribute('aria-label', isActive && active.playing ? '暂停' : '播放');
    const row = make('div', undefined, 'hrow');
    row.append(cover, body);
    const act = make('div', undefined, 'hact');
    const stEl = make('div', stText, 'st' + (isActive && active.playing ? ' is-live' : ''));
    act.append(stEl, go);
    hero.replaceChildren(row, act);
    for (const card of document.querySelectorAll('#grid .card')) {
      const link = card.querySelector('a[href*="player.html"]');
      const lesson = lessons.find(l => l.id === idOf({ dir: link?.getAttribute('href') }));
      if (!lesson) continue;
      const p = progress(lesson);
      const done = Math.min(lesson.segments, Object.values(p.steps || {}).filter(n => n >= 4).length);
      const fill = card.querySelector('.pg i');
      if (fill) fill.style.width = Math.round(done / Math.max(1, lesson.segments) * 100) + '%';
      const label = card.querySelector('.pgt');
      if (label) label.textContent = `${done} / ${lesson.segments} 已完成`;
      link.href = lesson.dir + '/player.html#seg=' + Math.min(lesson.segments || 1, (p.seg || 0) + 1);
    }
  }

  function renderActivity() {
    const summary = window.__hwfeeActivity?.summary();
    const tiles = document.querySelectorAll('#stats .stat');
    if (!summary || tiles.length < 3) return;
    const put = (index, value) => {
      const number = tiles[index].querySelector('.v');
      if (!number) return;
      if (number.firstChild?.textContent === String(value)) return;
      const unit = number.querySelector('small');
      number.replaceChildren(document.createTextNode(String(value)));
      if (unit) number.append(unit);
    };
    put(0, summary.streak);
    put(1, Math.floor(summary.seconds / 60));
    put(2, summary.segments);
    for (const dot of tiles[0].querySelectorAll('.week i')) {
      const day = summary.days[dot.title];
      dot.classList.toggle('on', Boolean(day && (day.segs > 0 || day.sec >= 120)));
    }
  }
  let savedExpanded = false;
  let courseFilter = 'all';
  let openCourseMenu = null;
  const playGlyph = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.2 5.6v12.8a1.2 1.2 0 0 0 1.84 1.02l10.1-6.4a1.2 1.2 0 0 0 0-2.04l-10.1-6.4A1.2 1.2 0 0 0 8.2 5.6z"/></svg>';
  const bookmarkGlyph = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z"/></svg>';

  function openReviewFromView() {
    let opened = false;
    try { opened = window.hwfeeOpenReview?.(); } catch {}
    if (opened === false) {
      try { window.parent?.hwfeeToast?.('还没有收藏的句子'); } catch {}
    }
    return opened === true;
  }

  function renderSavedHeader(count) {
    const head = document.getElementById('hSaved');
    if (!head) return;
    const title = make('span', undefined, 'saved-title');
    title.append(make('span', '收藏的句子'));
    if (count) title.append(make('small', String(count)));
    const review = make('button', '开始复习 ›', 'review-link');
    review.type = 'button'; review.hidden = !count;
    review.onclick = openReviewFromView;
    head.replaceChildren(title, review);
  }
  window.hwfeeRenderSavedHeader = renderSavedHeader;

  function removeSaved(item) {
    void window.__hwfeeSaved?.pause();
    window.__hwfeeSavedState?.remove(item);
    window.hwfeeRefreshSaved?.();
    try {
      window.parent?.hwfeeToast?.('已取消收藏', { undo: () => {
        window.__hwfeeSavedState?.restore(item);
        window.hwfeeRefreshSaved?.();
      } });
    } catch {}
  }

  window.renderSaved = function renderSavedV3() {
    const box = document.getElementById('saved');
    if (!box) return;
    const rows = (window.__hwfeeSavedState?.read() || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    renderSavedHeader(rows.length);
    box.replaceChildren();
    if (!rows.length) {
      box.append(make('div', '精听或对照时点句子下方的书签，就能收藏到这里', 'empty'));
      return;
    }
    const visible = savedExpanded ? rows : rows.slice(0, 3);
    for (const item of visible) {
      const row = make('div', undefined, 'sv');
      const main = make('div', undefined, 'sv-main');
      main.setAttribute('role', 'button'); main.tabIndex = 0;
      main.setAttribute('aria-label', '跳回原课：' + (item.s || '收藏句子'));
      main.append(make('div', item.s || '', 's'), make('div', item.t || '', 't'));
      const source = make('div', undefined, 'w');
      source.append(make('span', item.title || item.podcast || '原课程', 'sv-source-title'));
      const segment = Number(item.segment || item.seg);
      source.append(make('span', `${segment > 0 ? '· 第 ' + segment + ' 段 ' : ''}›`, 'sv-source-seg'));
      main.append(source);
      const open = () => { try { window.parent?.hwfeeOpenSavedSentenceInLesson?.(item); } catch {} };
      main.onclick = open;
      main.onkeydown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); open();
      };
      const actions = make('div', undefined, 'sv-actions');
      const play = make('button', undefined, 'sv-play');
      play.type = 'button'; play.dataset.k = item.k; play.innerHTML = playGlyph;
      play.setAttribute('aria-label', '播放句子');
      play.onclick = () => { void window.__hwfeeSaved?.play(item); };
      const remove = make('button', undefined, 'sv-remove');
      remove.type = 'button'; remove.innerHTML = bookmarkGlyph;
      remove.title = '取消收藏'; remove.setAttribute('aria-label', '取消收藏');
      remove.dataset.removeSaved = item.k;
      remove.onclick = () => removeSaved(item);
      actions.append(play, remove); row.append(main, actions); box.append(row);
    }
    if (rows.length > 3) {
      const toggle = make('button', undefined, 'saved-toggle');
      toggle.type = 'button';
      toggle.append(make('span', savedExpanded ? '收起' : `查看全部 ${rows.length} 句`), make('span', savedExpanded ? '▴' : '▾'));
      toggle.setAttribute('aria-expanded', String(savedExpanded));
      toggle.onclick = () => { savedExpanded = !savedExpanded; window.hwfeeRefreshSaved?.(); };
      box.append(toggle);
    }
  };

  function courseForCard(card) {
    const link = card.querySelector('a[href*="player.html"]');
    const raw = link?.getAttribute('href') || '';
    const id = /^\/lessons\/([^/]+)/.exec(raw)?.[1] || raw.split('/').pop();
    return lessons.find(lesson => lesson.id === id || lesson.dir === raw || lesson.legacyIds?.includes(id));
  }

  function renderCourseFilter() {
    const cards = [...document.querySelectorAll('#grid .card')];
    let activeCount = 0;
    for (const card of cards) {
      const lesson = courseForCard(card);
      if (!lesson) continue;
      const state = progress(lesson);
      const done = Math.min(lesson.segments, Object.values(state.steps || {}).filter(n => n >= 4).length);
      const practicing = done > 0 && done < lesson.segments;
      if (practicing) activeCount++;
      card.hidden = courseFilter === 'active' && !practicing;
      const primary = card.querySelector('.links a.pri');
      if (primary) primary.textContent = practicing ? `继续第 ${Math.min(lesson.segments, done + 1)} 段` : '精听';
    }
    const all = document.querySelector('#courseFilter [data-filter="all"]');
    const current = document.querySelector('#courseFilter [data-filter="active"]');
    if (all) all.textContent = `全部 ${lessons.length}`;
    if (current) current.textContent = `练习中 ${activeCount}`;
  }

  function installCourseControls() {
    const head = document.getElementById('hLib');
    if (head && !document.getElementById('courseFilter')) {
      const title = make('span', '课程库', 'library-title');
      const filter = make('div', undefined, 'mini-seg'); filter.id = 'courseFilter';
      for (const [value, label] of [['all', '全部'], ['active', '练习中']]) {
        const button = make('button', label); button.type = 'button'; button.dataset.filter = value;
        button.classList.toggle('is-on', value === courseFilter);
        button.setAttribute('aria-pressed', String(value === courseFilter));
        button.onclick = () => {
          courseFilter = value;
          for (const option of filter.children) {
            option.classList.toggle('is-on', option === button);
            option.setAttribute('aria-pressed', String(option === button));
          }
          renderCourseFilter();
        };
        filter.append(button);
      }
      head.replaceChildren(title, filter);
    }
    for (const card of document.querySelectorAll('#grid .card')) {
      if (card.querySelector('.dots')) continue;
      const lesson = courseForCard(card);
      if (!lesson) continue;
      const top = card.querySelector('.top');
      const more = make('button', '⋯', 'dots'); more.type = 'button';
      more.setAttribute('aria-label', '更多操作'); more.setAttribute('aria-expanded', 'false');
      const menu = make('div', undefined, 'course-menu'); menu.hidden = true;
      const remove = make('button', '删除该课程'); remove.type = 'button';
      more.onclick = event => {
        event.stopPropagation();
        const opening = menu.hidden;
        if (openCourseMenu && openCourseMenu !== menu) {
          openCourseMenu.hidden = true;
          openCourseMenu.closest('.card')?.querySelector('.dots')?.setAttribute('aria-expanded', 'false');
        }
        menu.hidden = !opening; more.classList.toggle('is-open', opening); more.setAttribute('aria-expanded', String(opening));
        openCourseMenu = opening ? menu : null;
      };
      remove.onclick = async event => {
        event.stopPropagation(); remove.disabled = true;
        try { await window.parent?.hwfeeRemoveLesson?.(lesson); } catch {}
        remove.disabled = false; menu.hidden = true; openCourseMenu = null;
      };
      menu.append(remove); top?.append(more); card.append(menu);
    }
  }

  function installReviewCopy() {
    const panel = document.getElementById('rv');
    let reviewVisible = false;
    if (panel) new MutationObserver(() => {
      const open = panel.classList.contains('on');
      if (open === reviewVisible) return;
      reviewVisible = open;
      try { window.parent?.hwfeeReviewView?.(open); } catch {}
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  function installPreview() {
    const reviewStat = document.querySelector('#stRev .k');
    if (reviewStat && !reviewStat.querySelector('.chev-mini')) reviewStat.append(make('span', '›', 'chev-mini'));
    const stat = document.getElementById('stRev');
    if (stat) stat.onclick = openReviewFromView;
    installCourseControls();
    installReviewCopy();
    document.addEventListener('click', event => {
      const remove = event.target.closest?.('[data-remove-saved]');
      if (remove && !remove.classList.contains('sv-remove')) {
        const item = window.__hwfeeSavedState?.read().find(row => row.k === remove.dataset.removeSaved);
        if (item) { event.preventDefault(); removeSaved(item); }
        return;
      }
      if (!openCourseMenu || event.target.closest?.('.course-menu,.dots')) return;
      openCourseMenu.hidden = true; openCourseMenu = null;
      for (const button of document.querySelectorAll('.dots.is-open')) { button.classList.remove('is-open'); button.setAttribute('aria-expanded', 'false'); }
    });
    window.hwfeeRefreshSaved?.();
  }

  window.hwfeeUpdateLibrary = (session) => { active = session; render(); };
  window.addEventListener('storage', event => {
    if (!event.key || /^(cherina-lesson:|cherina-pod:activity|cherina-pod:last|hwfee:listen:last)/.test(event.key)) render();
  });
  window.addEventListener('pageshow', render);
  // load waits for every image; the shell needs working links before remote assets finish.
  try { window.parent?.hwfeeListenReady?.(window); } catch {}
  installPreview();
  render();
})();
