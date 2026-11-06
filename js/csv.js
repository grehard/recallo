// Delimited text parser following RFC 4180: quoted fields, doubled quotes, embedded
// newlines and delimiters, CRLF or LF line ends, and an optional byte order mark.
const Csv = (() => {
  const DELIMITERS = [
    { value: ',', label: 'Comma' },
    { value: '\t', label: 'Tab' },
    { value: ';', label: 'Semicolon' },
  ];

  function parse(input, delimiter) {
    const text = String(input).replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let wasQuoted = false;

    const endField = () => { row.push(wasQuoted ? field : field.trim()); field = ''; wasQuoted = false; };
    const endRow = () => {
      endField();
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') field += ch;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (ch === '"' && field.trim() === '') {
        field = '';
        quoted = true;
        wasQuoted = true;
      } else if (ch === delimiter) {
        endField();
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        endRow();
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) endRow();
    return { rows, unterminatedQuote: quoted };
  }

  /** Picks the delimiter that gives the most consistent multi-column rows in a sample. */
  function detectDelimiter(text) {
    const sample = String(text).slice(0, 20000);
    let best = { value: ',', score: 0 };
    for (const { value } of DELIMITERS) {
      const widths = parse(sample, value).rows.slice(0, 30).map((r) => r.length);
      if (!widths.length) continue;
      const matching = widths.filter((w) => w === widths[0]).length;
      const score = widths[0] > 1 ? matching * widths[0] : 0;
      if (score > best.score) best = { value, score };
    }
    return best.value;
  }

  const HEADER_WORDS = {
    front: ['front', 'question', 'term', 'word', 'prompt', 'side a'],
    back: ['back', 'answer', 'definition', 'translation', 'meaning', 'side b'],
    tags: ['tags', 'tag', 'labels'],
    deck: ['deck', 'subject', 'folder'],
    type: ['type', 'card type', 'note type'],
  };

  function roleForHeader(name) {
    const clean = String(name).trim().toLowerCase();
    return Object.keys(HEADER_WORDS).find((role) => HEADER_WORDS[role].includes(clean)) || null;
  }

  const looksLikeHeader = (row) => row.some((cell) => roleForHeader(cell));

  /** Default column mapping: header names when present, else front, back, then ignore. */
  function guessMapping(row, hasHeader) {
    const used = new Set();
    const mapping = row.map((cell) => {
      const role = hasHeader ? roleForHeader(cell) : null;
      if (role && !used.has(role)) { used.add(role); return role; }
      return 'ignore';
    });
    if (used.size) return mapping;
    return row.map((_, i) => (i === 0 ? 'front' : i === 1 ? 'back' : 'ignore'));
  }

  return { DELIMITERS, parse, detectDelimiter, looksLikeHeader, guessMapping };
})();
