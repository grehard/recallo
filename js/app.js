// App shell: hash routing, the top bar and the theme toggle.
const App = (() => {
  const THEME_KEY = 'recallo.theme';
  const TABS = [
    { id: 'decks', label: 'Decks', href: '#/decks' },
    { id: 'browse', label: 'Browse', href: '#/browse' },
    { id: 'stats', label: 'Statistics', href: '#/stats' },
    { id: 'data', label: 'Import and export', href: '#/data' },
  ];
  let main = null;
  let topbar = null;
  let activeView = null;
  let watchedDay = null;

  // ---- Theme ----

  function savedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (err) {
      return null;
    }
  }

  function currentTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      // The choice still applies for this visit.
    }
    renderTopbar(currentTab());
  }

  // ---- Routing ----

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, queryString] = raw.split('?');
    const [view, id] = path.split('/');
    return { view: view || 'decks', id: id ? decodeURIComponent(id) : null, query: Object.fromEntries(new URLSearchParams(queryString || '')) };
  }

  const currentTab = () => parseHash().view;

  function renderTopbar(active) {
    topbar.replaceChildren(
      h('a', { class: 'brand', href: '#/decks', 'aria-label': 'Recallo, go to decks' }, brandMark(), h('span', {}, 'Recallo')),
      h('nav', { class: 'tabs', 'aria-label': 'Main' },
        TABS.map((tab) => h('a', { class: `tab${tab.id === active ? ' is-active' : ''}`, href: tab.href, 'aria-current': tab.id === active ? 'page' : null }, tab.label))),
      h('div', { class: 'topbar-tools' },
        Store.storageOk ? null : h('span', { class: 'chip chip-warn', title: 'Browser storage is blocked or full, so changes last until this tab closes.' }, 'Not saving'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Scheduling settings', title: 'Scheduling settings', onclick: () => DataView.openSettings(route) }, icon('sliders', 18)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} theme`, title: 'Switch theme', onclick: toggleTheme }, icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18))));
  }

  function brandMark() {
    return svg('svg', { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      svg('rect', { class: 'brand-back', x: 7, y: 3, width: 14, height: 14, rx: 2.5 }),
      svg('rect', { class: 'brand-front', x: 3, y: 7, width: 14, height: 14, rx: 2.5 }));
  }

  function mountView(view, mount) {
    activeView = view;
    mount();
  }

  function route() {
    if (activeView && activeView.unmount) activeView.unmount();
    activeView = null;
    Modal.close();
    Charts.hideTip();
    const { view, id, query } = parseHash();
    const studying = (view === 'study' || view === 'practice') && id && Store.deck(id);
    document.body.classList.toggle('is-studying', Boolean(studying));
    if (!studying) renderTopbar(view);
    window.scrollTo(0, 0);

    if (studying) {
      const limit = view === 'practice' && query.n !== 'all' ? Number(query.n) || 20 : null;
      mountView(StudyView, () => StudyView.mount(main, { mode: view === 'practice' ? 'practice' : 'review', deckId: id, limit, tag: query.tag || null }));
    } else if (view === 'browse') {
      mountView(BrowseView, () => BrowseView.mount(main, { query }));
    } else if (view === 'stats') {
      mountView(StatisticsView, () => StatisticsView.mount(main, { query }));
    } else if (view === 'data') {
      mountView(DataView, () => DataView.mount(main));
    } else {
      mountView(DecksView, () => DecksView.mount(main, { deckId: id }));
    }
  }

  // Counts depend on the date, so a page left open overnight needs refreshing.
  function watchDayChange() {
    watchedDay = Dates.today();
    setInterval(() => {
      if (Dates.today() === watchedDay) return;
      watchedDay = Dates.today();
      if (activeView === DecksView) route();
    }, 30000);
  }

  function start() {
    const theme = savedTheme();
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    const outcome = Store.load();
    topbar = document.getElementById('topbar');
    main = document.getElementById('main');
    window.addEventListener('hashchange', route);
    route();
    watchDayChange();
    if (outcome === 'recovered') Toast.show('Saved data was damaged, so the demo decks were restored.', { kind: 'warn' });
  }

  return { start, refresh: route };
})();

App.start();
