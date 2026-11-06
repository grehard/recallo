// Single source of truth for the collection, with every mutation in one place.
// All writes go through save(), which tolerates blocked or full storage by carrying
// on in memory.
const Store = (() => {
  const KEY = 'recallo.collection.v1';
  let state = null;
  let storageOk = true;
  let idCounter = 0;

  const uid = (prefix) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (err) {
      storageOk = false;
    }
  }

  /** Loads the saved collection. Returns 'loaded', 'seeded' or 'recovered' (data was corrupt). */
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (err) {
      storageOk = false;
    }
    if (raw) {
      try {
        state = Validate.normalize(JSON.parse(raw)).state;
        return 'loaded';
      } catch (err) {
        state = Seed.build(Date.now());
        save();
        return 'recovered';
      }
    }
    state = Seed.build(Date.now());
    save();
    return 'seeded';
  }

  const snapshot = () => JSON.stringify(state);

  function restore(json) {
    state = JSON.parse(json);
    save();
  }

  function replace(next) {
    state = next;
    save();
  }

  function resetDemo() {
    state = Seed.build(Date.now());
    save();
  }

  // ---- Lookups ----

  const deck = (id) => state.decks.find((d) => d.id === id) || null;
  const note = (id) => state.notes.find((n) => n.id === id) || null;
  const card = (id) => state.cards.find((c) => c.id === id) || null;

  const childrenOf = (parentId) => state.decks
    .filter((d) => d.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));

  function descendantIds(id) {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) {
      for (const child of childrenOf(ids[i])) ids.push(child.id);
    }
    return ids;
  }

  function deckPath(id) {
    const names = [];
    let current = deck(id);
    while (current) {
      names.unshift(current.name);
      current = deck(current.parentId);
    }
    return names.join(' › ');
  }

  /** Every deck in tree order, with its depth and full path. */
  function deckList() {
    const list = [];
    const walk = (parentId, depth) => {
      for (const d of childrenOf(parentId)) {
        list.push({ deck: d, depth, path: deckPath(d.id) });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    return list;
  }

  function allTags() {
    const tags = new Set();
    for (const n of state.notes) for (const t of n.tags) tags.add(t);
    return [...tags].sort();
  }

  // ---- Decks ----

  /** Returns an error message for a deck name, or null if it is usable. */
  function deckNameError(name, parentId, ignoreId = null) {
    const clean = name.trim();
    if (!clean) return 'Give the deck a name.';
    if (clean.length > 120) return 'Keep the name under 120 characters.';
    const taken = childrenOf(parentId).some((d) => d.id !== ignoreId && d.name.toLowerCase() === clean.toLowerCase());
    return taken ? 'A deck with this name already exists here.' : null;
  }

  function createDeck({ name, parentId = null, newPerDay = 20, reviewsPerDay = 200 }) {
    const created = { id: uid('d'), name: name.trim(), parentId, newPerDay, reviewsPerDay };
    state.decks.push(created);
    save();
    return created;
  }

  function updateDeck(id, changes) {
    Object.assign(deck(id), changes);
    save();
  }

  function deleteDeck(id) {
    const ids = new Set(descendantIds(id));
    const noteIds = new Set(state.notes.filter((n) => ids.has(n.deckId)).map((n) => n.id));
    state.decks = state.decks.filter((d) => !ids.has(d.id));
    state.notes = state.notes.filter((n) => !noteIds.has(n.id));
    state.cards = state.cards.filter((c) => !noteIds.has(c.noteId));
    if (ids.has(state.ui.selectedDeck)) state.ui.selectedDeck = null;
    save();
  }

  /** Finds or creates a nested deck from a path such as "Spanish basics::Food". */
  function ensureDeckPath(path, rootParent = null) {
    let parentId = rootParent;
    for (const part of String(path).split(/::|›|>/).map((p) => p.trim()).filter(Boolean)) {
      const existing = childrenOf(parentId).find((d) => d.name.toLowerCase() === part.toLowerCase());
      parentId = existing ? existing.id : createDeck({ name: part.slice(0, 120), parentId }).id;
    }
    return parentId;
  }

  function setUi(changes) {
    Object.assign(state.ui, changes);
    save();
  }

  // ---- Notes and cards ----

  function newCard(noteId, ord) {
    state.seq += 1;
    return { id: uid('c'), noteId, ord, seq: state.seq, suspended: false, leech: false, ...Scheduler.blankSchedule(state.settings) };
  }

  // Keeps cards that still apply and adds or removes only what changed, so correcting
  // a typo in a cloze never resets its schedule.
  function syncCards(target) {
    const wanted = Cards.ordinalsFor(target);
    state.cards = state.cards.filter((c) => c.noteId !== target.id || wanted.includes(c.ord));
    const have = new Set(state.cards.filter((c) => c.noteId === target.id).map((c) => c.ord));
    for (const ord of wanted) if (!have.has(ord)) state.cards.push(newCard(target.id, ord));
  }

  function addNote({ type, front, back, deckId, tags = [] }) {
    const created = { id: uid('n'), type, deckId, front: front.trim(), back: back.trim(), tags, created: Date.now() };
    state.notes.push(created);
    syncCards(created);
    save();
    return created;
  }

  function updateNote(id, changes) {
    const target = note(id);
    Object.assign(target, changes);
    syncCards(target);
    save();
  }

  function deleteNotes(ids) {
    const gone = new Set(ids);
    state.notes = state.notes.filter((n) => !gone.has(n.id));
    state.cards = state.cards.filter((c) => !gone.has(c.noteId));
    save();
  }

  function notesOfCards(cardIds) {
    const wanted = new Set(cardIds);
    return [...new Set(state.cards.filter((c) => wanted.has(c.id)).map((c) => c.noteId))];
  }

  function addTags(cardIds, tags) {
    for (const id of notesOfCards(cardIds)) {
      const target = note(id);
      target.tags = [...new Set([...target.tags, ...tags])];
    }
    save();
  }

  function removeTags(cardIds, tags) {
    for (const id of notesOfCards(cardIds)) {
      const target = note(id);
      target.tags = target.tags.filter((t) => !tags.includes(t));
    }
    save();
  }

  function moveCards(cardIds, deckId) {
    const noteIds = notesOfCards(cardIds);
    for (const id of noteIds) note(id).deckId = deckId;
    save();
    return noteIds.length;
  }

  function setSuspended(cardIds, suspended) {
    const wanted = new Set(cardIds);
    for (const c of state.cards) {
      if (!wanted.has(c.id)) continue;
      c.suspended = suspended;
      if (!suspended) c.leech = false;
    }
    save();
  }

  function forgetCards(cardIds) {
    const wanted = new Set(cardIds);
    state.cards = state.cards.map((c) => (wanted.has(c.id)
      ? { ...c, ...Scheduler.blankSchedule(state.settings), leech: false, suspended: false }
      : c));
    save();
  }

  function setSettings(changes) {
    Object.assign(state.settings, changes);
    save();
  }

  /** Writes one graded answer. Returns the leech flag and what is needed to undo it. */
  function recordAnswer(cardId, grade, now, ms) {
    const index = state.cards.findIndex((c) => c.id === cardId);
    const before = state.cards[index];
    const target = note(before.noteId);
    const undo = { cardBefore: before, noteId: target.id, tagsBefore: target.tags.slice(), logId: uid('l') };
    const result = Scheduler.answer(before, grade, now, state.settings);

    if (result.becameLeech) {
      result.card.leech = true;
      result.card.suspended = true;
      if (!target.tags.includes('leech')) target.tags = [...target.tags, 'leech'];
    }
    state.cards[index] = result.card;
    state.log.push({
      id: undo.logId,
      cardId,
      deckId: target.deckId,
      ts: now,
      grade,
      kind: result.kind,
      interval: result.card.state === 'review' ? result.card.interval : 0,
      ease: result.card.ease,
      ms: Math.min(ms, 60000),
    });
    save();
    return { undo, becameLeech: result.becameLeech };
  }

  function undoAnswer({ cardBefore, noteId, tagsBefore, logId }) {
    const index = state.cards.findIndex((c) => c.id === cardBefore.id);
    if (index >= 0) state.cards[index] = cardBefore;
    const target = note(noteId);
    if (target) target.tags = tagsBefore;
    state.log = state.log.filter((e) => e.id !== logId);
    save();
  }

  // ---- Export and import ----

  function exportJson() {
    return JSON.stringify({ app: 'recallo', exportedAt: new Date(Date.now()).toISOString(), ...state });
  }

  /** Adds whatever is not already present, matching records by id. */
  function merge(incoming) {
    const addMissing = (key) => {
      const existing = new Set(state[key].map((item) => item.id));
      const fresh = incoming[key].filter((item) => !existing.has(item.id));
      state[key] = state[key].concat(fresh);
      return fresh.length;
    };
    const added = { decks: addMissing('decks'), notes: addMissing('notes'), cards: addMissing('cards') };
    addMissing('log');
    state.seq = Math.max(state.seq, incoming.seq);
    save();
    return added;
  }

  return {
    get state() { return state; },
    get storageOk() { return storageOk; },
    load, save, snapshot, restore, replace, resetDemo,
    deck, note, card, childrenOf, descendantIds, deckPath, deckList, allTags,
    deckNameError, createDeck, updateDeck, deleteDeck, ensureDeckPath, setUi,
    addNote, updateNote, deleteNotes, addTags, removeTags, moveCards, setSuspended, forgetCards, setSettings,
    recordAnswer, undoAnswer, exportJson, merge,
  };
})();
