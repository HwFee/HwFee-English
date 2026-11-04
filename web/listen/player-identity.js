// Runs between the lesson payload and its player script. Imported files stay untouched.
(() => {
  const node = document.getElementById('data');
  const id = /^\/lessons\/([^/]+)\//.exec(location.pathname)?.[1];
  if (!node || !id) return;
  try {
    const data = JSON.parse(node.textContent);
    const oldKey = 'cherina-lesson:' + data.id;
    const key = 'cherina-lesson:' + id;
    // Keep an existing position on upgrade; subsequent writes belong to this version.
    try {
      if (oldKey !== key && !localStorage.getItem(key)) {
        const previous = localStorage.getItem(oldKey);
        if (previous) localStorage.setItem(key, previous);
      }
    } catch {}
    data.id = id;
    data.dir = '/lessons/' + id;
    try { window.__hwfeeProgressMigration?.migrate(data); } catch {}
    node.textContent = JSON.stringify(data);
  } catch { /* A blocked store must not prevent the original player from opening. */ }
})();
