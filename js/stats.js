// Computes everything the statistics page shows, from the review log and card states.
const Stats = (() => {
  const INTERVAL_BUCKETS = [
    { label: '1d', max: 1 },
    { label: '2-3d', max: 3 },
    { label: '4-7d', max: 7 },
    { label: '8-14d', max: 14 },
    { label: '15-30d', max: 30 },
    { label: '1-2mo', max: 60 },
    { label: '2-3mo', max: 90 },
    { label: '3-6mo', max: 180 },
    { label: '6-12mo', max: 365 },
    { label: '1y+', max: Infinity },
  ];
  const MATURE_DAYS = 21;

  function scope(state, deckId) {
    const deckIds = deckId ? new Set(Store.descendantIds(deckId)) : null;
    const notes = new Map(state.notes.map((n) => [n.id, n]));
    const cards = state.cards.filter((c) => {
      const note = notes.get(c.noteId);
      return note && (!deckIds || deckIds.has(note.deckId));
    });
    const log = deckIds ? state.log.filter((e) => deckIds.has(e.deckId)) : state.log;
    return { cards, log };
  }

  function reviewsByDay(log) {
    const days = new Map();
    for (const entry of log) {
      const day = Dates.dayNumber(entry.ts);
      days.set(day, (days.get(day) || 0) + 1);
    }
    return days;
  }

  function streak(days, today) {
    let cursor = days.has(today) ? today : today - 1;
    let length = 0;
    while (days.has(cursor)) { length++; cursor--; }
    return length;
  }

  /** Share of due reviews recalled (anything but Again). Null when there are no reviews. */
  function retention(log, fromTs, toTs = Infinity) {
    let total = 0;
    let passed = 0;
    for (const entry of log) {
      if (entry.kind !== 'review' || entry.ts < fromTs || entry.ts >= toTs) continue;
      total++;
      if (entry.grade > 1) passed++;
    }
    return { total, passed, rate: total ? passed / total : null };
  }

  function weeklyRetention(log, today, weeks = 16) {
    const points = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const endDay = today - i * 7 + 1;
      const result = retention(log, Dates.dayStart(endDay - 7), Dates.dayStart(endDay));
      points.push({ endDay: endDay - 1, ...result });
    }
    return points;
  }

  /** Cards due on each of the next 30 days. Anything overdue counts toward today. */
  function forecast(cards, now, days = 30) {
    const today = Dates.dayNumber(now);
    const counts = new Array(days).fill(0);
    for (const card of cards) {
      if (card.suspended || card.state === 'new') continue;
      const dueDay = card.state === 'review' ? card.due : Dates.dayNumber(card.due);
      const offset = Math.max(0, dueDay - today);
      if (offset < days) counts[offset]++;
    }
    return counts.map((count, offset) => ({ day: today + offset, offset, count }));
  }

  function intervalDistribution(cards) {
    const buckets = INTERVAL_BUCKETS.map((b) => ({ ...b, count: 0 }));
    for (const card of cards) {
      if (card.state !== 'review' || card.suspended) continue;
      buckets.find((b) => card.interval <= b.max).count++;
    }
    return buckets;
  }

  function cardStates(cards) {
    const out = { fresh: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
    for (const card of cards) {
      if (card.suspended) out.suspended++;
      else if (card.state === 'new') out.fresh++;
      else if (card.state !== 'review') out.learning++;
      else if (card.interval < MATURE_DAYS) out.young++;
      else out.mature++;
    }
    return out;
  }

  function compute(state, deckId, now) {
    const { cards, log } = scope(state, deckId);
    const today = Dates.dayNumber(now);
    const days = reviewsByDay(log);
    const window30 = Dates.dayStart(today - 29);
    const recent = log.filter((e) => e.ts >= window30);
    return {
      today,
      days,
      totalCards: cards.length,
      reviewsToday: days.get(today) || 0,
      reviews30: recent.length,
      activeDays30: new Set(recent.map((e) => Dates.dayNumber(e.ts))).size,
      minutes30: Math.round(recent.reduce((sum, e) => sum + e.ms, 0) / 60000),
      streak: streak(days, today),
      retention30: retention(log, window30),
      weekly: weeklyRetention(log, today),
      forecast: forecast(cards, now),
      intervals: intervalDistribution(cards),
      states: cardStates(cards),
    };
  }

  return { compute, forecast, streak, reviewsByDay };
})();
