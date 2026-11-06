// The study screen. No navigation, large type, one card at a time. Fully keyboard
// driven: Space shows the answer, 1-4 grade, U undoes, E edits, Escape leaves.
const StudyView = (() => {
  const GRADE_NAMES = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
  const VERDICTS = {
    exact: { text: 'Correct', grade: 3 },
    forgiving: { text: 'Correct, apart from accents or punctuation', grade: 3 },
    close: { text: 'Close: a small typo', grade: 2 },
    wrong: { text: 'Not quite', grade: 1 },
  };
  const TICK_MS = 15000;

  let root = null;
  let session = null;
  let card = null;
  let waitingUntil = null;
  let revealed = false;
  let typedInput = null;
  let typedResult = null;
  let shownAt = 0;
  let timer = null;

  function mount(container, params) {
    root = container;
    session = params.mode === 'practice'
      ? Sessions.practice(params.deckId, { limit: params.limit, tag: params.tag })
      : Sessions.review(params.deckId);
    Toast.clear();
    document.addEventListener('keydown', onKey);
    timer = setInterval(onTick, TICK_MS);
    advance();
  }

  function unmount() {
    document.removeEventListener('keydown', onKey);
    clearInterval(timer);
    Toast.clear(); // a leech toast's Undo belongs to this session
    session = null;
    card = null;
  }

  // Learning cards can come due while the screen sits idle on "come back later".
  function onTick() {
    if (card || !session) return;
    const result = session.next(Date.now());
    if (result.card) advance(); else render();
  }

  function advance() {
    const now = Date.now();
    const result = session.next(now);
    card = result.card || null;
    waitingUntil = result.waitingUntil || null;
    revealed = false;
    typedResult = null;
    shownAt = now;
    render();
  }

  const exit = () => { location.hash = `#/decks/${session.deckId}`; };

  function currentNote() {
    return card ? Store.note(card.noteId) : null;
  }

  // ---- Actions ----

  function reveal() {
    if (!card || revealed) return;
    const note = currentNote();
    if (note.type === 'typed') {
      const typed = typedInput ? typedInput.value : '';
      typedResult = { typed, ...Answers.compare(typed, note.back) };
    }
    revealed = true;
    render();
  }

  function grade(value) {
    if (!card || !revealed) return;
    const name = Store.note(card.noteId) ? Store.note(card.noteId).front.slice(0, 40) : '';
    const { becameLeech } = session.answer(card, value, Date.now(), Date.now() - shownAt);
    if (becameLeech) {
      Toast.show(`Leech: "${name}" has lapsed too often and is now suspended. Rewrite it or break it up.`, { kind: 'warn', onUndo: undo });
    }
    advance();
  }

  function undo() {
    if (!session || !session.canUndo()) return;
    session.undo();
    advance();
  }

  function editCurrent() {
    if (!card) return;
    NoteEditor.open({ noteId: card.noteId, onSaved: () => {
      const fresh = card && Store.card(card.id);
      if (fresh && !fresh.suspended) {
        card = fresh;
        render();
      } else {
        advance();
      }
    } });
  }

  function onKey(event) {
    if (Modal.isOpen() || !session || event.ctrlKey && event.key !== 'z' || event.metaKey || event.altKey) return;
    const target = event.target;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (event.key === 'Escape') { event.preventDefault(); exit(); return; }
    if (typing) {
      // With nothing typed, Ctrl+Z can only mean the last grade.
      if (event.ctrlKey && event.key === 'z' && !target.value) { event.preventDefault(); undo(); }
      return;
    }
    const onControl = target.tagName === 'BUTTON' || target.tagName === 'A';

    if (event.key === ' ' || event.code === 'Space') {
      if (onControl) return;
      event.preventDefault();
      reveal();
    } else if (['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      grade(Number(event.key));
    } else if (event.key === 'u' || (event.ctrlKey && event.key === 'z')) {
      event.preventDefault();
      undo();
    } else if (event.key === 'e') {
      event.preventDefault();
      editCurrent();
    }
  }

  // ---- Rendering ----

  function render() {
    typedInput = null;
    const content = card ? cardScreen() : finishedScreen();
    root.replaceChildren(h('div', { class: 'study', 'data-mode': session.kind }, topBar(), content));
    if (typedInput && !revealed) typedInput.focus();
    else {
      const stage = root.querySelector('.study-stage');
      if (stage) stage.focus({ preventScroll: true });
    }
  }

  function headerCounts() {
    const counts = session.counts(Date.now());
    if (session.kind === 'practice') {
      return h('span', { class: 'study-counts' }, h('span', { class: 'practice-badge' }, 'Practice: scheduling is not changed'), h('span', { class: 'study-remaining' }, `${counts.remaining} left`));
    }
    return h('span', { class: 'study-counts', 'aria-label': `${counts.fresh} new, ${counts.learning} learning, ${counts.review} to review` },
      h('span', { class: 'count-new', title: 'New' }, counts.fresh),
      h('span', { class: 'count-learn', title: 'Learning' }, counts.learning),
      h('span', { class: 'count-review', title: 'Review' }, counts.review));
  }

  function topBar() {
    const deck = Store.deck(session.deckId);
    return h('header', { class: 'study-top' },
      h('a', { class: 'icon-btn', href: `#/decks/${session.deckId}`, 'aria-label': 'Leave session', title: 'Leave session (Esc)' }, icon('close', 18)),
      h('span', { class: 'study-deck' }, deck ? deck.name : ''),
      headerCounts(),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-quiet', type: 'button', disabled: !session.canUndo(), onclick: undo, title: 'Undo last grade (U)' }, icon('undo'), h('span', { class: 'hide-narrow' }, 'Undo')),
      card ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: editCurrent, title: 'Edit this note (E)' }, icon('edit'), h('span', { class: 'hide-narrow' }, 'Edit')) : null);
  }

  function cardScreen() {
    const note = currentNote();
    const faces = Cards.faces(note, card);
    const isCloze = note.type === 'cloze';
    const stage = h('main', { class: 'study-stage', tabindex: -1 },
      h('div', { class: 'study-card' },
        h('div', { class: 'face face-question', 'data-testid': 'question' }, renderSegments(revealed && isCloze ? faces.answer : faces.question)),
        note.type === 'typed' && !revealed ? typedForm() : null,
        revealed ? answerSide(note, faces, isCloze) : null));
    return [stage, h('footer', { class: 'study-actions' }, revealed ? gradeButtons() : showAnswerButton())];
  }

  function typedForm() {
    typedInput = h('input', {
      class: 'typed-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': 'Type your answer', placeholder: 'Type your answer',
    });
    return h('form', { class: 'typed-form', onsubmit: (e) => { e.preventDefault(); reveal(); } }, typedInput);
  }

  function answerSide(note, faces, isCloze) {
    return h('div', { class: 'answer-side', 'data-testid': 'answer' },
      isCloze ? null : h('hr', { class: 'face-rule' }),
      typedResult ? typedReport(typedResult) : null,
      isCloze ? null : h('div', { class: 'face face-answer' }, renderSegments(faces.answer)),
      faces.extra ? h('div', { class: 'face-extra' }, renderSegments(faces.extra)) : null);
  }

  function typedReport({ typed, level, form }) {
    const verdict = VERDICTS[level];
    const text = typed.trim() ? verdict.text : 'No answer typed';
    return h('div', { class: `typed-report typed-${level}` },
      h('p', { class: 'typed-verdict', 'data-testid': 'verdict' }, text),
      typed.trim() ? h('p', { class: 'typed-diff', 'aria-label': `You typed ${typed}` },
        Answers.diff(typed.trim(), form).map((part) => h('span', { class: `diff-${part.kind}` }, part.text))) : null);
  }

  function showAnswerButton() {
    return h('button', { class: 'btn btn-primary btn-show', type: 'button', onclick: reveal },
      'Show answer', h('kbd', {}, typedInput ? 'Enter' : 'Space'));
  }

  function gradeButtons() {
    const suggested = typedResult ? VERDICTS[typedResult.level].grade : null;
    return h('div', { class: 'grades', role: 'group', 'aria-label': 'Grade your recall' },
      session.options(card, Date.now()).map(({ grade: value, label }) => h('button', {
        class: `grade grade-${value}${suggested === value ? ' is-suggested' : ''}`,
        type: 'button',
        'data-grade': GRADE_NAMES[value],
        'aria-label': `${GRADE_NAMES[value]}, ${label}, key ${value}`,
        onclick: () => grade(value),
      },
      h('span', { class: 'grade-next' }, label),
      h('span', { class: 'grade-name' }, GRADE_NAMES[value]),
      h('kbd', {}, value))));
  }

  function finishedScreen() {
    const { answered, passed } = session.summary;
    const rate = answered ? Math.round((passed / answered) * 100) : null;
    const isPractice = session.kind === 'practice';
    let title = isPractice ? 'Practice finished' : 'Nothing left to study';
    let note = isPractice ? 'Due dates and statistics stay exactly as they were.' : nextDueNote();
    if (waitingUntil) {
      title = 'Back soon';
      note = `Next learning card returns in ${Dates.relativeMinutes(waitingUntil - Date.now())}. This screen continues by itself.`;
    }
    if (isPractice && session.summary.total === 0) {
      title = 'No cards to practice';
      note = 'Every card matching this choice is suspended, or the deck is empty.';
    }
    return h('main', { class: 'study-stage study-finished', tabindex: -1 },
      h('div', { class: 'finished-card' },
        h('h1', {}, title),
        h('p', {}, note),
        answered ? h('dl', { class: 'finished-stats' },
          h('div', {}, h('dt', {}, 'Answered'), h('dd', {}, answered)),
          h('div', {}, h('dt', {}, 'Recalled'), h('dd', {}, `${rate}%`))) : null,
        h('div', { class: 'button-row' },
          h('a', { class: 'btn btn-primary', href: `#/decks/${session.deckId}` }, 'Back to decks'),
          isPractice ? null : h('button', { class: 'btn', type: 'button', onclick: () => DecksView.openPractice(session.deckId) }, 'Practice this deck'))));
  }

  function nextDueNote() {
    const ids = new Set(Store.descendantIds(session.deckId));
    const notes = new Set(Store.state.notes.filter((n) => ids.has(n.deckId)).map((n) => n.id));
    const cards = Store.state.cards.filter((c) => notes.has(c.noteId));
    const tomorrow = Stats.forecast(cards, Date.now(), 2)[1].count;
    return tomorrow ? `${plural(tomorrow, 'card')} due tomorrow.` : 'No reviews due tomorrow.';
  }

  return { mount, unmount };
})();
