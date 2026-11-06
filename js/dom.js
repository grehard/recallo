// Small DOM toolkit: element builder, icons, form fields, modal and toast.
// h() only ever creates text nodes from strings, so user text can't become markup.
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  appendChildren(node, children);
  return node;
}

const ICON_PATHS = {
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  chevron: ['M9 6l6 6-6 6'],
  sun: ['M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6L7 7', 'M17 17l1.4 1.4', 'M5.6 18.4L7 17', 'M17 7l1.4-1.4', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
  sliders: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5v4', 'M9 15v4'],
  play: ['M8 5l11 7-11 7z'],
  undo: ['M9 6L4 11l5 5', 'M4 11h10a5 5 0 0 1 5 5v2'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  upload: ['M12 16V5', 'M7 9l5-5 5 5', 'M5 20h14'],
  search: ['M15.5 15.5L20 20', 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  repeat: ['M17 3l4 4-4 4', 'M3 11V9a2 2 0 0 1 2-2h16', 'M7 21l-4-4 4-4', 'M21 13v2a2 2 0 0 1-2 2H3'],
};

function icon(name, size = 16) {
  return svg('svg', { class: 'icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    ICON_PATHS[name].map((d) => svg('path', { d })));
}

/** A labelled field with a slot for its validation message. */
function field(labelText, control, { hint, error } = {}) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  const errorNode = h('p', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: !error }, error || '');
  const hintNode = hint ? h('p', { class: 'field-hint', id: `${id}-hint` }, hint) : null;
  control.setAttribute('aria-describedby', [hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' '));
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, labelText), control, hintNode, errorNode);
  wrap.setError = (message) => {
    errorNode.textContent = message || '';
    errorNode.hidden = !message;
    if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
  };
  return wrap;
}

function deckSelect(selectedId, { exclude = [], includeAll = null, includeNone = null, id } = {}) {
  const select = h('select', { id });
  if (includeAll) select.append(h('option', { value: '' }, includeAll));
  if (includeNone) select.append(h('option', { value: '' }, includeNone));
  for (const { deck, path } of Store.deckList()) {
    if (exclude.includes(deck.id)) continue;
    select.append(h('option', { value: deck.id }, path));
  }
  select.value = selectedId || '';
  return select;
}

const Modal = (() => {
  let current = null;

  function focusable(root) {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
  }

  function onKey(event) {
    if (!current) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const items = focusable(current.panel);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  function open({ title, body, footer, wide, onClose }) {
    close();
    const titleId = 'modal-title';
    const panel = h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('header', { class: 'modal-head' },
        h('h2', { id: titleId }, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('div', { class: 'modal-body' }, body),
      footer ? h('footer', { class: 'modal-foot' }, footer) : null);
    const overlay = h('div', { class: 'modal-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, panel);
    current = { overlay, panel, onClose, returnFocus: document.activeElement };
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    const first = panel.querySelector('[data-autofocus]') || focusable(panel.querySelector('.modal-body'))[0] || focusable(panel)[0];
    if (first) first.focus();
  }

  function close() {
    if (!current) return;
    const { overlay, onClose, returnFocus } = current;
    current = null;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    if (onClose) onClose();
  }

  return { open, close, isOpen: () => current !== null };
})();

const Toast = (() => {
  const LIFETIME_MS = 9000;
  let region = null;

  function ensureRegion() {
    if (!region) {
      region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.append(region);
    }
    return region;
  }

  /** Shows a message, with an Undo button when onUndo is given. */
  function show(message, { onUndo, kind } = {}) {
    const host = ensureRegion();
    host.replaceChildren();
    const remove = () => toast.remove();
    const toast = h('div', { class: `toast${kind ? ` toast-${kind}` : ''}` },
      h('span', { class: 'toast-text' }, message),
      onUndo ? h('button', { class: 'toast-action', type: 'button', onclick: () => { remove(); onUndo(); } }, 'Undo') : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: remove }, icon('close', 14)));
    host.append(toast);
    setTimeout(remove, LIFETIME_MS);
  }

  function clear() {
    if (region) region.replaceChildren();
  }

  /**
   * Runs a change that can be taken back: snapshots first, offers Undo, then rerenders.
   * If the person has moved to another page by the time they undo, that page is redrawn.
   */
  function withUndo(message, change, rerender) {
    const before = Store.snapshot();
    const hash = location.hash;
    change();
    rerender();
    show(message, {
      onUndo: () => {
        Store.restore(before);
        if (location.hash === hash) rerender(); else App.refresh();
      },
    });
  }

  return { show, clear, withUndo };
})();

function plural(n, word, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : many || `${word}s`}`;
}

function downloadFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Renders card segments to nodes, with `backticks` as inline code. */
function renderSegments(segments) {
  const out = [];
  for (const segment of segments) {
    const inner = renderInlineCode(segment.text);
    if (segment.kind === 'hidden') out.push(h('span', { class: 'cloze cloze-hidden' }, inner));
    else if (segment.kind === 'revealed') out.push(h('mark', { class: 'cloze cloze-revealed' }, inner));
    else out.push(...inner);
  }
  return out;
}

function renderInlineCode(text) {
  return String(text).split(/(`[^`\n]+`)/).filter((p) => p !== '').map((part) => (
    part.length > 2 && part.startsWith('`') && part.endsWith('`')
      ? h('code', {}, part.slice(1, -1))
      : document.createTextNode(part)
  ));
}
