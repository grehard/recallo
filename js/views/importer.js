// CSV and TSV import wizard: paste or choose a file, map the columns against a live
// preview, then import. Nothing is written until the last step, and that can be undone.
const Importer = (() => {
  const MAX_BYTES = 5 * 1024 * 1024;
  const PREVIEW_ROWS = 8;
  const ROLES = [['ignore', 'Ignore'], ['front', 'Front'], ['back', 'Back'], ['tags', 'Tags'], ['deck', 'Deck'], ['type', 'Card type']];
  const TYPE_WORDS = { basic: 'basic', reversible: 'reversible', reverse: 'reversible', cloze: 'cloze', typed: 'typed', 'typed answer': 'typed' };

  /** Turns one mapped row into a note draft, or a reason it can't be imported. */
  function rowToNote(row, mapping, options) {
    const read = (role) => {
      const index = mapping.indexOf(role);
      return index >= 0 && row[index] !== undefined ? row[index].trim() : '';
    };
    const front = read('front');
    const back = read('back');
    const stated = TYPE_WORDS[read('type').toLowerCase()];
    const type = stated || (Cards.clozeIndexes(front).length ? 'cloze' : options.type);
    const errors = Cards.validate({ type, front, back });
    return {
      front, back, type,
      tags: Cards.parseTags(`${read('tags')} ${options.tags}`),
      deckPath: read('deck'),
      error: errors.front || errors.back || null,
    };
  }

  /** Applies the mapping to all rows and sorts them into notes to add and rows to skip. */
  function analyse(rows, hasHeader, mapping, options) {
    const body = hasHeader ? rows.slice(1) : rows;
    const firstRowNumber = hasHeader ? 2 : 1;
    const existing = new Set(options.skipDuplicates ? Store.state.notes.map((n) => n.front.trim().toLowerCase()) : []);
    const ready = [];
    const skipped = [];
    body.forEach((row, i) => {
      const note = rowToNote(row, mapping, options);
      const number = i + firstRowNumber;
      const key = note.front.toLowerCase();
      if (note.error) skipped.push({ number, reason: note.error });
      else if (existing.has(key)) skipped.push({ number, reason: 'Already in your collection.' });
      else {
        existing.add(key);
        ready.push(note);
      }
    });
    return { ready, skipped, bodyCount: body.length };
  }

  function mappingError(mapping) {
    if (!mapping.includes('front')) return 'Choose which column holds the front of each card.';
    for (const role of ['front', 'back', 'tags', 'deck', 'type']) {
      if (mapping.filter((m) => m === role).length > 1) {
        return `${ROLES.find((r) => r[0] === role)[1]} is mapped to more than one column.`;
      }
    }
    return null;
  }

  function commit(ready, options) {
    let added = 0;
    for (const note of ready) {
      const deckId = note.deckPath ? Store.ensureDeckPath(note.deckPath, options.deckId) : options.deckId;
      Store.addNote({ type: note.type, front: note.front, back: note.back, deckId, tags: note.tags });
      added++;
    }
    return added;
  }

  // ---- Wizard UI ----

  function mount(host) {
    const wizard = { text: '', fileName: '', rows: [], delimiter: ',', hasHeader: false, mapping: [] };
    const options = {
      deckId: Store.state.ui.selectedDeck && Store.deck(Store.state.ui.selectedDeck) ? Store.state.ui.selectedDeck : (Store.deckList()[0] ? Store.deckList()[0].deck.id : ''),
      type: 'basic', tags: '', skipDuplicates: true,
    };

    function stepOne(error) {
      const fileInput = h('input', { type: 'file', id: 'csv-file', accept: '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain', class: 'file-input', onchange: (e) => readFile(e.target.files[0]) });
      const paste = h('textarea', { id: 'csv-paste', rows: 6, placeholder: 'front,back,tags\n"el perro","the dog",animals', value: wizard.text });
      const errorNode = h('p', { class: 'form-error', role: 'alert', hidden: !error }, error || '');
      const next = () => loadText(paste.value, '');
      host.replaceChildren(h('div', { class: 'wizard' },
        stepIndicator(1),
        h('div', { class: 'field' },
          h('label', { for: 'csv-file' }, 'Choose a CSV or TSV file'),
          fileInput),
        h('div', { class: 'field' },
          h('label', { for: 'csv-paste' }, 'Or paste the rows'),
          paste),
        errorNode,
        h('div', { class: 'button-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: next }, 'Preview import'))));
    }

    function readFile(file) {
      if (!file) return;
      if (file.size > MAX_BYTES) { stepOne(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`); return; }
      const reader = new FileReader();
      reader.onload = () => loadText(String(reader.result), file.name);
      reader.onerror = () => stepOne('The file could not be read.');
      reader.readAsText(file);
    }

    function loadText(text, fileName) {
      if (!text.trim()) { stepOne('There is nothing to import yet. Choose a file or paste some rows.'); return; }
      wizard.text = text;
      wizard.fileName = fileName;
      wizard.delimiter = fileName.toLowerCase().endsWith('.tsv') ? '\t' : Csv.detectDelimiter(text);
      parseAndGuess(true);
      stepTwo();
    }

    function parseAndGuess(guessHeader) {
      const parsed = Csv.parse(wizard.text, wizard.delimiter);
      wizard.rows = parsed.rows;
      wizard.unterminated = parsed.unterminatedQuote;
      if (guessHeader) wizard.hasHeader = parsed.rows.length > 1 && Csv.looksLikeHeader(parsed.rows[0]);
      const width = Math.max(0, ...parsed.rows.map((r) => r.length));
      const sample = (parsed.rows[0] || []).concat(new Array(width).fill('')).slice(0, width);
      wizard.mapping = Csv.guessMapping(sample, wizard.hasHeader);
    }

    function stepTwo() {
      const panel = h('div', { class: 'wizard' });
      const previewHost = h('div', {});
      const summaryHost = h('div', { 'aria-live': 'polite' });
      const importButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: runImport }, 'Import');

      function refresh() {
        drawPreview();
        drawSummary();
      }

      function current() {
        return analyse(wizard.rows, wizard.hasHeader, wizard.mapping, options);
      }

      function drawPreview() {
        const start = wizard.hasHeader ? 1 : 0;
        const width = wizard.mapping.length;
        const head = wizard.hasHeader ? wizard.rows[0] : [];
        previewHost.replaceChildren(h('div', { class: 'table-scroll map-scroll' }, h('table', { class: 'plain-table map-table' },
          h('thead', {}, h('tr', {}, wizard.mapping.map((role, col) => h('th', { scope: 'col' },
            h('label', { class: 'map-label', for: `map-${col}` }, head[col] || `Column ${col + 1}`),
            roleSelect(role, col))))),
          h('tbody', {}, wizard.rows.slice(start, start + PREVIEW_ROWS).map((row) => h('tr', {},
            Array.from({ length: width }, (_, col) => h('td', { class: wizard.mapping[col] === 'ignore' ? 'map-ignored' : null }, row[col] || ''))))))));
      }

      function roleSelect(role, col) {
        const select = h('select', { id: `map-${col}`, onchange: (e) => { wizard.mapping[col] = e.target.value; refresh(); } },
          ROLES.map(([value, label]) => h('option', { value }, label)));
        select.value = role;
        return select;
      }

      function drawSummary() {
        const error = mappingError(wizard.mapping);
        const result = error ? null : current();
        importButton.disabled = Boolean(error) || !result.ready.length || !options.deckId;
        importButton.textContent = result && result.ready.length ? `Import ${plural(result.ready.length, 'note')}` : 'Import';
        const lines = [];
        if (error) lines.push(h('p', { class: 'form-error', role: 'alert' }, error));
        if (wizard.unterminated) lines.push(h('p', { class: 'form-error', role: 'alert' }, 'A quoted field is never closed, so the last rows may be merged.'));
        if (!options.deckId) lines.push(h('p', { class: 'form-error', role: 'alert' }, 'Create a deck first, so the cards have somewhere to go.'));
        if (result) {
          lines.push(h('p', { class: 'wizard-summary', 'data-testid': 'import-summary' }, `${plural(result.ready.length, 'note')} ready, ${plural(result.skipped.length, 'row')} skipped.`));
          if (result.skipped.length) {
            lines.push(h('ul', { class: 'skip-list' }, result.skipped.slice(0, 5).map((s) => h('li', {}, `Row ${s.number}: ${s.reason}`)),
              result.skipped.length > 5 ? h('li', {}, `and ${result.skipped.length - 5} more`) : null));
          }
        }
        summaryHost.replaceChildren(...lines);
      }

      function runImport() {
        const { ready } = current();
        const before = Store.snapshot();
        stepThree(commit(ready, options), ready, before);
      }

      const delimiter = h('select', { id: 'csv-delimiter', onchange: (e) => { wizard.delimiter = e.target.value; parseAndGuess(false); stepTwo(); } },
        Csv.DELIMITERS.map(({ value, label }) => h('option', { value }, label)));
      delimiter.value = wizard.delimiter;
      const header = h('input', { type: 'checkbox', id: 'csv-header', checked: wizard.hasHeader, onchange: (e) => { wizard.hasHeader = e.target.checked; parseAndGuess(false); stepTwo(); } });
      const deck = deckSelect(options.deckId, { id: 'csv-deck' });
      deck.addEventListener('change', () => { options.deckId = deck.value; drawSummary(); });
      const type = h('select', { id: 'csv-type', onchange: (e) => { options.type = e.target.value; refresh(); } },
        ['basic', 'reversible', 'typed'].map((t) => h('option', { value: t }, Cards.TYPES[t].label)));
      type.value = options.type;
      const tags = h('input', { type: 'text', id: 'csv-tags', value: options.tags, autocomplete: 'off', oninput: (e) => { options.tags = e.target.value; } });
      const dupes = h('input', { type: 'checkbox', id: 'csv-dupes', checked: options.skipDuplicates, onchange: (e) => { options.skipDuplicates = e.target.checked; refresh(); } });

      panel.append(
        stepIndicator(2),
        h('div', { class: 'wizard-options' },
          field('Separator', delimiter),
          field('Import into', deck),
          field('Card type', type, { hint: 'Text with {{c1::...}} always becomes a cloze.' }),
          field('Extra tags', tags)),
        h('div', { class: 'wizard-checks' },
          h('label', { class: 'check' }, header, 'First row is a header'),
          h('label', { class: 'check' }, dupes, 'Skip fronts already in the collection')),
        h('h3', { class: 'wizard-subhead' }, 'Map the columns'),
        previewHost,
        summaryHost,
        h('div', { class: 'button-row' },
          h('button', { class: 'btn', type: 'button', onclick: () => stepOne() }, 'Back'),
          importButton));
      host.replaceChildren(panel);
      refresh();
    }

    function stepThree(added, ready, before) {
      Toast.show(`Imported ${plural(added, 'note')}`, { onUndo: () => { Store.restore(before); App.refresh(); } });
      const cards = ready.reduce((sum, note) => sum + Cards.ordinalsFor(note).length, 0);
      wizard.text = '';
      host.replaceChildren(h('div', { class: 'wizard' },
        stepIndicator(3),
        h('p', { class: 'wizard-done', 'data-testid': 'import-result' }, `Imported ${plural(added, 'note')} as ${plural(cards, 'new card')}.`),
        h('div', { class: 'button-row' },
          h('a', { class: 'btn btn-primary', href: `#/browse?deck=${encodeURIComponent(options.deckId)}&state=new` }, 'View the new cards'),
          h('button', { class: 'btn', type: 'button', onclick: () => stepOne() }, 'Import another file'))));
    }

    stepOne();
  }

  function stepIndicator(active) {
    return h('ol', { class: 'steps', 'aria-label': 'Import steps' },
      ['Choose data', 'Preview and map', 'Done'].map((label, i) => h('li', { class: i + 1 === active ? 'is-active' : i + 1 < active ? 'is-done' : null, 'aria-current': i + 1 === active ? 'step' : null }, label)));
  }

  return { mount, analyse };
})();
