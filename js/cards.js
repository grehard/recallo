// Card types: how a note becomes one or more cards, and what each card's faces show.
// Faces are arrays of segments rather than HTML, so user text only ever reaches the
// page as text nodes.
const Cards = (() => {
  const TYPES = {
    basic: { label: 'Basic', frontLabel: 'Front', backLabel: 'Back' },
    reversible: { label: 'Reversible', frontLabel: 'Side A', backLabel: 'Side B' },
    cloze: { label: 'Cloze', frontLabel: 'Text', backLabel: 'Extra (optional)' },
    typed: { label: 'Typed answer', frontLabel: 'Question', backLabel: 'Expected answer' },
  };

  const CLOZE_PATTERN = /\{\{c([1-9]\d{0,2})::([\s\S]+?)\}\}/g;

  /** Splits text into plain runs and cloze deletions: {{c1::text}} or {{c1::text::hint}}. */
  function parseCloze(input) {
    const text = String(input);
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(CLOZE_PATTERN)) {
      if (match.index > last) parts.push({ text: text.slice(last, match.index) });
      const [answer, ...hint] = match[2].split('::');
      parts.push({ index: Number(match[1]), text: answer, hint: hint.join('::') });
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
  }

  function clozeIndexes(text) {
    const found = parseCloze(text).filter((p) => p.index).map((p) => p.index);
    return [...new Set(found)].sort((a, b) => a - b);
  }

  /** Card ordinals a note should have. A cloze card's ordinal is its deletion number. */
  function ordinalsFor(note) {
    if (note.type === 'cloze') return clozeIndexes(note.front);
    return note.type === 'reversible' ? [0, 1] : [0];
  }

  function clozeSegments(text, ord, revealed) {
    return parseCloze(text).map((part) => {
      if (part.index !== ord) return { kind: 'text', text: part.text };
      if (revealed) return { kind: 'revealed', text: part.text };
      return { kind: 'hidden', text: part.hint ? `[${part.hint}]` : '[...]' };
    });
  }

  const plainText = (text) => [{ kind: 'text', text }];

  /** Returns { question, answer, extra } as segment arrays for one card. */
  function faces(note, card) {
    if (note.type === 'cloze') {
      return {
        question: clozeSegments(note.front, card.ord, false),
        answer: clozeSegments(note.front, card.ord, true),
        extra: note.back ? plainText(note.back) : null,
      };
    }
    const flipped = note.type === 'reversible' && card.ord === 1;
    return {
      question: plainText(flipped ? note.back : note.front),
      answer: plainText(flipped ? note.front : note.back),
      extra: null,
    };
  }

  const segmentsToText = (segments) => segments.map((s) => s.text).join('');

  function questionText(note, card) {
    return segmentsToText(faces(note, card).question);
  }

  function answerText(note, card) {
    const { answer } = faces(note, card);
    if (note.type !== 'cloze') return segmentsToText(answer);
    return answer.filter((s) => s.kind === 'revealed').map((s) => s.text).join(', ');
  }

  /** Validation messages for a note's fields, keyed by field name. */
  function validate(note) {
    const errors = {};
    const front = note.front.trim();
    if (!front) {
      errors.front = `${TYPES[note.type].frontLabel} can't be empty.`;
    } else if (note.type === 'cloze' && clozeIndexes(front).length === 0) {
      errors.front = 'Add at least one deletion, written like {{c1::answer}}.';
    }
    if (note.type !== 'cloze' && !note.back.trim()) {
      errors.back = `${TYPES[note.type].backLabel} can't be empty.`;
    }
    return errors;
  }

  /** Tags are typed separated by commas or spaces. */
  function parseTags(text) {
    const tags = String(text).split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    return [...new Set(tags)].slice(0, 30);
  }

  return { TYPES, parseCloze, clozeIndexes, ordinalsFor, faces, questionText, answerText, validate, parseTags };
})();
