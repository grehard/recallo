// Statistics page. Charts are drawn at the measured width of their card, and redrawn on
// resize, so axis labels stay legible rather than shrinking with a scaled viewBox.
const StatisticsView = (() => {
  let root = null;
  let deckId = '';
  let resizeTimer = null;
  let lastWidth = 0;

  function mount(container, params) {
    root = container;
    deckId = params.query.deck && Store.deck(params.query.deck) ? params.query.deck : '';
    window.addEventListener('resize', onResize);
    render();
  }

  function unmount() {
    window.removeEventListener('resize', onResize);
    clearTimeout(resizeTimer);
    Charts.hideTip();
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth !== lastWidth) render();
    }, 120);
  }

  function tile(label, value, note, testId) {
    return h('div', { class: 'tile' },
      h('div', { class: 'tile-label' }, label),
      h('div', { class: 'tile-value', 'data-testid': testId }, value),
      h('div', { class: 'tile-note' }, note));
  }

  const percent = (rate) => (rate === null ? 'No data' : `${(rate * 100).toFixed(1)}%`);

  function render() {
    lastWidth = window.innerWidth;
    const stats = Stats.compute(Store.state, deckId || null, Date.now());
    const scope = deckSelect(deckId, { includeAll: 'All decks', id: 'stats-deck' });
    scope.addEventListener('change', () => { deckId = scope.value; render(); });

    const grid = h('div', { class: 'stats-grid' });
    root.replaceChildren(h('div', { class: 'stats-page' },
      h('header', { class: 'page-head' },
        h('h1', {}, 'Statistics'),
        h('div', { class: 'stats-scope' }, h('label', { for: 'stats-deck' }, 'Showing'), scope)),
      h('div', { class: 'tiles' },
        tile('Retention, last 30 days', percent(stats.retention30.rate), `${stats.retention30.passed} of ${plural(stats.retention30.total, 'review')} recalled`, 'retention'),
        tile('Reviews, last 30 days', stats.reviews30.toLocaleString('en-US'), `${stats.activeDays30} active days, ${stats.minutes30} min`, 'reviews-30'),
        tile('Due today', stats.forecast[0].count.toLocaleString('en-US'), `${plural(stats.reviewsToday, 'review')} done today`, 'due-today'),
        tile('Streak', plural(stats.streak, 'day'), `${plural(stats.totalCards, 'card')} in total`, 'streak')),
      grid));

    // Widths are only known once the grid is in the page.
    const heatCard = chartCard('Review heatmap', 'stats-wide');
    const retentionCard = chartCard('Retention by week');
    const forecastCard = chartCard('Forecast, next 30 days');
    const intervalCard = chartCard('Interval distribution');
    const statesCard = chartCard('Card states');
    grid.append(heatCard.node, forecastCard.node, retentionCard.node, intervalCard.node, statesCard.node);

    drawHeatmap(heatCard, stats);
    drawForecast(forecastCard, stats);
    drawRetention(retentionCard, stats);
    drawIntervals(intervalCard, stats);
    drawStates(statesCard, stats);
  }

  function chartCard(title, extraClass = '') {
    const body = h('div', { class: 'chart-body' });
    const note = h('p', { class: 'chart-note' });
    const node = h('section', { class: `chart-card ${extraClass}`, 'aria-label': title }, h('h2', {}, title), note, body);
    return { node, body, note };
  }

  const widthOf = (card) => Math.max(240, Math.floor(card.body.clientWidth));

  function drawHeatmap(card, stats) {
    const width = widthOf(card);
    const weeks = width >= 700 ? 52 : 26; // a full year where there is room for it
    const activeDays = [...stats.days.keys()].filter((d) => d > stats.today - weeks * 7).length;
    card.note.textContent = `Reviews on ${plural(activeDays, 'day')} in the last ${weeks} weeks.`;
    card.body.append(
      h('div', { class: 'heatmap-scroll' }, Charts.heatmap({ days: stats.days, endDay: stats.today, weeks, width })),
      Charts.heatLegend(),
      Charts.dataTable('Reviews per day, last 30 days', ['Date', 'Reviews'], recentDays(stats)));
  }

  function recentDays(stats) {
    const rows = [];
    for (let day = stats.today; day > stats.today - 30; day--) {
      if (stats.days.has(day)) rows.push([Dates.monthDay(day), stats.days.get(day)]);
    }
    return rows;
  }

  function drawForecast(card, stats) {
    const total = stats.forecast.reduce((sum, f) => sum + f.count, 0);
    const busiest = stats.forecast.reduce((best, f) => (f.count > best.count ? f : best), stats.forecast[0]);
    card.note.textContent = busiest.count
      ? `${plural(total, 'card')} due in 30 days. Busiest: ${Dates.monthDay(busiest.day)} with ${busiest.count}.`
      : 'No cards come due in the next 30 days.';
    card.node.dataset.total = total;
    card.body.append(
      Charts.bars({
        items: stats.forecast.map((f) => ({
          label: f.offset === 0 ? 'Today' : `+${f.offset}`,
          value: f.count,
          tip: `${f.offset === 0 ? 'Today' : f.offset === 1 ? 'Tomorrow' : Dates.monthDay(f.day)}: ${plural(f.count, 'card')} due`,
          highlight: f.offset === 0,
        })),
        width: widthOf(card), tickEvery: 7, ariaLabel: 'Cards due per day over the next 30 days',
      }),
      Charts.dataTable('Cards due per day', ['Date', 'Cards due'], stats.forecast.filter((f) => f.count).map((f) => [Dates.monthDay(f.day), f.count])));
  }

  function drawRetention(card, stats) {
    const points = stats.weekly.map((w) => ({
      label: Dates.monthDay(w.endDay),
      rate: w.rate,
      tip: w.rate === null ? `Week to ${Dates.monthDay(w.endDay)}: no reviews` : `Week to ${Dates.monthDay(w.endDay)}: ${(w.rate * 100).toFixed(1)}% of ${plural(w.total, 'review')}`,
    }));
    card.note.textContent = 'Share of due reviews answered with anything but Again.';
    card.body.append(
      Charts.percentLine({ points, width: widthOf(card), ariaLabel: 'Weekly retention rate' }),
      Charts.dataTable('Weekly retention', ['Week ending', 'Retention', 'Reviews'], stats.weekly.filter((w) => w.total).map((w) => [Dates.monthDay(w.endDay), `${(w.rate * 100).toFixed(1)}%`, w.total])));
  }

  function drawIntervals(card, stats) {
    const total = stats.intervals.reduce((sum, b) => sum + b.count, 0);
    card.note.textContent = `Current interval of ${plural(total, 'review card')}.`;
    card.body.append(
      Charts.bars({
        items: stats.intervals.map((b) => ({ label: b.label, value: b.count, tip: `${b.label}: ${plural(b.count, 'card')}` })),
        width: widthOf(card), tickEvery: widthOf(card) < 420 ? 2 : 1, ariaLabel: 'Number of review cards by interval length',
      }),
      Charts.dataTable('Interval distribution', ['Interval', 'Cards'], stats.intervals.map((b) => [b.label, b.count])));
  }

  function drawStates(card, stats) {
    const { fresh, learning, young, mature, suspended } = stats.states;
    card.note.textContent = 'Mature cards have an interval of 21 days or more.';
    card.body.append(Charts.stackedBar({
      ariaLabel: `${fresh} new, ${learning} learning, ${young} young, ${mature} mature, ${suspended} suspended`,
      parts: [
        { key: 'mature', label: 'Mature', value: mature },
        { key: 'young', label: 'Young', value: young },
        { key: 'learning', label: 'Learning', value: learning },
        { key: 'new', label: 'New', value: fresh },
        { key: 'suspended', label: 'Suspended', value: suspended },
      ],
    }));
  }

  return { mount, unmount };
})();
