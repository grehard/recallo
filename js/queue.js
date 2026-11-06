// Decides what a study session shows, applying the daily limits.
// A deck's limit caps its whole subtree: answers in a subdeck also use up the allowance
// of every deck above it, and a parent's remaining allowance caps what its subdecks offer.
const Queue = (() => {
  // A learning card this close to due may be shown early rather than ending the session.
  const LEARN_AHEAD_MS = 20 * MINUTE_MS;

  /** Precomputes today's usage and per-deck card lists, so a whole tree of counts is cheap. */
  function context(state, now) {
    const today = Dates.dayNumber(now);
    const parentOf = new Map(state.decks.map((d) => [d.id, d.parentId]));
    const notes = new Map(state.notes.map((n) => [n.id, n]));
    const cardsByDeck = new Map(state.decks.map((d) => [d.id, []]));
    const childrenByDeck = new Map(state.decks.map((d) => [d.id, []]));
    for (const d of state.decks) if (d.parentId) childrenByDeck.get(d.parentId).push(d);
    for (const list of childrenByDeck.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of state.cards) {
      const note = notes.get(c.noteId);
      if (note && cardsByDeck.has(note.deckId)) cardsByDeck.get(note.deckId).push(c);
    }

    const used = new Map(state.decks.map((d) => [d.id, { fresh: 0, review: 0 }]));
    const startOfToday = Dates.dayStart(today);
    for (const entry of state.log) {
      if (entry.ts < startOfToday || (entry.kind !== 'new' && entry.kind !== 'review')) continue;
      let deckId = entry.deckId;
      while (deckId && used.has(deckId)) {
        used.get(deckId)[entry.kind === 'new' ? 'fresh' : 'review'] += 1;
        deckId = parentOf.get(deckId);
      }
    }
    return { now, today, notes, parentOf, childrenByDeck, cardsByDeck, used, decks: new Map(state.decks.map((d) => [d.id, d])) };
  }

  function subtree(ctx, deckId) {
    const ids = [];
    const walk = (id) => {
      ids.push(id);
      ctx.childrenByDeck.get(id).forEach((d) => walk(d.id));
    };
    walk(deckId);
    return ids;
  }

  function allowanceLeft(ctx) {
    const left = new Map();
    for (const [id, deck] of ctx.decks) {
      const used = ctx.used.get(id);
      left.set(id, { fresh: Math.max(0, deck.newPerDay - used.fresh), review: Math.max(0, deck.reviewsPerDay - used.review) });
    }
    return left;
  }

  function pathUp(ctx, deckId) {
    const path = [];
    let current = deckId;
    while (current) { path.push(current); current = ctx.parentOf.get(current); }
    return path;
  }

  function takeWithinLimits(ctx, left, deckId, candidates, kind, out) {
    const path = pathUp(ctx, deckId);
    for (const card of candidates) {
      if (path.some((id) => left.get(id)[kind] <= 0)) break;
      path.forEach((id) => { left.get(id)[kind] -= 1; });
      out.push(card);
    }
  }

  /** The cards available right now for a deck and its subdecks, grouped by queue. */
  function build(ctx, deckId) {
    const left = allowanceLeft(ctx);
    const queue = { learningDue: [], learningLater: [], review: [], fresh: [] };
    if (!ctx.decks.has(deckId)) return queue;

    for (const id of subtree(ctx, deckId)) {
      const active = ctx.cardsByDeck.get(id).filter((c) => !c.suspended);
      for (const c of active) {
        if (c.state !== 'learning' && c.state !== 'relearning') continue;
        (c.due <= ctx.now ? queue.learningDue : queue.learningLater).push(c);
      }
      const reviews = active.filter((c) => c.state === 'review' && c.due <= ctx.today).sort((a, b) => a.due - b.due || a.seq - b.seq);
      takeWithinLimits(ctx, left, id, reviews, 'review', queue.review);
      // First cards of every note come first, so siblings don't arrive back to back.
      const rank = (c) => (ctx.notes.get(c.noteId).type === 'cloze' ? c.ord - 1 : c.ord);
      const fresh = active.filter((c) => c.state === 'new').sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
      takeWithinLimits(ctx, left, id, fresh, 'fresh', queue.fresh);
    }
    queue.learningDue.sort((a, b) => a.due - b.due);
    queue.learningLater.sort((a, b) => a.due - b.due);
    queue.review.sort((a, b) => a.due - b.due || a.seq - b.seq);
    return queue;
  }

  /** Next card to show, or null, with the time the next learning card comes due if any. */
  function next(state, deckId, now) {
    const queue = build(context(state, now), deckId);
    const ready = queue.learningDue[0] || queue.review[0] || queue.fresh[0];
    if (ready) return { card: ready, queue };
    const soon = queue.learningLater[0];
    if (soon && soon.due - now <= LEARN_AHEAD_MS) return { card: soon, queue };
    return { card: null, queue, waitingUntil: soon ? soon.due : null };
  }

  function counts(queue) {
    return {
      fresh: queue.fresh.length,
      learning: queue.learningDue.length + queue.learningLater.length,
      review: queue.review.length,
    };
  }

  /** Counts for every deck, keyed by id. */
  function allCounts(state, now) {
    const ctx = context(state, now);
    const result = new Map();
    for (const id of ctx.decks.keys()) result.set(id, counts(build(ctx, id)));
    return result;
  }

  function usage(state, deckId, now) {
    const ctx = context(state, now);
    const used = ctx.used.get(deckId) || { fresh: 0, review: 0 };
    const deck = ctx.decks.get(deckId);
    return { fresh: used.fresh, review: used.review, newLimit: deck.newPerDay, reviewLimit: deck.reviewsPerDay };
  }

  return { next, counts, allCounts, usage };
})();
