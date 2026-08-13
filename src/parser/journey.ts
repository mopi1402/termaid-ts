// Ported from src/termaid/parser/journey.py.

import { DEFAULT_SCORE, makeJourney, makeJourneySection, type Journey, type JourneySection } from "../model/journey.js";
import { pyInt, splitLines } from "../pycompat.js";

const COMMENT = "%%";
const TITLE = "title ";
const SECTION = "section ";
const FIELD = ":";
const ACTOR_SEPARATOR = ",";
const MIN_SCORE = 1;
const MAX_SCORE = 5;

/** A mermaid user journey definition. */
export function parseJourney(text: string): Journey {
  const lines = splitLines(text.trim());
  const journey = makeJourney();
  if (lines.length === 0) return journey;

  let section: JourneySection | null = null;

  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = line.trim();
    if (stripped === "") continue;
    const lower = stripped.toLowerCase();

    if (lower.startsWith(TITLE)) {
      journey.title = stripped.slice(TITLE.length).trim();
      continue;
    }

    if (lower.startsWith(SECTION)) {
      section = makeJourneySection(stripped.slice(SECTION.length).trim());
      journey.sections.push(section);
      continue;
    }

    if (!stripped.includes(FIELD)) continue;

    const parts = stripped.split(FIELD);
    const title = (parts[0] as string).trim();

    // A score that is not a whole number leaves the default standing, rather than fail the line.
    const written = parts.length >= 2 ? pyInt(parts[1] as string) : null;
    const score = written === null ? DEFAULT_SCORE : Math.max(MIN_SCORE, Math.min(MAX_SCORE, written));

    const actors =
      parts.length >= 3
        ? (parts[2] as string)
            .split(ACTOR_SEPARATOR)
            .map((a) => a.trim())
            .filter((a) => a !== "")
        : [];

    // A task written before any section still belongs somewhere, so an unnamed one opens here.
    if (section === null) {
      section = makeJourneySection("");
      journey.sections.push(section);
    }

    section.tasks.push({ title, score, actors });
  }

  return journey;
}
