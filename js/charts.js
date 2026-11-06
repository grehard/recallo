// Hand-built SVG charts. Each takes plain data and a pixel width and returns an element.
// Colours come from CSS classes, so charts follow the light and dark themes.
const Charts = (() => {
  const CELL_GAP = 3;
  const LABEL_LEFT = 28;
  const LABEL_TOP = 16;

  // Rounds an axis top up to a tidy even number, so the halfway tick is a whole number too.
  function niceMax(value) {
    if (value <= 2) return 2;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) {
      const candidate = step * magnitude;
      if (candidate >= value && Number.isInteger(candidate) && candidate % 2 === 0) return candidate;
    }
    return Math.ceil(value / 2) * 2;
  }

  // ---- Tooltip shared by every chart ----

  let tooltip = null;

  function showTip(target, event) {
    if (!tooltip) {
      tooltip = h('div', { class: 'chart-tip', role: 'presentation' });
      document.body.append(tooltip);
    }
    tooltip.textContent = target.getAttribute('data-tip');
    tooltip.hidden = false;
    const box = tooltip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - box.width - 8, Math.max(8, event.clientX - box.width / 2));
    const y = event.clientY - box.height - 12;
    tooltip.style.transform = `translate(${x}px, ${y < 8 ? event.clientY + 16 : y}px)`;
  }

  function hideTip() {
    if (tooltip) tooltip.hidden = true;
  }

  function withTooltips(node) {
    const handle = (event) => {
      const target = event.target.closest && event.target.closest('[data-tip]');
      if (target) showTip(target, event); else hideTip();
    };
    node.addEventListener('pointermove', handle);
    node.addEventListener('pointerdown', handle);
    node.addEventListener('pointerleave', hideTip);
    return node;
  }

  // ---- Heatmap ----

  function heatLevel(count, max) {
    if (!count) return 0;
    const share = count / max;
    if (share <= 0.2) return 1;
    if (share <= 0.45) return 2;
    return share <= 0.7 ? 3 : 4;
  }

  /** Calendar of review counts: one column per week, ending in the week of endDay. */
  function heatmap({ days, endDay, weeks, width }) {
    const cell = Math.min(17, Math.max(9, Math.floor((width - LABEL_LEFT) / weeks) - CELL_GAP));
    const pitch = cell + CELL_GAP;
    const height = LABEL_TOP + pitch * 7;
    const fullWidth = LABEL_LEFT + pitch * weeks;
    const endWeekday = Dates.toDate(endDay).getDay();
    const firstDay = endDay - endWeekday - (weeks - 1) * 7;
    const max = Math.max(1, ...days.values());
    const root = svg('svg', { class: 'chart heatmap', width: fullWidth, height, viewBox: `0 0 ${fullWidth} ${height}`, role: 'img', 'aria-label': `Reviews per day for the last ${weeks} weeks` });

    for (const [row, name] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']]) {
      root.append(svg('text', { class: 'axis-label', x: 0, y: LABEL_TOP + row * pitch + cell - 2 }, name));
    }
    let lastMonth = null;
    for (let week = 0; week < weeks; week++) {
      const firstOfWeek = firstDay + week * 7;
      const month = Dates.toDate(firstOfWeek).getMonth();
      if (month !== lastMonth && week < weeks - 1) {
        if (lastMonth !== null || week === 0) {
          root.append(svg('text', { class: 'axis-label', x: LABEL_LEFT + week * pitch, y: 10 }, Dates.toDate(firstOfWeek).toLocaleDateString('en-US', { month: 'short' })));
        }
        lastMonth = month;
      }
      for (let weekday = 0; weekday < 7; weekday++) {
        const day = firstOfWeek + weekday;
        if (day > endDay) break;
        const count = days.get(day) || 0;
        root.append(svg('rect', {
          class: `heat heat-${heatLevel(count, max)}`,
          x: LABEL_LEFT + week * pitch, y: LABEL_TOP + weekday * pitch, width: cell, height: cell, rx: 2,
          'data-tip': `${Dates.fullDate(day)}: ${plural(count, 'review')}`,
        }));
      }
    }
    return withTooltips(root);
  }

  function heatLegend() {
    return h('div', { class: 'heat-legend', 'aria-hidden': 'true' },
      h('span', {}, 'Less'),
      [0, 1, 2, 3, 4].map((level) => h('i', { class: `heat-swatch heat-swatch-${level}` })),
      h('span', {}, 'More'));
  }

  // ---- Bars ----

  /** Vertical bars with a recessive grid. Items: { label, value, tip }. */
  function bars({ items, width, height = 180, tickEvery = 1, ariaLabel }) {
    const margin = { top: 10, right: 4, bottom: 22, left: 30 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
    const slot = plotWidth / items.length;
    const barWidth = Math.max(2, Math.min(slot - 2, 28));
    const y = (value) => margin.top + plotHeight - (value / max) * plotHeight;
    const root = svg('svg', { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });

    for (const tick of [0, 0.5, 1]) {
      const value = max * tick;
      root.append(svg('line', { class: 'grid-line', x1: margin.left, x2: width - margin.right, y1: y(value), y2: y(value) }));
      root.append(svg('text', { class: 'axis-label', x: margin.left - 6, y: y(value) + 4, 'text-anchor': 'end' }, Number.isInteger(value) ? value : value.toFixed(1)));
    }
    items.forEach((item, index) => {
      const cx = margin.left + slot * index + slot / 2;
      const top = y(item.value);
      const group = svg('g', { 'data-tip': item.tip });
      group.append(svg('title', {}, item.tip));
      group.append(svg('rect', { class: 'bar-hit', x: margin.left + slot * index, y: margin.top, width: slot, height: plotHeight }));
      if (item.value > 0) {
        const barHeight = Math.max(2, margin.top + plotHeight - top);
        group.append(svg('rect', { class: `bar${item.highlight ? ' bar-strong' : ''}`, x: cx - barWidth / 2, y: margin.top + plotHeight - barHeight, width: barWidth, height: barHeight, rx: 2 }));
      }
      root.append(group);
      if (index % tickEvery === 0) {
        root.append(svg('text', { class: 'axis-label', x: cx, y: height - 6, 'text-anchor': 'middle' }, item.label));
      }
    });
    return withTooltips(root);
  }

  // ---- Line ----

  /** Retention over time on a fixed 50-100% axis. Points: { label, rate, tip }; rate may be null. */
  function percentLine({ points, width, height = 180, ariaLabel }) {
    const margin = { top: 10, right: 12, bottom: 22, left: 36 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const floor = 0.5;
    const x = (i) => margin.left + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : plotWidth / 2);
    const y = (rate) => margin.top + plotHeight - ((Math.max(floor, rate) - floor) / (1 - floor)) * plotHeight;
    const root = svg('svg', { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });

    for (const tick of [0.5, 0.75, 1]) {
      root.append(svg('line', { class: 'grid-line', x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick) }));
      root.append(svg('text', { class: 'axis-label', x: margin.left - 6, y: y(tick) + 4, 'text-anchor': 'end' }, `${tick * 100}%`));
    }
    let path = '';
    let penDown = false;
    points.forEach((p, i) => {
      if (p.rate === null) { penDown = false; return; }
      path += `${penDown ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rate).toFixed(1)} `;
      penDown = true;
    });
    if (path) root.append(svg('path', { class: 'line', d: path }));

    const slot = plotWidth / Math.max(1, points.length - 1);
    points.forEach((p, i) => {
      const group = svg('g', { 'data-tip': p.tip });
      group.append(svg('title', {}, p.tip));
      group.append(svg('rect', { class: 'bar-hit', x: x(i) - slot / 2, y: margin.top, width: slot, height: plotHeight }));
      if (p.rate !== null) group.append(svg('circle', { class: 'dot', cx: x(i), cy: y(p.rate), r: 3.5 }));
      root.append(group);
      const fromEnd = points.length - 1 - i;
      if (fromEnd % 3 === 0) root.append(svg('text', { class: 'axis-label', x: x(i), y: height - 6, 'text-anchor': fromEnd === 0 ? 'end' : i === 0 ? 'start' : 'middle' }, p.label));
    });
    return withTooltips(root);
  }

  // ---- Segmented bar ----

  /** One horizontal bar split by share, with a legend carrying the counts. Parts: { key, label, value }. */
  function stackedBar({ parts, ariaLabel }) {
    const total = parts.reduce((sum, p) => sum + p.value, 0);
    const bar = h('div', { class: 'stack', role: 'img', 'aria-label': ariaLabel },
      parts.filter((p) => p.value > 0).map((p) => h('span', { class: `stack-part stack-${p.key}`, style: `flex-grow:${p.value}`, 'data-tip': `${p.label}: ${p.value}` })));
    const legend = h('ul', { class: 'stack-legend' }, parts.map((p) => h('li', {},
      h('i', { class: `stack-dot stack-${p.key}` }),
      h('span', {}, p.label),
      h('strong', {}, p.value.toLocaleString('en-US')),
      h('span', { class: 'muted' }, total ? `${Math.round((p.value / total) * 100)}%` : '0%'))));
    return h('div', {}, withTooltips(bar), legend);
  }

  /** A plain table version of a chart, for screen readers and exact values. */
  function dataTable(caption, headers, rows) {
    return h('details', { class: 'chart-table' },
      h('summary', {}, 'Show as table'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'plain-table' },
        h('caption', { class: 'sr-only' }, caption),
        h('thead', {}, h('tr', {}, headers.map((text) => h('th', { scope: 'col' }, text)))),
        h('tbody', {}, rows.map((row) => h('tr', {}, row.map((cell) => h('td', {}, cell))))))));
  }

  return { heatmap, heatLegend, bars, percentLine, stackedBar, dataTable, hideTip };
})();
