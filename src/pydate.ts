// No Python file of its own: this is `datetime.date` and the two calls the reference makes on it, `strptime` and
// `strftime`, written out. A civil date is held as a count of DAYS since 1970-01-01, so a difference between two of
// them is a subtraction and adding a duration is an addition, which is what the gantt chart does with them.

const EPOCH_YEAR = 1970;
const DAYS_PER_ERA = 146097;
const YEARS_PER_ERA = 400;
const EPOCH_SHIFT = 719468;
const MARCH = 3;
const MONTHS_PER_YEAR = 12;

/** A date as a count of days since 1970-01-01, negative before it. */
export type CivilDate = number;

export interface YearMonthDay {
  year: number;
  month: number;
  day: number;
}

/** Days since the epoch for a date that EXISTS, and nothing at all for one that does not: Python raises there. */
export function fromYMD(year: number, month: number, day: number): CivilDate | null {
  if (month < 1 || month > MONTHS_PER_YEAR || day < 1 || day > daysInMonth(year, month)) return null;
  return daysFromCivil(year, month, day);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Howard Hinnant's civil-from-days pair, which is exact for every year without a table. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / YEARS_PER_ERA);
  const yoe = y - era * YEARS_PER_ERA;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * DAYS_PER_ERA + doe - EPOCH_SHIFT;
}

export function toYMD(days: CivilDate): YearMonthDay {
  const z = days + EPOCH_SHIFT;
  const era = Math.floor(z / DAYS_PER_ERA);
  const doe = z - era * DAYS_PER_ERA;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * YEARS_PER_ERA;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? MARCH : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** The month names `%b` writes, which are the C locale's and never the machine's. */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_DIGITS = 2;

/** Python's `strftime("%b %d")`. */
export function formatMonthDay(days: CivilDate): string {
  const { month, day } = toYMD(days);
  return `${MONTH_ABBR[month - 1] as string} ${String(day).padStart(DAY_DIGITS, "0")}`;
}

/** Today, read off the machine's own calendar the way `date.today()` does. */
export function today(): CivilDate {
  const now = new Date();
  return daysFromCivil(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Where a two-digit year lands, which is CPython's own pivot. */
const CENTURY_PIVOT = 69;

/** The directives `strptime` is asked for here, and how many digits each one takes. */
const DIRECTIVES: Readonly<Record<string, readonly [string, number, number]>> = {
  Y: ["year", 1, 4],
  y: ["year2", 1, 2],
  m: ["month", 1, 2],
  d: ["day", 1, 2],
  H: ["hour", 1, 2],
  M: ["minute", 1, 2],
  S: ["second", 1, 2],
};

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Python's `datetime.strptime(text, format).date()`, cut down to the directives the gantt's own `dateFormat` can
 * produce. Nothing at all where the text does not match the format from end to end, or where the date does not exist.
 */
export function strptime(text: string, format: string): CivilDate | null {
  const order: string[] = [];
  const seen = new Set<string>();
  let pattern = "^";
  for (let i = 0; i < format.length; i++) {
    const ch = format[i] as string;
    if (ch !== "%") {
      pattern += /\s/.test(ch) ? "\\s+" : ch.replace(ESCAPE_RE, "\\$&");
      continue;
    }
    const directive = format[i + 1];
    if (directive === undefined) return null;
    i++;
    if (directive === "%") {
      pattern += "%";
      continue;
    }
    const known = DIRECTIVES[directive];
    if (known === undefined) return null;
    // CPython names each group after its directive, so a directive written TWICE is a pattern that will not compile.
    // What it raises there is `re.error`, which is NOT a ValueError and so escapes the catch a bad date is caught by:
    // a malformed `dateFormat` fails the whole render rather than falling back to the ISO reading below.
    if (seen.has(directive)) throw new Error(`redefinition of group name '${directive}'`);
    seen.add(directive);
    const [name, low, high] = known;
    order.push(name);
    pattern += `(\\d{${low},${high}})`;
  }

  const match = new RegExp(pattern + "$").exec(text);
  if (match === null) return null;

  // Nothing said is 1900-01-01, which is what CPython fills an unmatched field with.
  let year = 1900;
  let month = 1;
  let day = 1;
  order.forEach((name, i) => {
    const value = Number.parseInt(match[i + 1] as string, 10);
    if (name === "year") year = value;
    else if (name === "year2") year = value < CENTURY_PIVOT ? 2000 + value : 1900 + value;
    else if (name === "month") month = value;
    else if (name === "day") day = value;
  });

  return fromYMD(year, month, day);
}
