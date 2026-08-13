// No Python file of its own: this is what CPython does where JavaScript does something else, written out, because the
// port is judged on bytes.
//
// Three disagreements matter. Python rounds a tie to the EVEN digit where JavaScript rounds it up, so a slice at 12.5 %
// prints 12 there and 13 here. Python pads to a count of code points, which is not the terminal width a wide character
// takes. And `splitlines` cuts on line boundaries that `split("\n")` never sees.

/** Every boundary Python's `str.splitlines` cuts on. */
const LINE_BOUNDARY = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** Python's `str.splitlines`: no empty line invented after a trailing break, and nothing at all from an empty string. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(LINE_BOUNDARY);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Python's `\w`, which is unicode where JavaScript's is ASCII. Every pattern using it needs the `u` flag. */
export const PY_WORD_CHARS = "\\p{L}\\p{N}_";
export const PY_WORD = `[${PY_WORD_CHARS}]`;

/** Python's `str.lstrip()` and `str.rstrip()` with no argument, which cut whitespace alone. */
export const lstrip = (text: string): string => text.replace(/^\s+/, "");
export const rstrip = (text: string): string => text.replace(/\s+$/, "");

/** Python's `str.strip(chars)`: every leading and trailing character that is IN the set, not the set as a prefix. */
export function stripChars(text: string, chars: string): string {
  const set = new Set([...chars]);
  let start = 0;
  let end = text.length;
  while (start < end && set.has(text[start] as string)) start++;
  while (end > start && set.has(text[end - 1] as string)) end--;
  return text.slice(start, end);
}

/** What Python's `repr` writes for a control character it has no short escape for. */
const HEX_WIDTH = 2;
const ESCAPES: Readonly<Record<string, string>> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
const LAST_PRINTABLE = 0x7e;

/** Python's `repr` of a string, which a warning is written with: single quotes, unless that would need escaping. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (ch === "\\" || ch === quote) out += `\\${ch}`;
    else if (ESCAPES[ch] !== undefined) out += ESCAPES[ch];
    else if (code < 0x20 || code === LAST_PRINTABLE + 1) out += `\\x${code.toString(16).padStart(HEX_WIDTH, "0")}`;
    else out += ch;
  }
  return quote + out + quote;
}

/** Python's `<` on strings, which orders by CODE POINT where JavaScript orders by UTF-16 code unit. */
export function pyCompare(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const d = (left[i] as string).codePointAt(0)! - (right[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return left.length - right.length;
}

/** Python's `sorted` on strings. */
export function pySorted(values: Iterable<string>): string[] {
  return [...values].sort(pyCompare);
}

/** What Python's `float(text)` accepts, which is not what `Number(text)` accepts: no hex, no empty string, no `0x`. */
const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INFINITY_RE = /^[+-]?(?:inf|infinity)$/i;
const NAN_RE = /^[+-]?nan$/i;

/** Python's `float(text)`, or nothing at all where it would raise. */
export function pyFloat(text: string): number | null {
  const stripped = text.trim().replaceAll("_", "");
  if (FLOAT_RE.test(stripped)) return Number.parseFloat(stripped);
  if (INFINITY_RE.test(stripped)) return stripped.startsWith("-") ? -Infinity : Infinity;
  if (NAN_RE.test(stripped)) return Number.NaN;
  return null;
}

/** Python's `int(text)`, which is a whole number or nothing at all: `3.0` raises there, so it reads as nothing here. */
export function pyInt(text: string): number | null {
  const stripped = text.trim();
  return /^[+-]?\d+$/.test(stripped) ? Number.parseInt(stripped, 10) : null;
}

const RADIX = 10n;
const TIE = 2n;

/** A double as the exact pair (m, e) with x === m * 2^e, which is the only way a tie can be told from a near-miss. */
function decompose(x: number): { m: bigint; e: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));
  const negative = (bits >> 63n) === 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xf_ffff_ffff_ffffn;
  // A subnormal carries no implicit leading bit, and its exponent is the smallest one rather than one below it.
  const m = biased === 0 ? fraction : fraction | 0x10_0000_0000_0000n;
  const e = biased === 0 ? -1074 : biased - 1075;
  return { m: negative ? -m : m, e };
}

/** `x * 10^digits` rounded to an integer, a tie going to the even one, which is what Python does everywhere. */
export function roundScaled(x: number, digits: number): bigint {
  if (!Number.isFinite(x)) throw new RangeError(`pycompat: ${x} has no decimal form`);
  const { m, e } = decompose(x);
  let numerator = m;
  let denominator = 1n;
  // A NEGATIVE count of digits rounds above the point, which `%g` asks for as soon as a value passes six figures.
  if (digits >= 0) numerator *= RADIX ** BigInt(digits);
  else denominator *= RADIX ** BigInt(-digits);
  if (e >= 0) numerator <<= BigInt(e);
  else denominator <<= BigInt(-e);

  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const doubled = (magnitude - quotient * denominator) * TIE;
  if (doubled > denominator || (doubled === denominator && (quotient & 1n) === 1n)) quotient += 1n;
  return negative ? -quotient : quotient;
}

/** Python's `round(x)`: the nearest integer, a tie going to the even one. */
export const pyRound = (x: number): number => Number(roundScaled(x, 0));

/** Python's `f"{x:.Nf}"`, the sign kept even where the digits all round away. */
export function formatFixed(x: number, digits: number): string {
  const scaled = roundScaled(x, digits);
  const negative = scaled < 0n || (scaled === 0n && (x < 0 || Object.is(x, -0)));
  const body = (scaled < 0n ? -scaled : scaled).toString().padStart(digits + 1, "0");
  const whole = body.slice(0, body.length - digits);
  const sign = negative ? "-" : "";
  return digits === 0 ? `${sign}${whole}` : `${sign}${whole}.${body.slice(body.length - digits)}`;
}

/** Python's default `%g` precision: how many significant digits it keeps before it starts trimming. */
const G_PRECISION = 6;
/** Where `%g` gives up on plain digits and writes an exponent instead. */
const G_LOW_EXPONENT = -4;
const EXPONENT_DIGITS = 2;

/** The trailing zeros `%g` drops, and the point left bare once they are gone. */
const trimmed = (text: string): string =>
  text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;

/** Python's `f"{x:g}"`, which is how a raw value is printed beside a percentage. */
export function formatG(x: number, precision: number = G_PRECISION): string {
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";

  // The decimal exponent AFTER rounding: 9.9999999 at six digits is 10, one decade up from where log10 puts it.
  let exponent = Math.floor(Math.log10(Math.abs(x)));
  for (let guard = 0; guard < 2; guard++) {
    const scaled = roundScaled(x, precision - 1 - exponent);
    const digits = (scaled < 0n ? -scaled : scaled).toString().length;
    if (digits === precision) break;
    exponent += digits - precision;
  }

  if (exponent < G_LOW_EXPONENT || exponent >= precision) {
    const mantissa = trimmed(formatFixed(x / 10 ** exponent, precision - 1));
    const sign = exponent < 0 ? "-" : "+";
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(EXPONENT_DIGITS, "0")}`;
  }
  return trimmed(formatFixed(x, Math.max(0, precision - 1 - exponent)));
}

/**
 * Where `repr` gives up on plain digits: a value is written with an exponent below the first bound and above the
 * second, and in fixed notation between them. JavaScript's own bounds are elsewhere, which is the whole difficulty.
 */
const REPR_LOW_DECPT = -4;
const REPR_HIGH_DECPT = 16;
const NOT_A_NUMBER = "nan";
const INFINITE = "inf";
const POINT_ZERO = ".0";

/**
 * Python's `str()` of a FLOAT, which JavaScript's own has three differences with: an integral value keeps its `.0`,
 * the switch to an exponent happens far earlier, and the exponent is written with a sign and two digits.
 *
 * The shortest round-tripping digits are the same in both languages, so those are taken from JavaScript and only the
 * shape around them is rebuilt.
 */
export function pyFloatStr(x: number): string {
  if (Number.isNaN(x)) return NOT_A_NUMBER;
  if (!Number.isFinite(x)) return x > 0 ? INFINITE : `-${INFINITE}`;

  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  const shortest = Math.abs(x).toExponential();
  const [mantissa, exponentText] = shortest.split("e") as [string, string];
  const digits = mantissa.replace(".", "");
  // `decpt` is where the point sits counted from the LEFT of the digits, the way CPython's own formatter counts it.
  const decpt = Number(exponentText) + 1;

  if (x === 0) return `${sign}0${POINT_ZERO}`;

  if (decpt <= REPR_LOW_DECPT || decpt > REPR_HIGH_DECPT) {
    const head = digits.slice(0, 1);
    const tail = digits.slice(1);
    const exponent = decpt - 1;
    const exponentSign = exponent < 0 ? "-" : "+";
    const body = tail === "" ? head : `${head}.${tail}`;
    return `${sign}${body}e${exponentSign}${String(Math.abs(exponent)).padStart(EXPONENT_DIGITS, "0")}`;
  }

  if (decpt <= 0) return `${sign}0.${"0".repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${"0".repeat(decpt - digits.length)}${POINT_ZERO}`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

/** Python's `str.rjust`, which counts CODE POINTS and so pads a wide character as if it took one column. */
export function rjust(text: string, width: number, fill = " "): string {
  const missing = width - [...text].length;
  return missing > 0 ? fill.repeat(missing) + text : text;
}

/** Python's `str.ljust`. */
export function ljust(text: string, width: number, fill = " "): string {
  const missing = width - [...text].length;
  return missing > 0 ? text + fill.repeat(missing) : text;
}

/**
 * Python's `str.center`. The odd column goes right, EXCEPT where the padding and the target width are both odd, which
 * is CPython's `marg / 2 + (marg & width & 1)` and the reason "ab".center(5) leans the other way from "abc".center(6).
 */
export function center(text: string, width: number, fill = " "): string {
  const missing = width - [...text].length;
  if (missing <= 0) return text;
  const left = Math.floor(missing / 2) + (missing & width & 1);
  return fill.repeat(left) + text + fill.repeat(missing - left);
}
