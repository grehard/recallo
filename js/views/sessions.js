// The two kinds of study session share one interface, so the study screen can't
// accidentally treat practice as scheduled review.
//   next(now)         -> { card, waitingUntil }
//   counts(now)       -> numbers for the header, or null
//   options(card, now)-> label under each grade button
//   answer(card, grade, now, ms) -> { becameLeech }
//   undo()            -> the card id to show again, or null
const Sessions = (() => {
  function review(deckId) {
    const undoStack = [];
    let forcedCardId = null;
    const summary = { answered: 0, passed: 0, started: Date.now() };

    return {
      kind: 'review',
      deckId,
      summary,
      canUndo: () => undoStack.length > 0,

      next(now) {
        if (forcedCardId) {
          const forced = Store.card(forcedCardId);
          forcedCardId = null;
          if (forced) return { card: forced };
        }
        return Queue.next(Store.state, deckId, now);
      },

      counts(now) {
        return Queue.counts(Queue.next(Store.state, deckId, now).queue);
      },

      options(card, now) {
        return Scheduler.previewAll(card, now, Store.state.settings);
      },

      answer(card, grade, now, ms) {
        const { undo, becameLeech } = Store.recordAnswer(card.id, grade, now, ms);
        const passed = grade > Scheduler.GRADE.AGAIN;
        undoStack.push({ undo, passed });
        summary.answered++;
        if (passed) summary.passed++;
        return { becameLeech };
      },

      undo() {
        const last = undoStack.pop();
        if (!last) return null;
        Store.undoAnswer(last.undo);
        summary.answered--;
        if (last.passed) summary.passed--;
        forcedCardId = last.undo.cardBefore.id;
        return forcedCardId;
      },
    };
  }

  function shuffled(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // Works from an in-memory list and never touches the store, which is what guarantees
  // practice can't affect scheduling.
  function practice(deckId, { limit, tag }) {
    const deckIds = new Set(Store.descendantIds(deckId));
    const notes = new Map(Store.state.notes.filter((n) => deckIds.has(n.deckId) && (!tag || n.tags.includes(tag))).map((n) => [n.id, n]));
    const pool = shuffled(Store.state.cards.filter((c) => notes.has(c.noteId) && !c.suspended));
    let queue = pool.slice(0, limit || pool.length).map((c) => c.id);
    const undoStack = [];
    const summary = { answered: 0, passed: 0, started: Date.now(), total: queue.length };
    const REQUEUE_GAP = { [Scheduler.GRADE.AGAIN]: 3, [Scheduler.GRADE.HARD]: 6 };

    return {
      kind: 'practice',
      deckId,
      summary,
      canUndo: () => undoStack.length > 0,

      next() {
        // A card can be deleted from the editor mid-session.
        while (queue.length && !Store.card(queue[0])) queue.shift();
        return { card: queue.length ? Store.card(queue[0]) : null };
      },

      counts() {
        return { remaining: queue.length };
      },

      options() {
        return [
          { grade: 1, label: 'see soon' },
          { grade: 2, label: 'see later' },
          { grade: 3, label: 'done' },
          { grade: 4, label: 'done' },
        ];
      },

      answer(card, grade) {
        undoStack.push({ queue: queue.slice(), passed: grade > Scheduler.GRADE.AGAIN });
        queue = queue.slice(1);
        const gap = REQUEUE_GAP[grade];
        if (gap) queue.splice(Math.min(gap, queue.length), 0, card.id);
        summary.answered++;
        if (grade > Scheduler.GRADE.AGAIN) summary.passed++;
        return { becameLeech: false };
      },

      undo() {
        const last = undoStack.pop();
        if (!last) return null;
        queue = last.queue;
        summary.answered--;
        if (last.passed) summary.passed--;
        return queue[0];
      },
    };
  }

  return { review, practice };
})();
