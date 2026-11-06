// Turns untrusted data (localStorage or an imported file) into a state the app can
// rely on. Bad records are dropped and counted rather than crashing the app.
const Validate = (() => {
  const CARD_STATES = ['new', 'learning', 'review', 'relearning'];
  const NOTE_TYPES = ['basic', 'reversible', 'cloze', 'typed'];
  const MAX_FIELD = 20000;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isId = (v) => typeof v === 'string' && v.length > 0 && v.length < 80;
  const number = (v, fallback, min, max) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const count = (v, fallback, max = 100000) => Math.round(number(v, fallback, 0, max));

  function steps(value, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    const clean = value.filter((n) => Number.isFinite(n) && n > 0 && n <= 14400);
    return clean.length ? clean : fallback.slice();
  }

  function settings(raw) {
    const base = Scheduler.DEFAULTS;
    const s = isObject(raw) ? raw : {};
    return {
      learningSteps: steps(s.learningSteps, base.learningSteps),
      relearningSteps: steps(s.relearningSteps, base.relearningSteps),
      graduatingInterval: count(s.graduatingInterval, base.graduatingInterval, 3650) || 1,
      easyInterval: count(s.easyInterval, base.easyInterval, 3650) || 1,
      startingEase: number(s.startingEase, base.startingEase, Scheduler.MIN_EASE, 5),
      leechThreshold: count(s.leechThreshold, base.leechThreshold, 1000),
    };
  }

  function decks(rawDecks, report) {
    const seen = new Set();
    const clean = [];
    for (const d of rawDecks) {
      if (!isObject(d) || !isId(d.id) || seen.has(d.id) || typeof d.name !== 'string' || !d.name.trim()) { report.dropped++; continue; }
      seen.add(d.id);
      clean.push({
        id: d.id,
        name: d.name.trim().slice(0, 120),
        parentId: isId(d.parentId) ? d.parentId : null,
        newPerDay: count(d.newPerDay, 20),
        reviewsPerDay: count(d.reviewsPerDay, 200),
      });
    }
    liftOrphans(clean);
    return clean;
  }

  // A missing parent or a parent cycle would hide a deck forever, so lift it to the top level.
  function liftOrphans(list) {
    const byId = new Map(list.map((d) => [d.id, d]));
    for (const d of list) {
      const visited = new Set([d.id]);
      let parent = d.parentId;
      while (parent) {
        if (!byId.has(parent) || visited.has(parent)) { d.parentId = null; break; }
        visited.add(parent);
        parent = byId.get(parent).parentId;
      }
    }
  }

  function notes(rawNotes, deckIds, report) {
    const seen = new Set();
    const clean = [];
    for (const n of rawNotes) {
      if (!isObject(n) || !isId(n.id) || seen.has(n.id) || !NOTE_TYPES.includes(n.type) || !deckIds.has(n.deckId) || typeof n.front !== 'string') { report.dropped++; continue; }
      seen.add(n.id);
      clean.push({
        id: n.id,
        type: n.type,
        deckId: n.deckId,
        front: n.front.slice(0, MAX_FIELD),
        back: typeof n.back === 'string' ? n.back.slice(0, MAX_FIELD) : '',
        tags: Array.isArray(n.tags) ? Cards.parseTags(n.tags.filter((t) => typeof t === 'string').join(' ')) : [],
        created: count(n.created, 0, Number.MAX_SAFE_INTEGER),
      });
    }
    return clean;
  }

  function card(c, startingEase) {
    const state = CARD_STATES.includes(c.state) ? c.state : 'new';
    return {
      id: c.id,
      noteId: c.noteId,
      ord: count(c.ord, 0, 999),
      seq: count(c.seq, 0, Number.MAX_SAFE_INTEGER),
      state,
      due: count(c.due, 0, Number.MAX_SAFE_INTEGER),
      interval: count(c.interval, state === 'review' ? 1 : 0, 36500),
      ease: number(c.ease, startingEase, Scheduler.MIN_EASE, 10),
      step: count(c.step, 0, 100),
      streak: count(c.streak, 0),
      reps: count(c.reps, 0),
      lapses: count(c.lapses, 0),
      suspended: c.suspended === true,
      leech: c.leech === true,
    };
  }

  function cards(rawCards, noteIds, startingEase, report) {
    const seen = new Set();
    const clean = [];
    for (const c of rawCards) {
      if (!isObject(c) || !isId(c.id) || seen.has(c.id) || !noteIds.has(c.noteId)) { report.dropped++; continue; }
      seen.add(c.id);
      clean.push(card(c, startingEase));
    }
    return clean;
  }

  function log(rawLog, report) {
    const clean = [];
    for (const e of Array.isArray(rawLog) ? rawLog : []) {
      if (!isObject(e) || !Number.isFinite(e.ts) || ![1, 2, 3, 4].includes(e.grade) || !isId(e.cardId)) { report.dropped++; continue; }
      clean.push({
        id: isId(e.id) ? e.id : `l${clean.length}`,
        cardId: e.cardId,
        deckId: isId(e.deckId) ? e.deckId : '',
        ts: e.ts,
        grade: e.grade,
        kind: CARD_STATES.includes(e.kind) ? e.kind : 'review',
        interval: count(e.interval, 0, 36500),
        ease: number(e.ease, 2.5, 0, 10),
        ms: count(e.ms, 0, 3600000),
      });
    }
    return clean;
  }

  function ui(raw) {
    const u = isObject(raw) ? raw : {};
    const collapsed = {};
    if (isObject(u.collapsed)) {
      for (const key of Object.keys(u.collapsed)) if (u.collapsed[key] === true) collapsed[key] = true;
    }
    return { collapsed, selectedDeck: isId(u.selectedDeck) ? u.selectedDeck : null };
  }

  /** Returns { state, dropped }, or throws an Error with a readable message if unusable. */
  function normalize(raw) {
    if (!isObject(raw)) throw new Error('This file does not contain a Recallo data object.');
    if (!Array.isArray(raw.decks) || !Array.isArray(raw.notes) || !Array.isArray(raw.cards)) {
      throw new Error('This file is missing the decks, notes or cards lists that a Recallo export has.');
    }
    const report = { dropped: 0 };
    const cleanSettings = settings(raw.settings);
    const cleanDecks = decks(raw.decks, report);
    const cleanNotes = notes(raw.notes, new Set(cleanDecks.map((d) => d.id)), report);
    const cleanCards = cards(raw.cards, new Set(cleanNotes.map((n) => n.id)), cleanSettings.startingEase, report);
    const state = {
      version: 1,
      decks: cleanDecks,
      notes: cleanNotes,
      cards: cleanCards,
      log: log(raw.log, report),
      settings: cleanSettings,
      ui: ui(raw.ui),
      seq: Math.max(count(raw.seq, 0, Number.MAX_SAFE_INTEGER), cleanCards.reduce((m, c) => Math.max(m, c.seq), 0)),
    };
    return { state, dropped: report.dropped };
  }

  return { normalize };
})();
