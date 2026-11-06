// Modal for adding and editing a note. Used from the deck page, browser and study session.
const NoteEditor = (() => {
  /** options: { noteId, deckId, focusCardId, onSaved } */
  function open(options) {
    const editing = options.noteId ? Store.note(options.noteId) : null;
    const draft = {
      type: editing ? editing.type : options.type || 'basic',
      front: editing ? editing.front : '',
      back: editing ? editing.back : '',
      deckId: editing ? editing.deckId : options.deckId,
      tags: editing ? editing.tags.join(', ') : '',
    };

    const frontInput = h('textarea', { rows: 2, id: 'note-front', 'data-autofocus': true, value: draft.front });
    const backInput = h('textarea', { rows: 2, id: 'note-back', value: draft.back });
    const tagsInput = h('input', { type: 'text', id: 'note-tags', value: draft.tags, autocomplete: 'off', placeholder: 'verbs, chapter-3' });
    const deckInput = deckSelect(draft.deckId, { id: 'note-deck' });
    const frontField = field('Front', frontInput);
    const backField = field('Back', backInput);
    const deckField = field('Deck', deckInput);
    const tagsField = field('Tags', tagsInput, { hint: 'Separate tags with commas or spaces.' });
    const typeButtons = new Map();
    const clozeTools = h('div', { class: 'cloze-tools' });
    const preview = h('div', { class: 'note-preview', 'aria-live': 'polite' });

    const typeGroup = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Card type' },
      Object.entries(Cards.TYPES).map(([type, def]) => {
        const button = h('button', { type: 'button', role: 'radio', onclick: () => setType(type) }, def.label);
        typeButtons.set(type, button);
        return button;
      }));
    typeGroup.addEventListener('keydown', moveTypeWithArrows);

    function moveTypeWithArrows(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const types = Object.keys(Cards.TYPES);
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      setType(types[(types.indexOf(draft.type) + delta + types.length) % types.length]);
      typeButtons.get(draft.type).focus();
    }

    function setType(type) {
      draft.type = type;
      const def = Cards.TYPES[type];
      for (const [key, button] of typeButtons) {
        button.setAttribute('aria-checked', String(key === type));
        button.tabIndex = key === type ? 0 : -1;
      }
      frontField.querySelector('label').textContent = def.frontLabel;
      backField.querySelector('label').textContent = def.backLabel;
      backField.querySelector('.field-hint')?.remove();
      if (type === 'typed') {
        backField.querySelector('label').after(h('p', { class: 'field-hint' }, 'Separate accepted alternatives with a slash, like color / colour.'));
      }
      clozeTools.hidden = type !== 'cloze';
      frontField.setError('');
      backField.setError('');
      updatePreview();
    }

    function wrapSelectionAsCloze() {
      const used = Cards.clozeIndexes(frontInput.value);
      const next = (used.length ? used[used.length - 1] : 0) + 1;
      const { selectionStart: start, selectionEnd: end, value } = frontInput;
      const chosen = value.slice(start, end) || 'answer';
      const wrapped = `{{c${next}::${chosen}}}`;
      frontInput.value = value.slice(0, start) + wrapped + value.slice(end);
      frontInput.focus();
      frontInput.setSelectionRange(start + wrapped.length, start + wrapped.length);
      updatePreview();
    }

    clozeTools.append(
      h('button', { class: 'btn btn-small', type: 'button', onclick: wrapSelectionAsCloze }, 'Wrap selection as deletion'),
      h('span', { class: 'field-hint' }, 'Hide text with {{c1::answer}}, or add a hint with {{c1::answer::hint}}.'));

    function updatePreview() {
      preview.replaceChildren();
      const note = { type: draft.type, front: frontInput.value, back: backInput.value };
      const ords = Cards.ordinalsFor(note);
      if (draft.type === 'cloze' && !ords.length) {
        preview.append(h('p', { class: 'muted' }, 'No deletions yet, so this note would create no cards.'));
        return;
      }
      preview.append(h('p', { class: 'note-preview-count' }, `Creates ${plural(ords.length, 'card')}`));
      if (draft.type === 'cloze') {
        for (const ord of ords) {
          preview.append(h('p', { class: 'note-preview-line' }, renderSegments(Cards.faces(note, { ord }).question)));
        }
      }
    }

    frontInput.addEventListener('input', updatePreview);
    backInput.addEventListener('input', updatePreview);

    function readValues() {
      return {
        type: draft.type,
        front: frontInput.value.trim(),
        back: backInput.value.trim(),
        deckId: deckInput.value,
        tags: Cards.parseTags(tagsInput.value),
      };
    }

    function validate(values) {
      const errors = Cards.validate(values);
      frontField.setError(errors.front);
      backField.setError(errors.back);
      deckField.setError(values.deckId ? '' : 'Choose a deck.');
      if (errors.front) frontInput.focus();
      else if (errors.back) backInput.focus();
      return !errors.front && !errors.back && values.deckId;
    }

    function saveNew(keepOpen) {
      const values = readValues();
      if (!validate(values)) return;
      const note = Store.addNote(values);
      Toast.show(`Added ${plural(Cards.ordinalsFor(note).length, 'card')} to ${Store.deckPath(values.deckId)}`);
      if (options.onSaved) options.onSaved();
      if (keepOpen) {
        frontInput.value = '';
        backInput.value = '';
        frontInput.focus();
        updatePreview();
      } else {
        Modal.close();
      }
    }

    function saveEdit() {
      const values = readValues();
      if (!validate(values)) return;
      Store.updateNote(editing.id, values);
      Modal.close();
      if (options.onSaved) options.onSaved();
    }

    function deleteNote() {
      Modal.close();
      Toast.withUndo('Note deleted', () => Store.deleteNotes([editing.id]), () => { if (options.onSaved) options.onSaved(); });
    }

    const footer = editing
      ? [
        h('button', { class: 'btn btn-danger-quiet', type: 'button', onclick: deleteNote }, 'Delete note'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => Modal.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: saveEdit }, 'Save changes'),
      ]
      : [
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => saveNew(true) }, 'Save and add another'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => saveNew(false) }, 'Save card'),
      ];

    const body = h('form', { class: 'stack-form', onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Card type'), typeGroup),
      frontField, clozeTools, backField, preview,
      h('div', { class: 'field-row' }, deckField, tagsField),
      editing ? scheduleSummary(editing, options) : null);

    Modal.open({ title: editing ? 'Edit note' : 'Add card', body, footer, wide: true });
    setType(draft.type);
  }

  function describeCard(card) {
    if (card.suspended) return card.leech ? 'Suspended leech' : 'Suspended';
    if (card.state === 'new') return 'New';
    if (card.state !== 'review') return card.state === 'learning' ? 'Learning' : 'Relearning';
    return `Due ${Dates.relativeDay(card.due)}`;
  }

  function scheduleSummary(note, options) {
    const cards = Store.state.cards.filter((c) => c.noteId === note.id).sort((a, b) => a.ord - b.ord);
    const refresh = () => { Modal.close(); if (options.onSaved) options.onSaved(); open(options); };
    return h('section', { class: 'schedule-summary', 'aria-label': 'Card schedules' },
      h('h3', {}, 'Scheduling'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'plain-table' },
        h('thead', {}, h('tr', {}, ['Card', 'Status', 'Interval', 'Ease', 'Lapses', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, cards.map((card) => h('tr', {},
          h('td', { class: 'cell-clip' }, Cards.questionText(note, card)),
          h('td', {}, describeCard(card)),
          h('td', {}, card.state === 'review' ? Dates.shortDays(card.interval) : '-'),
          h('td', {}, `${Math.round(card.ease * 100)}%`),
          h('td', {}, card.lapses),
          h('td', { class: 'cell-actions' },
            h('button', { class: 'btn btn-small', type: 'button', onclick: () => { Store.setSuspended([card.id], !card.suspended); refresh(); } }, card.suspended ? 'Unsuspend' : 'Suspend'),
            h('button', { class: 'btn btn-small', type: 'button', disabled: card.state === 'new', onclick: () => { Store.forgetCards([card.id]); refresh(); } }, 'Make new'))))))));
  }

  return { open };
})();
