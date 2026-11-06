// Card browser: search and filter every card, then tag, move, suspend or delete in bulk.
const BrowseView = (() => {
  const PAGE_SIZE = 60;
  const STATE_FILTERS = [
    ['', 'Any state'], ['new', 'New'], ['learning', 'Learning'], ['review', 'Review'],
    ['due', 'Due today'], ['suspended', 'Suspended'], ['leech', 'Leeches'],
  ];
  const COLUMNS = {
    question: { label: 'Question', sort: (r) => r.question.toLowerCase() },
    answer: { label: 'Answer', sort: (r) => r.answer.toLowerCase() },
    deck: { label: 'Deck', sort: (r) => r.deckPath.toLowerCase() },
    due: { label: 'Due', sort: (r) => r.dueSort },
    interval: { label: 'Interval', sort: (r) => r.card.interval },
    ease: { label: 'Ease', sort: (r) => r.card.ease },
    lapses: { label: 'Lapses', sort: (r) => r.card.lapses },
  };

  let root = null;
  let filters = null;
  let selected = new Set();
  let sort = { key: 'due', dir: 1 };
  let shown = PAGE_SIZE;
  let resultsHost = null;
  let bulkHost = null;

  function mount(container, params) {
    root = container;
    filters = { text: params.query.q || '', deck: params.query.deck || '', state: params.query.state || '', type: '', tag: params.query.tag || '' };
    if (filters.deck && !Store.deck(filters.deck)) filters.deck = '';
    selected = new Set();
    shown = PAGE_SIZE;
    render();
  }

  function render() {
    resultsHost = h('div', { class: 'browse-results' });
    bulkHost = h('div', { class: 'bulk-host' });
    root.replaceChildren(h('div', { class: 'browse-page' },
      h('header', { class: 'page-head' },
        h('h1', {}, 'Browse'),
        h('div', { class: 'button-row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => NoteEditor.open({ deckId: filters.deck || Store.state.ui.selectedDeck || firstDeckId(), onSaved: refreshAll }), disabled: !Store.state.decks.length }, icon('plus'), 'Add card'))),
      filterBar(),
      bulkHost,
      resultsHost));
    refresh();
  }

  const firstDeckId = () => (Store.deckList()[0] ? Store.deckList()[0].deck.id : '');

  function refreshAll() {
    pruneSelection();
    render();
  }

  function pruneSelection() {
    const existing = new Set(Store.state.cards.map((c) => c.id));
    selected = new Set([...selected].filter((id) => existing.has(id)));
  }

  function filterBar() {
    const setFilter = (key) => (event) => {
      filters[key] = event.target.value;
      shown = PAGE_SIZE;
      refresh();
    };
    const search = h('input', {
      type: 'search', id: 'browse-search', value: filters.text, autocomplete: 'off',
      placeholder: 'Search text, or tag:verbs deck:food', oninput: setFilter('text'),
    });
    const deck = deckSelect(filters.deck, { includeAll: 'All decks', id: 'browse-deck' });
    deck.addEventListener('change', setFilter('deck'));
    const state = h('select', { id: 'browse-state', onchange: setFilter('state') }, STATE_FILTERS.map(([value, label]) => h('option', { value }, label)));
    state.value = filters.state;
    const type = h('select', { id: 'browse-type', onchange: setFilter('type') }, h('option', { value: '' }, 'Any type'), Object.entries(Cards.TYPES).map(([value, def]) => h('option', { value }, def.label)));
    type.value = filters.type;
    const tag = h('select', { id: 'browse-tag', onchange: setFilter('tag') }, h('option', { value: '' }, 'Any tag'), Store.allTags().map((t) => h('option', { value: t }, t)));
    tag.value = filters.tag;
    return h('div', { class: 'filter-bar', role: 'search' },
      h('div', { class: 'filter-search' }, h('label', { class: 'sr-only', for: 'browse-search' }, 'Search cards'), icon('search'), search),
      h('label', { class: 'sr-only', for: 'browse-deck' }, 'Filter by deck'), deck,
      h('label', { class: 'sr-only', for: 'browse-state' }, 'Filter by state'), state,
      h('label', { class: 'sr-only', for: 'browse-type' }, 'Filter by card type'), type,
      h('label', { class: 'sr-only', for: 'browse-tag' }, 'Filter by tag'), tag);
  }

  // ---- Filtering ----

  const fold = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function parseQuery(text) {
    const query = { terms: [], tags: [], decks: [] };
    for (const word of text.trim().split(/\s+/).filter(Boolean)) {
      if (word.startsWith('tag:') && word.length > 4) query.tags.push(fold(word.slice(4)));
      else if (word.startsWith('deck:') && word.length > 5) query.decks.push(fold(word.slice(5)));
      else query.terms.push(fold(word));
    }
    return query;
  }

  function buildRows() {
    const today = Dates.today();
    const notes = new Map(Store.state.notes.map((n) => [n.id, n]));
    const paths = new Map(Store.deckList().map((d) => [d.deck.id, d.path]));
    return Store.state.cards.map((card) => {
      const note = notes.get(card.noteId);
      return {
        card, note,
        question: Cards.questionText(note, card),
        answer: Cards.answerText(note, card),
        deckPath: paths.get(note.deckId) || '',
        dueSort: dueSortValue(card, today),
      };
    });
  }

  // New cards sort last; learning cards count as due now.
  function dueSortValue(card, today) {
    if (card.state === 'new') return Number.MAX_SAFE_INTEGER;
    return card.state === 'review' ? card.due : today - 1;
  }

  function matchesState(row, state, today) {
    const { card } = row;
    switch (state) {
      case 'new': return card.state === 'new' && !card.suspended;
      case 'learning': return (card.state === 'learning' || card.state === 'relearning') && !card.suspended;
      case 'review': return card.state === 'review' && !card.suspended;
      case 'due': return !card.suspended && ((card.state === 'review' && card.due <= today) || card.state === 'learning' || card.state === 'relearning');
      case 'suspended': return card.suspended;
      case 'leech': return card.leech;
      default: return true;
    }
  }

  function filteredRows() {
    const query = parseQuery(filters.text);
    const today = Dates.today();
    const deckIds = filters.deck ? new Set(Store.descendantIds(filters.deck)) : null;
    const rows = buildRows().filter((row) => {
      if (deckIds && !deckIds.has(row.note.deckId)) return false;
      if (filters.type && row.note.type !== filters.type) return false;
      if (filters.tag && !row.note.tags.includes(filters.tag)) return false;
      if (!matchesState(row, filters.state, today)) return false;
      if (query.decks.some((d) => !fold(row.deckPath).includes(d))) return false;
      if (query.tags.some((t) => !row.note.tags.some((tag) => fold(tag).includes(t)))) return false;
      if (!query.terms.length) return true;
      const haystack = fold(`${row.note.front} ${row.note.back} ${row.note.tags.join(' ')}`);
      return query.terms.every((term) => haystack.includes(term));
    });
    const key = COLUMNS[sort.key].sort;
    return rows.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x < y ? -1 : x > y ? 1 : a.card.seq - b.card.seq) * sort.dir;
    });
  }

  // ---- Results table ----

  function refresh() {
    const rows = filteredRows();
    renderBulk(rows);
    if (!rows.length) {
      resultsHost.replaceChildren(h('div', { class: 'empty empty-small' },
        h('p', {}, Store.state.cards.length ? 'No cards match these filters.' : 'There are no cards yet.'),
        h('button', { class: 'btn', type: 'button', hidden: !Store.state.cards.length, onclick: clearFilters }, 'Clear filters')));
      return;
    }
    const visible = rows.slice(0, shown);
    resultsHost.replaceChildren(
      h('p', { class: 'result-count', 'aria-live': 'polite', 'data-testid': 'result-count' }, plural(rows.length, 'card')),
      h('div', { class: 'table-scroll browse-scroll' }, h('table', { class: 'browse-table' },
        h('thead', {}, h('tr', {},
          h('th', { class: 'cell-check', scope: 'col' }, selectAllBox(rows)),
          Object.keys(COLUMNS).map(headerCell),
          h('th', { scope: 'col' }, 'Tags'))),
        h('tbody', {}, visible.map(rowNode)))),
      h('button', { class: 'btn btn-block load-more', type: 'button', hidden: rows.length <= shown, onclick: () => { shown += PAGE_SIZE; refresh(); } }, `Show ${Math.min(PAGE_SIZE, rows.length - shown)} more`));
  }

  function clearFilters() {
    filters = { text: '', deck: '', state: '', type: '', tag: '' };
    render();
  }

  function selectAllBox(rows) {
    const allOn = rows.length > 0 && rows.every((r) => selected.has(r.card.id));
    const box = h('input', { type: 'checkbox', 'aria-label': `Select all ${rows.length} matching cards`, checked: allOn, onchange: (e) => {
      for (const r of rows) { if (e.target.checked) selected.add(r.card.id); else selected.delete(r.card.id); }
      refresh();
    } });
    box.indeterminate = !allOn && rows.some((r) => selected.has(r.card.id));
    return box;
  }

  function headerCell(key) {
    const active = sort.key === key;
    return h('th', { scope: 'col', 'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : null },
      h('button', { class: 'th-sort', type: 'button', onclick: () => {
        sort = active ? { key, dir: -sort.dir } : { key, dir: 1 };
        refresh();
      } }, COLUMNS[key].label, active ? h('span', { class: 'sort-mark', 'aria-hidden': 'true' }, sort.dir > 0 ? ' ▲' : ' ▼') : null));
  }

  function dueText(card, today) {
    if (card.state === 'new') return 'New';
    if (card.state !== 'review') return card.state === 'learning' ? 'Learning' : 'Relearning';
    return Dates.relativeDay(card.due, today);
  }

  function rowNode(row) {
    const { card, note } = row;
    const today = Dates.today();
    const toggle = (e) => {
      if (e.target.checked) selected.add(card.id); else selected.delete(card.id);
      refresh();
    };
    return h('tr', { class: card.suspended ? 'is-suspended' : null, 'data-card': card.id },
      h('td', { class: 'cell-check' }, h('input', { type: 'checkbox', 'aria-label': `Select ${row.question.slice(0, 60)}`, checked: selected.has(card.id), onchange: toggle })),
      h('td', { class: 'cell-text' }, h('button', { class: 'link-btn', type: 'button', title: 'Edit note', onclick: () => NoteEditor.open({ noteId: note.id, onSaved: refreshAll }) }, renderInlineCode(row.question))),
      h('td', { class: 'cell-text' }, renderInlineCode(row.answer)),
      h('td', { class: 'cell-deck', title: row.deckPath }, row.deckPath),
      h('td', { class: 'cell-nowrap' }, card.suspended ? h('span', { class: 'chip chip-muted' }, card.leech ? 'Leech' : 'Suspended') : dueText(card, today)),
      h('td', { class: 'cell-num' }, card.state === 'review' ? Dates.shortDays(card.interval) : '-'),
      h('td', { class: 'cell-num' }, `${Math.round(card.ease * 100)}%`),
      h('td', { class: 'cell-num' }, card.lapses),
      h('td', { class: 'cell-tags' }, note.tags.slice(0, 4).map((t) => h('span', { class: 'chip' }, t)), note.tags.length > 4 ? h('span', { class: 'chip chip-muted' }, `+${note.tags.length - 4}`) : null));
  }

  // ---- Bulk actions ----

  function renderBulk() {
    bulkHost.replaceChildren();
    const count = selected.size;
    if (!count) return;
    const ids = () => [...selected];
    const act = (message, change) => Toast.withUndo(message, change, refreshAll);
    bulkHost.append(h('div', { class: 'bulk-bar', role: 'toolbar', 'aria-label': 'Actions for selected cards' },
      h('strong', {}, `${plural(count, 'card')} selected`),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => openTagModal(ids()) }, 'Tag'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => openMoveModal(ids()) }, 'Move'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => act(`Suspended ${plural(count, 'card')}`, () => Store.setSuspended(ids(), true)) }, 'Suspend'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => act(`Unsuspended ${plural(count, 'card')}`, () => Store.setSuspended(ids(), false)) }, 'Unsuspend'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => act(`Reset ${plural(count, 'card')} to new`, () => Store.forgetCards(ids())) }, 'Make new'),
      h('button', { class: 'btn btn-small btn-danger-quiet', type: 'button', onclick: () => deleteSelected(ids()) }, 'Delete'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => { selected.clear(); refresh(); } }, 'Clear selection')));
  }

  function deleteSelected(cardIds) {
    const noteIds = [...new Set(cardIds.map((id) => Store.card(id).noteId))];
    Toast.withUndo(`Deleted ${plural(noteIds.length, 'note')}`, () => Store.deleteNotes(noteIds), refreshAll);
  }

  function openTagModal(cardIds) {
    const input = h('input', { type: 'text', id: 'bulk-tag', 'data-autofocus': true, autocomplete: 'off', list: 'bulk-tag-list' });
    const wrap = field('Tags', input, { hint: 'Separate tags with commas or spaces. Tags apply to the whole note.' });
    const apply = (remove) => {
      const tags = Cards.parseTags(input.value);
      if (!tags.length) { wrap.setError('Enter at least one tag.'); input.focus(); return; }
      Modal.close();
      const verb = remove ? 'Removed' : 'Added';
      Toast.withUndo(`${verb} ${tags.join(', ')} on ${plural(cardIds.length, 'card')}`, () => (remove ? Store.removeTags(cardIds, tags) : Store.addTags(cardIds, tags)), refreshAll);
    };
    Modal.open({
      title: `Tag ${plural(cardIds.length, 'card')}`,
      body: h('form', { class: 'stack-form', onsubmit: (e) => { e.preventDefault(); apply(false); } }, wrap,
        h('datalist', { id: 'bulk-tag-list' }, Store.allTags().map((t) => h('option', { value: t })))),
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => apply(true) }, 'Remove tags'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => Modal.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => apply(false) }, 'Add tags'),
      ],
    });
  }

  function openMoveModal(cardIds) {
    const select = deckSelect(filters.deck || firstDeckId(), { id: 'bulk-deck' });
    const apply = () => {
      const deckId = select.value;
      Modal.close();
      Toast.withUndo(`Moved to ${Store.deckPath(deckId)}`, () => Store.moveCards(cardIds, deckId), refreshAll);
    };
    Modal.open({
      title: `Move ${plural(cardIds.length, 'card')}`,
      body: h('div', { class: 'stack-form' }, field('Destination deck', select, { hint: 'Cards from one note stay together, so sibling cards move too.' })),
      footer: [
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => Modal.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: apply }, 'Move cards'),
      ],
    });
  }

  return { mount };
})();
