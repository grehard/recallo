// Forgiving comparison for typed-answer cards.
// Levels, best first:
//   exact     same apart from case and spacing
//   forgiving same once accents, punctuation and a leading article are ignored
//   close     within a small typo allowance that scales with word length
//   wrong     anything else
const Answers = (() => {
  const LEADING_ARTICLE = /^(?:the|an?|el|la|los|las|un|una|unos|unas|le|les|der|die|das)\s+/;

  const strict = (s) => String(s).normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

  function loose(s) {
    const bare = strict(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();
    return bare.replace(LEADING_ARTICLE, '') || bare;
  }

  /** "colour / color" gives two options; "(to) run" accepts "run" and "to run". */
  function acceptedForms(expected) {
    const forms = [];
    for (const option of String(expected).split(/[/;]/)) {
      const full = option.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
      const short = option.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      if (full) forms.push(full);
      if (short && short !== full) forms.push(short);
    }
    return forms.length ? forms : [String(expected)];
  }

  /** Damerau-Levenshtein distance (optimal string alignment), so a swapped pair costs one. */
  function editDistance(a, b) {
    const grid = Array.from({ length: a.length + 1 }, (_, i) => {
      const row = new Array(b.length + 1).fill(0);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= b.length; j++) grid[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let best = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, grid[i - 2][j - 2] + 1);
        grid[i][j] = best;
      }
    }
    return grid[a.length][b.length];
  }

  // Short words get no allowance: "sol" and "sal" are different Spanish words.
  function typoAllowance(length) {
    if (length <= 3) return 0;
    if (length <= 7) return 1;
    return length <= 15 ? 2 : 3;
  }

  // A date or quantity with a digit out of place is wrong, not a typo.
  const digitsOf = (s) => (s.match(/\d/g) || []).join('');

  /** Compares typed input with the expected answer. Returns { level, form, distance }. */
  function compare(input, expected) {
    const forms = acceptedForms(expected);
    const typed = strict(input);
    if (!typed) return { level: 'wrong', form: forms[0], distance: null };

    for (const form of forms) {
      if (typed === strict(form)) return { level: 'exact', form, distance: 0 };
    }
    const looseInput = loose(input);
    for (const form of forms) {
      if (looseInput === loose(form)) return { level: 'forgiving', form, distance: 0 };
    }

    let best = { level: 'wrong', form: forms[0], distance: Infinity };
    for (const form of forms) {
      const target = loose(form);
      const distance = editDistance(looseInput, target);
      if (distance < best.distance) {
        const close = distance <= typoAllowance(target.length) && digitsOf(target) === digitsOf(looseInput);
        best = { level: close ? 'close' : 'wrong', form, distance };
      }
    }
    return best;
  }

  /** Aligns what was typed against the answer, using a longest common subsequence. */
  function diff(typed, target) {
    const a = [...typed];
    const b = [...target];
    const same = (x, y) => x.toLocaleLowerCase() === y.toLocaleLowerCase();
    const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i][j] = same(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const parts = [];
    const push = (kind, ch) => {
      const tail = parts[parts.length - 1];
      if (tail && tail.kind === kind) tail.text += ch; else parts.push({ kind, text: ch });
    };
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (same(a[i], b[j])) { push('same', a[i]); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) { push('extra', a[i]); i++; }
      else { push('missing', b[j]); j++; }
    }
    while (i < a.length) { push('extra', a[i]); i++; }
    while (j < b.length) { push('missing', b[j]); j++; }
    return parts;
  }

  return { compare, diff, acceptedForms };
})();
