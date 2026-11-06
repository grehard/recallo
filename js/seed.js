// Builds the first-run collection by replaying months of study through the real
// scheduler, so every interval, ease and statistic is one the app could have produced.
// The random source is seeded: the same day always produces the same collection.
const Seed = (() => {
  const KEEP_NEW_SHARE = 0.16; // share of each deck still unseen today
  const STREAK_DAYS = 19; // no skipped days this close to today
  const DUE_SOON_DAYS = 8; // about half of the reviews this close are brought forward to today
  const MIN_DUE_PER_DECK = 6; // so every top-level deck has reviews waiting

  function randomSource(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TYPE_CODES = { b: 'basic', r: 'reversible', c: 'cloze', t: 'typed' };

  function shuffle(list, random) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /** Lays out decks, notes and blank cards from the content definition. */
  function buildCollection() {
    const state = {
      version: 1, decks: [], notes: [], cards: [], log: [],
      settings: { ...Scheduler.DEFAULTS, learningSteps: Scheduler.DEFAULTS.learningSteps.slice(), relearningSteps: Scheduler.DEFAULTS.relearningSteps.slice() },
      ui: { collapsed: {}, selectedDeck: null },
      seq: 0,
    };
    const groups = [];
    let nextId = 1;

    const addDeck = (def, parentId, group) => {
      const id = `seed-d${nextId++}`;
      state.decks.push({ id, name: def.name, parentId, newPerDay: def.newPerDay, reviewsPerDay: def.reviewsPerDay });
      for (const [code, front, back, tags] of def.notes || []) {
        const note = { id: `seed-n${nextId++}`, type: TYPE_CODES[code], deckId: id, front, back, tags: tags.split(' '), created: 0 };
        state.notes.push(note);
        for (const ord of Cards.ordinalsFor(note)) {
          state.seq += 1;
          const card = { id: `seed-c${nextId++}`, noteId: note.id, ord, seq: state.seq, suspended: false, leech: false, ...Scheduler.blankSchedule(state.settings) };
          state.cards.push(card);
          group.cards.push(card);
        }
      }
      for (const child of def.subdecks || []) addDeck(child, id, group);
    };
    for (const def of SEED_DECKS) {
      const group = { startDaysAgo: def.startDaysAgo, cards: [] };
      addDeck(def, null, group);
      groups.push(group);
    }
    return { state, groups };
  }

  class Simulator {
    constructor(state, groups, random) {
      this.state = state;
      this.groups = groups;
      this.random = random;
      this.notes = new Map(state.notes.map((n) => [n.id, n]));
      this.memory = new Map(); // card id -> how reliably this card is recalled
      this.logCounter = 0;
    }

    answer(card, grade, ts) {
      const result = Scheduler.answer(card, grade, ts, this.state.settings);
      Object.assign(card, result.card);
      this.state.log.push({
        id: `seed-l${this.logCounter++}`,
        cardId: card.id,
        deckId: this.notes.get(card.noteId).deckId,
        ts,
        grade,
        kind: result.kind,
        interval: card.state === 'review' ? card.interval : 0,
        ease: card.ease,
        ms: Math.round(2500 + this.random() * 11000),
      });
    }

    reliability(card) {
      if (!this.memory.has(card.id)) this.memory.set(card.id, 0.8 + this.random() * 0.17);
      return this.memory.get(card.id);
    }

    reviewGrade(card) {
      if (this.random() > this.reliability(card)) return Scheduler.GRADE.AGAIN;
      const roll = this.random();
      if (roll < 0.13) return Scheduler.GRADE.HARD;
      return roll < 0.9 ? Scheduler.GRADE.GOOD : Scheduler.GRADE.EASY;
    }

    // Works a learning card through its steps within one sitting.
    settle(card, clock) {
      let attempts = 0;
      while (card.state === 'learning' || card.state === 'relearning') {
        clock.ts += Math.max(0, card.due - clock.ts) + 20000;
        attempts += 1;
        const failed = attempts < 4 && this.random() > 0.82;
        this.answer(card, failed ? Scheduler.GRADE.AGAIN : Scheduler.GRADE.GOOD, clock.ts);
      }
    }

    studyReview(card, clock) {
      clock.ts += 8000 + this.random() * 16000;
      this.answer(card, this.reviewGrade(card), clock.ts);
      this.settle(card, clock);
    }

    introduce(card, clock) {
      clock.ts += 12000 + this.random() * 16000;
      const roll = this.random();
      const grade = roll < 0.25 ? Scheduler.GRADE.AGAIN : roll < 0.93 ? Scheduler.GRADE.GOOD : Scheduler.GRADE.EASY;
      const note = this.notes.get(card.noteId);
      if (!note.created) note.created = clock.ts;
      this.answer(card, grade, clock.ts);
      this.settle(card, clock);
    }

    reviewsDue(day) {
      const due = [];
      for (const group of this.groups) {
        for (const card of group.cards) if (card.state === 'review' && card.due <= day) due.push(card);
      }
      return due;
    }

    // Each deck introduces its cards at a steady rate from its start day, leaving some new.
    newCardsFor(group, daysAgo) {
      if (daysAgo > group.startDaysAgo || daysAgo < 1) return [];
      const planned = Math.round(group.order.length * (1 - KEEP_NEW_SHARE));
      const span = group.startDaysAgo;
      const target = Math.min(planned, Math.ceil(planned * (span - daysAgo + 1) / span));
      const out = group.order.slice(group.introduced, target);
      group.introduced = Math.max(group.introduced, target);
      return out;
    }

    runDay(day, daysAgo) {
      const weekend = [0, 6].includes(Dates.toDate(day).getDay());
      const skip = daysAgo > STREAK_DAYS && this.random() < (weekend ? 0.42 : 0.09);
      if (skip) return;
      const clock = { ts: Dates.dayStart(day) + (7.5 + this.random() * 12) * 3600000 };
      for (const card of this.reviewsDue(day)) this.studyReview(card, clock);
      for (const group of this.groups) {
        for (const card of this.newCardsFor(group, daysAgo)) this.introduce(card, clock);
      }
    }

    // Part of today's work is already done, stamped between midnight and now.
    runPartOfToday(today, now) {
      for (const group of this.groups) this.bringForward(group, today);
      const start = Dates.dayStart(today);
      const due = this.reviewsDue(today).filter((_, index) => index % 3 === 0); // a spread across decks
      const clock = { ts: start };
      const gap = Math.max(1000, (now - start) / (due.length + 2));
      for (const card of due) {
        clock.ts += gap;
        this.answer(card, this.reviewGrade(card), clock.ts);
      }
    }

    // The simulation ends on a learner who is up to date. Bringing some reviews forward
    // gives a first-time visitor something to study straight away.
    bringForward(group, today) {
      const reviews = group.cards.filter((c) => c.state === 'review').sort((a, b) => a.due - b.due);
      reviews.forEach((card, index) => {
        const soon = card.due <= today + DUE_SOON_DAYS && this.random() < 0.5;
        if (soon || index < MIN_DUE_PER_DECK) card.due = Math.min(card.due, today);
      });
    }

    run(now) {
      const today = Dates.dayNumber(now);
      for (const group of this.groups) {
        group.order = shuffle(group.cards.slice(), this.random);
        group.introduced = 0;
      }
      const longest = Math.max(...this.groups.map((g) => g.startDaysAgo));
      for (let daysAgo = longest; daysAgo >= 1; daysAgo--) this.runDay(today - daysAgo, daysAgo);
      this.runPartOfToday(today, now);
    }
  }

  function findCard(state, frontStart, ord = 0) {
    const note = state.notes.find((n) => n.front.startsWith(frontStart));
    return note ? state.cards.find((c) => c.noteId === note.id && c.ord === ord) : null;
  }

  function markTroubleCards(state, today) {
    // Ser and estar keep tripping this learner: one more lapse will make it a leech.
    const nearLeech = findCard(state, 'Hoy {{c1::estoy', 1);
    if (nearLeech) Object.assign(nearLeech, { state: 'review', interval: 4, ease: 1.3, streak: 2, lapses: 7, reps: 26, due: today });

    // An earlier leech, already suspended and tagged.
    const leech = findCard(state, 'Capital of Moldova');
    if (leech) {
      Object.assign(leech, { state: 'review', interval: 2, ease: 1.3, streak: 1, lapses: 8, reps: 30, due: today + 2, leech: true, suspended: true });
      state.notes.find((n) => n.id === leech.noteId).tags.push('leech');
    }
    const parked = findCard(state, 'What does `min-width: 0`');
    if (parked) parked.suspended = true;
  }

  function build(now) {
    const { state, groups } = buildCollection();
    const random = randomSource(20241107);
    new Simulator(state, groups, random).run(now);
    markTroubleCards(state, Dates.dayNumber(now));
    // Two branches start folded, so the whole list fits on one screen.
    for (const deck of state.decks) {
      if (deck.name === 'World capitals' || deck.name === 'JavaScript') state.ui.collapsed[deck.id] = true;
    }
    return state;
  }

  return { build };
})();
