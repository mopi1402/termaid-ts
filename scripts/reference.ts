// WHAT this port is judged against: the Python termaid itself, fetched from PyPI and pinned to a version.
//
// The Python and not a compiled build of it, because the compiled build was only ever an intermediary: measured, the
// two draw the same bytes for all 276 takes, and only one of them is the thing this port claims to reproduce.
//
// `uvx` belongs to the machine running a check, never to this package: nothing here is a dependency, a consumer
// installs none of it, and the reference is fetched and cached the first time a harness asks for it.

const RUNNER = "uvx";
const FROM_FLAG = "--from";
/**
 * The distribution, carrying the extra a THEMED render needs. Without `rich` the reference REFUSES a theme outright
 * rather than drawing it plain, so a harness that left it out would compare a refusal against a drawing and call every
 * painted take a divergence.
 */
const DISTRIBUTION = "termaid[rich]";
const COMMAND = "termaid";

/**
 * The reference version every frozen take belongs to. Its OWN fact and not this package's, which only happens to carry
 * the same number today: bumping it means re-running the oracle, and `fixtures/expected/reference.txt` is what records
 * which version answered.
 */
export const REFERENCE_VERSION = "0.8.0";

/** What a spawn runs. */
export const REFERENCE_COMMAND = RUNNER;

/** What must sit in FRONT of the reference's own flags, since the runner is asked for a tool before the tool is asked. */
export const REFERENCE_ARGV: readonly string[] = [
  FROM_FLAG,
  `${DISTRIBUTION}==${REFERENCE_VERSION}`,
  COMMAND,
];

/** The whole argv of one call: the runner's prefix, then what the reference itself is being asked. */
export const referenceArgs = (args: readonly string[]): string[] => [...REFERENCE_ARGV, ...args];
