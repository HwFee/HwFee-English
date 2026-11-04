// Live library state, injected by LessonServer after the generated library has rendered.
(() => {
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
  window.hwfeeUpdateLibrary = (session) => { active = session; render(); };
  window.addEventListener('storage', event => {
    if (!event.key || /^(cherina-lesson:|cherina-pod:activity|cherina-pod:last|hwfee:listen:last)/.test(event.key)) render();
  });
  window.addEventListener('pageshow', render);
  // load waits for every image; the shell needs working links before remote assets finish.
  try { window.parent?.hwfeeListenReady?.(window); } catch {}
  render();
})();
