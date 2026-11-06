// Calendar helpers. A "day number" counts local calendar days, so it is stable
// across daylight saving changes and rolls over at the learner's midnight.
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

const Dates = {
  dayNumber(ts) {
    const d = new Date(ts);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  },

  today() {
    return Dates.dayNumber(Date.now());
  },

  /** Local timestamp of midnight at the start of a day number. */
  dayStart(day) {
    const utc = new Date(day * DAY_MS);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime();
  },

  toDate(day) {
    return new Date(Dates.dayStart(day));
  },

  monthDay(day) {
    return Dates.toDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  fullDate(day) {
    return Dates.toDate(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  },

  isoDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  /** Short interval used on grade buttons and in the browser: 42d, 4.2mo, 1.3y. */
  shortDays(days) {
    if (days < 90) return `${days}d`;
    if (days < 365) return `${(days / 30.44).toFixed(1)}mo`;
    return `${(days / 365.25).toFixed(1)}y`;
  },

  shortMinutes(minutes) {
    if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  },

  /** Plain words for a day distance: "today", "tomorrow", "in 12 days", "3 days ago". */
  relativeDay(day, today = Dates.today()) {
    const diff = day - today;
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
  },

  relativeMinutes(ms) {
    const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.round(minutes / 6) / 10} h`;
  },
};
