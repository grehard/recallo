// Deck page: the nested deck tree on the left, the selected deck's details on the right.
const DecksView = (() => {
  let root = null;
  let selectedId = null;

  function mount(container, params) {
    root = container;
    selectedId = params.deckId || Store.state.ui.selectedDeck;
    if (selectedId && !Store.deck(selectedId)) selectedId = null;
    render();
  }

  function select(id) {
    selectedId = id;
    Store.setUi({ selectedDeck: id });
    render();
    // On narrow screens the details sit below the list, so bring them into view.
    if (window.innerWidth <= 900) root.querySelector('.deck-panel').scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const now = Date.now();
    const counts = Queue.allCounts(Store.state, now);
    const topLevel = Store.childrenOf(null);
    if (!selectedId && topLevel.length) selectedId = topLevel[0].id;

    if (!topLevel.length) {
      root.replaceChildren(emptyState());
      return;
    }
    root.replaceChildren(h('div', { class: 'decks-page' },
      h('section', { class: 'decks-main', 'aria-label': 'Decks' },
        pageHead(now, counts, topLevel),
        deckTable(counts)),
      deckPanel(selectedId, counts.get(selectedId), now)));
  }

  function emptyState() {
    return h('div', { class: 'empty' },
      h('h1', {}, 'No decks yet'),
      h('p', {}, 'Create a deck and add cards, or import a CSV or JSON file.'),
      h('div', { class: 'button-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openDeckEditor({}) }, icon('plus'), 'New deck'),
        h('a', { class: 'btn', href: '#/data' }, 'Import or reset demo data')));
  }

  function pageHead(now, counts, topLevel) {
    const stats = Stats.compute(Store.state, null, now);
    const due = topLevel.reduce((sum, d) => {
      const c = counts.get(d.id);
      return sum + c.review + c.learning + c.fresh;
    }, 0);
    return h('header', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Decks'),
        h('p', { class: 'page-sub' },
          `${plural(due, 'card')} to study today · ${plural(stats.reviewsToday, 'review')} done · ${stats.streak}-day streak`)),
      h('div', { class: 'button-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => openDeckEditor({ parentId: null }) }, icon('plus'), 'New deck'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => NoteEditor.open({ deckId: selectedId, onSaved: render }) }, icon('plus'), 'Add card')));
  }

  function deckTable(counts) {
    const collapsed = Store.state.ui.collapsed;
    const rows = [];
    const walk = (parentId, depth) => {
      for (const deck of Store.childrenOf(parentId)) {
        rows.push(deckRow(deck, depth, counts.get(deck.id), collapsed));
        if (!collapsed[deck.id]) walk(deck.id, depth + 1);
      }
    };
    walk(null, 0);
    return h('div', { class: 'deck-table-wrap' }, h('table', { class: 'deck-table' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Deck'),
        h('th', { scope: 'col', class: 'num' }, 'New'),
        h('th', { scope: 'col', class: 'num' }, 'Learn'),
        h('th', { scope: 'col', class: 'num' }, 'Due'),
        h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Study')))),
      h('tbody', {}, rows)));
  }

  function countCell(value, className) {
    return h('td', { class: `num ${value ? className : 'count-zero'}` }, value);
  }

  function deckRow(deck, depth, count, collapsed) {
    const hasChildren = Store.childrenOf(deck.id).length > 0;
    const total = count.fresh + count.learning + count.review;
    const isCollapsed = Boolean(collapsed[deck.id]);
    const toggle = hasChildren
      ? h('button', {
        class: `tree-toggle${isCollapsed ? '' : ' is-open'}`, type: 'button',
        'aria-expanded': String(!isCollapsed), 'aria-label': `${isCollapsed ? 'Expand' : 'Collapse'} ${deck.name}`,
        onclick: () => {
          const next = { ...Store.state.ui.collapsed };
          if (isCollapsed) delete next[deck.id]; else next[deck.id] = true;
          Store.setUi({ collapsed: next });
          render();
        },
      }, icon('chevron', 14))
      : h('span', { class: 'tree-spacer' });
    return h('tr', { class: `deck-row${deck.id === selectedId ? ' is-selected' : ''}`, 'data-deck': deck.name },
      h('td', { class: 'deck-name-cell' },
        h('div', { class: 'deck-name-wrap', style: `padding-left:${depth * 20}px` },
          toggle,
          h('button', { class: 'deck-name', type: 'button', 'aria-current': deck.id === selectedId ? 'true' : null, onclick: () => select(deck.id) }, deck.name))),
      countCell(count.fresh, 'count-new'),
      countCell(count.learning, 'count-learn'),
      countCell(count.review, 'count-review'),
      h('td', { class: 'deck-go' },
        h('a', { class: `icon-btn deck-study${total ? '' : ' is-idle'}`, href: `#/study/${deck.id}`, 'aria-label': `Study ${deck.name}`, title: `Study ${deck.name}` }, icon('play', 15))));
  }

  function limitMeter(label, used, limit) {
    const share = limit ? Math.min(100, (used / limit) * 100) : 100;
    return h('div', { class: 'meter' },
      h('div', { class: 'meter-label' }, h('span', {}, label), h('span', {}, `${used} of ${limit}`)),
      h('div', { class: 'meter-track' }, h('div', { class: 'meter-fill', style: `width:${share}%` })));
  }

  function deckTotals(deckId) {
    const ids = new Set(Store.descendantIds(deckId));
    const noteIds = new Set(Store.state.notes.filter((n) => ids.has(n.deckId)).map((n) => n.id));
    const cards = Store.state.cards.filter((c) => noteIds.has(c.noteId));
    return { cards, total: cards.length, suspended: cards.filter((c) => c.suspended).length, leeches: cards.filter((c) => c.leech).length };
  }

  function deckPanel(deckId, count, now) {
    const deck = Store.deck(deckId);
    const usage = Queue.usage(Store.state, deckId, now);
    const totals = deckTotals(deckId);
    const available = count.fresh + count.learning + count.review;
    const nextWeek = Stats.forecast(totals.cards, now, 7);
    const parentPath = deck.parentId ? Store.deckPath(deck.parentId) : null;

    return h('aside', { class: 'deck-panel', 'aria-label': `Details for ${deck.name}` },
      parentPath ? h('p', { class: 'deck-panel-path' }, parentPath) : null,
      h('h2', {}, deck.name),
      h('dl', { class: 'count-trio' },
        h('div', {}, h('dt', {}, 'New'), h('dd', { class: 'count-new' }, count.fresh)),
        h('div', {}, h('dt', {}, 'Learning'), h('dd', { class: 'count-learn' }, count.learning)),
        h('div', {}, h('dt', {}, 'Review'), h('dd', { class: 'count-review' }, count.review))),
      available
        ? h('a', { class: 'btn btn-primary btn-block', href: `#/study/${deckId}` }, icon('play', 15), 'Study now')
        : h('p', { class: 'deck-panel-done' }, icon('check'), 'Nothing left to study here today.'),
      h('div', { class: 'button-grid' },
        h('button', { class: 'btn', type: 'button', onclick: () => openPractice(deckId), disabled: totals.total === totals.suspended }, icon('repeat'), 'Practice'),
        h('button', { class: 'btn', type: 'button', onclick: () => NoteEditor.open({ deckId, onSaved: render }) }, icon('plus'), 'Add card'),
        h('a', { class: 'btn', href: `#/browse?deck=${encodeURIComponent(deckId)}` }, icon('search'), 'Browse'),
        h('button', { class: 'btn', type: 'button', onclick: () => openDeckEditor({ deck }) }, icon('sliders'), 'Options')),
      h('div', { class: 'deck-panel-section' },
        h('h3', {}, 'Daily limits'),
        limitMeter('New cards today', usage.fresh, usage.newLimit),
        limitMeter('Reviews today', usage.review, usage.reviewLimit)),
      h('div', { class: 'deck-panel-section' },
        h('h3', {}, 'Next 7 days'),
        Charts.bars({
          items: nextWeek.map((f) => ({
            label: Dates.toDate(f.day).toLocaleDateString('en-US', { weekday: 'narrow' }),
            value: f.count,
            tip: `${Dates.monthDay(f.day)}: ${plural(f.count, 'card')} due`,
          })),
          width: 272, height: 96, ariaLabel: `Cards due in ${deck.name} over the next 7 days`,
        })),
      h('p', { class: 'deck-panel-foot' },
        [plural(totals.total, 'card'), totals.suspended ? `${totals.suspended} suspended` : null, totals.leeches ? plural(totals.leeches, 'leech', 'leeches') : null].filter(Boolean).join(' · ')));
  }

  // ---- Deck editor ----

  /** options: { deck } to edit, or { parentId } to create. */
  function openDeckEditor(options) {
    const deck = options.deck || null;
    const nameInput = h('input', { type: 'text', id: 'deck-name', value: deck ? deck.name : '', 'data-autofocus': true, autocomplete: 'off' });
    const parentInput = deckSelect(deck ? deck.parentId : options.parentId, { exclude: deck ? Store.descendantIds(deck.id) : [], includeNone: 'None (top level)', id: 'deck-parent' });
    const newInput = h('input', { type: 'number', id: 'deck-new', min: 0, max: 9999, step: 1, inputmode: 'numeric', value: deck ? deck.newPerDay : 20 });
    const reviewInput = h('input', { type: 'number', id: 'deck-reviews', min: 0, max: 9999, step: 1, inputmode: 'numeric', value: deck ? deck.reviewsPerDay : 200 });
    const nameField = field('Name', nameInput);
    const newField = field('New cards per day', newInput);
    const reviewField = field('Reviews per day', reviewInput);

    const limitValue = (input, wrap) => {
      const value = Number(input.value);
      const ok = input.value.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 9999;
      wrap.setError(ok ? '' : 'Enter a whole number from 0 to 9999.');
      return ok ? value : null;
    };

    function save() {
      const parentId = parentInput.value || null;
      const nameError = Store.deckNameError(nameInput.value, parentId, deck ? deck.id : null);
      nameField.setError(nameError);
      const newPerDay = limitValue(newInput, newField);
      const reviewsPerDay = limitValue(reviewInput, reviewField);
      if (nameError || newPerDay === null || reviewsPerDay === null) return;

      const values = { name: nameInput.value.trim(), parentId, newPerDay, reviewsPerDay };
      if (deck) {
        Store.updateDeck(deck.id, values);
      } else {
        selectedId = Store.createDeck(values).id;
        Store.setUi({ selectedDeck: selectedId });
      }
      Modal.close();
      render();
    }

    function removeDeck() {
      const count = deckTotals(deck.id).total;
      Modal.close();
      Toast.withUndo(`Deleted ${deck.name} and ${plural(count, 'card')}`, () => {
        Store.deleteDeck(deck.id);
        if (selectedId === deck.id) selectedId = deck.parentId;
      }, render);
    }

    Modal.open({
      title: deck ? 'Deck options' : 'New deck',
      body: h('form', { class: 'stack-form', onsubmit: (e) => { e.preventDefault(); save(); } },
        nameField,
        field('Parent deck', parentInput, { hint: 'Studying a deck includes everything inside it.' }),
        h('div', { class: 'field-row' }, newField, reviewField),
        h('p', { class: 'field-hint' }, 'A limit also covers subdecks: their answers count toward it, and it caps what they can offer.'),
        h('button', { type: 'submit', hidden: true, tabindex: -1 }, 'Save')),
      footer: [
        deck ? h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: removeDeck }, 'Delete deck') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => Modal.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, deck ? 'Save changes' : 'Create deck'),
      ],
    });
  }

  // ---- Practice setup ----

  function openPractice(deckId) {
    const ids = new Set(Store.descendantIds(deckId));
    const tags = [...new Set(Store.state.notes.filter((n) => ids.has(n.deckId)).flatMap((n) => n.tags))].sort();
    const countInput = h('select', { id: 'practice-count' }, [['10', '10 cards'], ['20', '20 cards'], ['50', '50 cards'], ['all', 'All cards']].map(([value, label]) => h('option', { value }, label)));
    countInput.value = '20';
    const tagInput = h('select', { id: 'practice-tag' }, h('option', { value: '' }, 'Any tag'), tags.map((t) => h('option', { value: t }, t)));
    const start = () => {
      Modal.close();
      const query = new URLSearchParams({ n: countInput.value });
      if (tagInput.value) query.set('tag', tagInput.value);
      location.hash = `#/practice/${deckId}?${query}`;
    };
    Modal.open({
      title: 'Practice',
      body: h('div', { class: 'stack-form' },
        h('p', {}, 'Go through cards in random order. Practice never changes due dates, intervals or statistics.'),
        h('div', { class: 'field-row' }, field('How many', countInput), field('Tag', tagInput))),
      footer: [
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => Modal.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: start }, 'Start practice'),
      ],
    });
  }

  return { mount, openPractice };
})();
