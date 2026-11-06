// SM-2 scheduling with learning and relearning steps.
//
// Review cards follow SuperMemo 2: the second successful repetition is 6 days and
// later ones multiply by the ease factor. The ease change for Hard, Good and Easy is
// SM-2's own formula at quality 3, 4 and 5 (-0.14, 0, +0.10). Two deliberate changes:
//   - A lapse lowers ease by 0.20. Pure SM-2 leaves ease alone on failure, which keeps
//     troublesome cards on intervals they have already proved too long for.
//   - No random interval fuzz, so every interval on a grade button is exactly what happens.
const Scheduler = (() => {
  const GRADE = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

  const DEFAULTS = {
    learningSteps: [1, 10],
    relearningSteps: [10],
    graduatingInterval: 1,
    easyInterval: 4,
    startingEase: 2.5,
    leechThreshold: 8,
  };

  const MIN_EASE = 1.3;
  const HARD_MULTIPLIER = 1.2;
  const EASY_BONUS = 1.3;
  const MAX_INTERVAL = 36500;
  const SECOND_REPETITION_DAYS = 6;
  const LAPSE_EASE_PENALTY = 0.2;
  // SM-2: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), evaluated at q = 3, 4, 5.
  const EASE_DELTA = { [GRADE.HARD]: -0.14, [GRADE.GOOD]: 0, [GRADE.EASY]: 0.1 };

  const roundEase = (ease) => Math.max(MIN_EASE, Math.round(ease * 100) / 100);
  const clampInterval = (days) => Math.min(MAX_INTERVAL, days);

  function blankSchedule(cfg) {
    return { state: 'new', due: 0, interval: 0, ease: cfg.startingEase, step: 0, streak: 0, reps: 0, lapses: 0 };
  }

  function graduate(card, days, now) {
    card.state = 'review';
    card.interval = clampInterval(days);
    card.due = Dates.dayNumber(now) + card.interval;
    card.step = 0;
    card.streak = 1;
  }

  function scheduleStep(card, minutes, now) {
    card.due = now + minutes * MINUTE_MS;
  }

  // Hard repeats the current step, stretched: halfway to the next step when there is
  // one, or half as long again when it is the only step.
  function hardDelay(steps, index) {
    if (index + 1 < steps.length) return Math.round((steps[index] + steps[index + 1]) / 2);
    return steps.length === 1 ? Math.round(steps[index] * 1.5) : steps[index];
  }

  function answerStep(card, grade, now, cfg) {
    const relearning = card.state === 'relearning';
    const steps = relearning ? cfg.relearningSteps : cfg.learningSteps;
    if (card.state === 'new') card.state = 'learning';
    const index = Math.min(card.step, steps.length - 1);

    if (grade === GRADE.AGAIN) {
      card.step = 0;
      scheduleStep(card, steps[0], now);
    } else if (grade === GRADE.HARD) {
      card.step = index;
      scheduleStep(card, hardDelay(steps, index), now);
    } else if (grade === GRADE.EASY) {
      graduate(card, relearning ? card.interval + 1 : cfg.easyInterval, now);
    } else if (index + 1 < steps.length) {
      card.step = index + 1;
      scheduleStep(card, steps[index + 1], now);
    } else {
      graduate(card, relearning ? card.interval : cfg.graduatingInterval, now);
    }
  }

  // A leech triggers at the threshold, then again every half threshold after that if
  // the learner unsuspends the card and keeps failing it.
  function isLeechLapse(lapses, threshold) {
    if (threshold <= 0 || lapses < threshold) return false;
    return (lapses - threshold) % Math.max(1, Math.ceil(threshold / 2)) === 0;
  }

  function answerLapse(card, now, cfg) {
    card.lapses += 1;
    card.ease = roundEase(card.ease - LAPSE_EASE_PENALTY);
    card.interval = 1;
    card.streak = 0;
    card.state = 'relearning';
    card.step = 0;
    scheduleStep(card, cfg.relearningSteps[0], now);
    return isLeechLapse(card.lapses, cfg.leechThreshold);
  }

  function reviewIntervals(card) {
    const { interval, ease, streak } = card;
    const grown = Math.max(interval + 1, Math.round(interval * ease));
    const good = streak === 1 ? Math.max(SECOND_REPETITION_DAYS, grown) : grown;
    return {
      [GRADE.HARD]: Math.max(interval + 1, Math.round(interval * HARD_MULTIPLIER)),
      [GRADE.GOOD]: good,
      [GRADE.EASY]: Math.max(good + 1, Math.round(interval * ease * EASY_BONUS)),
    };
  }

  function answerReview(card, grade, now) {
    const days = reviewIntervals(card)[grade];
    card.ease = roundEase(card.ease + EASE_DELTA[grade]);
    card.interval = clampInterval(days);
    card.due = Dates.dayNumber(now) + card.interval;
    card.streak += 1;
  }

  /**
   * Applies one grade to a schedule. Pure: returns the updated copy, the state it was
   * answered in, and whether this answer turned the card into a leech.
   */
  function answer(card, grade, now, cfg) {
    const next = { ...card };
    const kind = card.state;
    let becameLeech = false;

    if (kind === 'review' && grade === GRADE.AGAIN) {
      becameLeech = answerLapse(next, now, cfg);
    } else if (kind === 'review') {
      answerReview(next, grade, now);
    } else {
      answerStep(next, grade, now, cfg);
    }
    next.reps += 1;
    return { card: next, kind, becameLeech };
  }

  /** How long until a card returns, in short form, after a schedule has been applied. */
  function nextLabel(card, now) {
    if (card.state === 'review') return Dates.shortDays(card.interval);
    return Dates.shortMinutes((card.due - now) / MINUTE_MS);
  }

  function previewAll(card, now, cfg) {
    return [GRADE.AGAIN, GRADE.HARD, GRADE.GOOD, GRADE.EASY].map((grade) => ({
      grade,
      label: nextLabel(answer(card, grade, now, cfg).card, now),
    }));
  }

  return { GRADE, DEFAULTS, MIN_EASE, blankSchedule, answer, previewAll };
})();
