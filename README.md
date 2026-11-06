# Recallo

Spaced-repetition flashcards for students and language learners, running entirely in the browser.

Author: Grehard

## Features

- Decks nested to any depth, with three seed decks: web fundamentals, world capitals and Spanish basics, each with a backdated review history.
- Four card types: basic, reversible, cloze deletion (`{{c1::text}}`, with optional `{{c1::text::hint}}`) and typed answer.
- Study sessions scheduled with SM-2, including learning steps, relearning after a lapse and leech detection. Each grade button shows the interval it will give.
- Keyboard study: Space shows the answer, 1-4 grade, U undoes the last grade, E edits the note, Escape leaves.
- Daily new and review limits on every deck. A limit also covers the deck's subdecks.
- Practice mode, which runs from an in-memory list and never changes scheduling or statistics.
- Browser with search (`tag:` and `deck:` prefixes included), filters, sorting and bulk tag, move, suspend, reset and delete, with undo.
- Statistics per deck or overall: review heatmap, retention rate, 30-day forecast, interval distribution and card states, in hand-built SVG.
- CSV and TSV import with a preview and column mapping step. JSON export and import, as a full replace or a merge.
- Light and dark themes, and full use at phone width.

## Running it

Open `index.html`, or serve the folder with any static server. There is no build step and no dependency. Data is stored in `localStorage` under keys starting with `recallo`.

## How the code is organized

```
js/dates.js         Local day numbers and interval formatting
js/scheduler.js     SM-2 scheduler, pure functions only
js/cards.js         Card types, cloze parsing, card faces
js/answers.js       Typed-answer comparison and character diff
js/csv.js           RFC 4180 parser and delimiter detection
js/validate.js      Cleans untrusted data from storage or a file
js/seed-content.js  The seed decks
js/seed.js          Replays simulated study through the scheduler
js/store.js         The collection and all its mutations
js/queue.js         Next-card selection and daily limits
js/stats.js         Numbers for the statistics page
js/dom.js           Element builder, icons, modal, toast
js/charts.js        SVG heatmap, bars, line and segmented bar
js/views/           One file per screen, plus the two session types
js/app.js           Hash routing, top bar, theme
```

## Key engineering decisions

**Scheduling is pure and honest.** `Scheduler.answer` takes a card, a grade and a time, and returns a new card. The study screen previews each grade by calling that same function, so a button's label can't disagree with what the grade does. There is no interval fuzz, for the same reason.

**The SM-2 details.** After graduating, a card follows SM-2's 1 day, 6 days, then interval times ease. Hard, Good and Easy change ease by SM-2's own formula at quality 3, 4 and 5 (-0.14, 0, +0.10). The one departure is that a lapse lowers ease by 0.20. SM-2 proper leaves ease alone on failure, which keeps a troublesome card on intervals it has already shown are too long. Lateness is not rewarded: an overdue card grows from its scheduled interval.

**Seed data comes from the scheduler.** First run replays up to a year of simulated answers through `Scheduler.answer`, using a seeded random source. Intervals, ease factors and heatmap cells all come from the real algorithm. The only hand-placed values are a few cards set up to demonstrate leeches, and some due dates brought forward so that a first visit has reviews waiting.

**Limits are derived, not counted.** How many new cards and reviews a deck has used today is read from the review log. Undoing a grade removes its log entry, so the allowance comes back without any extra bookkeeping. The queue is rebuilt after every answer, which keeps it right after edits, moves and day changes.

**User text never becomes markup.** Card faces are arrays of segments and the DOM helper only creates text nodes from strings. The app does not use `innerHTML`.

**Typed answers are forgiving where it is safe.** Comparison steps down from exact, to ignoring accents, punctuation and a leading article, to a typo allowance by Damerau-Levenshtein distance that scales with length. Words of three letters get no allowance, because `sol` and `sal` are different words, and a digit out of place is always wrong, because 1989 is not 1998.
