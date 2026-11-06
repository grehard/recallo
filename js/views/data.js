// Import and export page, plus the scheduling settings modal.
const DataView = (() => {
  let root = null;

  function mount(container) {
    root = container;
    const csvHost = h('div', {});
    root.replaceChildren(h('div', { class: 'data-page' },
      h('header', { class: 'page-head' }, h('h1', {}, 'Import and export')),
      h('section', { class: 'panel', 'aria-labelledby': 'csv-title' },
        h('h2', { id: 'csv-title' }, 'Import cards from CSV or TSV'),
        csvHost),
      jsonPanel(),
      resetPanel()));
    Importer.mount(csvHost);
  }

  function collectionSummary() {
    const { decks, cards, log } = Store.state;
    return `${plural(decks.length, 'deck')}, ${plural(cards.length, 'card')}, ${plural(log.length, 'review')}`;
  }

  function jsonPanel() {
    const message = h('div', { 'aria-live': 'polite' });
    const fileInput = h('input', { type: 'file', id: 'json-file', accept: '.json,application/json', class: 'file-input', onchange: (e) => readJson(e.target.files[0], message, e.target) });
    return h('section', { class: 'panel', 'aria-labelledby': 'json-title' },
      h('h2', { id: 'json-title' }, 'Back up as JSON'),
      h('p', { class: 'panel-note' }, 'A JSON file holds everything: decks, cards, schedules, settings and review history.'),
      h('div', { class: 'json-grid' },
        h('div', {},
          h('p', { class: 'field-label' }, 'Export'),
          h('p', { class: 'muted', 'data-testid': 'collection-summary' }, collectionSummary()),
          h('button', { class: 'btn', type: 'button', onclick: exportCollection }, icon('download'), 'Export JSON')),
        h('div', { class: 'field' },
          h('label', { for: 'json-file' }, 'Import a JSON file'),
          fileInput)),
      message);
  }

  function exportCollection() {
    downloadFile(`recallo-${Dates.isoDate(Date.now())}.json`, Store.exportJson(), 'application/json');
    Toast.show(`Exported ${collectionSummary()}`);
  }

  function showJsonError(host, text) {
    host.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, text));
  }

  function readJson(file, host, input) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showJsonError(host, 'The file could not be read.');
    reader.onload = () => {
      input.value = '';
      let raw;
      try {
        raw = JSON.parse(String(reader.result));
      } catch (err) {
        showJsonError(host, 'This file is not valid JSON.');
        return;
      }
      if (!raw || raw.app !== 'recallo') {
        showJsonError(host, 'This JSON file was not exported from Recallo.');
        return;
      }
      try {
        confirmImport(Validate.normalize(raw), host);
      } catch (err) {
        showJsonError(host, err.message);
      }
    };
    reader.readAsText(file);
  }

  function confirmImport({ state, dropped }, host) {
    const applied = (message, change) => Toast.withUndo(message, change, () => mount(root));
    host.replaceChildren(h('div', { class: 'import-confirm', 'data-testid': 'json-preview' },
      h('p', {}, `This file holds ${plural(state.decks.length, 'deck')}, ${plural(state.cards.length, 'card')} and ${plural(state.log.length, 'review')}.`),
      dropped ? h('p', { class: 'form-error' }, `${plural(dropped, 'damaged record')} will be left out.`) : null,
      h('div', { class: 'button-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => applied('Collection replaced', () => Store.replace(state)) }, 'Replace my collection'),
        h('button', { class: 'btn', type: 'button', onclick: () => applied('Merged the new records', () => Store.merge(state)) }, 'Add what is new'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => host.replaceChildren() }, 'Cancel'))));
  }

  function resetPanel() {
    return h('section', { class: 'panel', 'aria-labelledby': 'reset-title' },
      h('h2', { id: 'reset-title' }, 'Reset demo data'),
      h('p', { class: 'panel-note' }, 'Replaces your collection with the three sample decks and their review history. You can undo this right after.'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        Toast.withUndo('Demo data restored', () => Store.resetDemo(), () => mount(root));
      } }, 'Reset demo data'));
  }

  // ---- Scheduling settings ----

  const parseSteps = (text) => text.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const validSteps = (steps) => steps.length > 0 && steps.every((n) => Number.isFinite(n) && n > 0 && n <= 14400);

  function wholeNumber(input, wrap, min, max) {
    const value = Number(input.value);
    const ok = input.value.trim() !== '' && Number.isInteger(value) && value >= min && value <= max;
    wrap.setError(ok ? '' : `Enter a whole number from ${min} to ${max}.`);
    return ok ? value : null;
  }

  function openSettings(onSaved) {
    const s = Store.state.settings;
    const learning = h('input', { type: 'text', id: 'set-learning', value: s.learningSteps.join(' '), 'data-autofocus': true, autocomplete: 'off' });
    const relearning = h('input', { type: 'text', id: 'set-relearning', value: s.relearningSteps.join(' '), autocomplete: 'off' });
    const graduating = h('input', { type: 'number', id: 'set-graduating', min: 1, max: 3650, value: s.graduatingInterval });
    const easy = h('input', { type: 'number', id: 'set-easy', min: 1, max: 3650, value: s.easyInterval });
    const leech = h('input', { type: 'number', id: 'set-leech', min: 0, max: 1000, value: s.leechThreshold });
    const learningField = field('Learning steps, in minutes', learning, { hint: 'New cards repeat at these delays before graduating.' });
    const relearningField = field('Relearning steps, in minutes', relearning, { hint: 'Forgotten cards repeat at these delays.' });
    const graduatingField = field('Graduating interval, days', graduating);
    const easyField = field('Easy interval, days', easy);
    const leechField = field('Leech after this many lapses', leech, { hint: 'The card is tagged leech and suspended. Use 0 to turn this off.' });

    function save() {
      const learningSteps = parseSteps(learning.value);
      const relearningSteps = parseSteps(relearning.value);
      const stepMessage = 'Enter one or more delays in minutes, separated by spaces.';
      learningField.setError(validSteps(learningSteps) ? '' : stepMessage);
      relearningField.setError(validSteps(relearningSteps) ? '' : stepMessage);
      const graduatingInterval = wholeNumber(graduating, graduatingField, 1, 3650);
      const easyInterval = wholeNumber(easy, easyField, 1, 3650);
      const leechThreshold = wholeNumber(leech, leechField, 0, 1000);
      if (!validSteps(learningSteps) || !validSteps(relearningSteps) || graduatingInterval === null || easyInterval === null || leechThreshold === null) return;
      Store.setSettings({ learningSteps, relearningSteps, graduatingInterval, easyInterval, leechThreshold });
      Modal.close();
      Toast.show('Scheduling settings saved');
      if (onSaved) onSaved();
    }

    Modal.open({
      title: 'Scheduling settings',
      body: h('form', { class: 'stack-form', onsubmit: (e) => { e.preventDefault(); save(); } },
        learningField, relearningField,
        h('div', { class: 'field-row' }, graduatingField, easyField),
        leechField,
        h('button', { type: 'submit', hidden: true, tabindex: -1 }, 'Save')),
      footer: [
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: () => Modal.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save settings'),
      ],
    });
  }

  return { mount, openSettings };
})();
