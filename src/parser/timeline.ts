// Ported from src/termaid/parser/timeline.py.

import { makeTimeline, makeTimelineEvent, makeTimelineSection, type Timeline, type TimelineSection } from "../model/timeline.js";
import { splitLines } from "../pycompat.js";

const COMMENT = "%%";
const TITLE = "title ";
const SECTION = "section ";
/** What separates an event from its details, spaces included: a colon alone is part of the title. */
const DETAILS = " : ";
const DETAIL_SEPARATOR = ",";

/** A mermaid timeline definition. */
export function parseTimeline(text: string): Timeline {
  const lines = splitLines(text.trim());
  const timeline = makeTimeline();
  if (lines.length === 0) return timeline;

  let section: TimelineSection | null = null;

  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = line.trim();
    if (stripped === "") continue;

    const lower = stripped.toLowerCase();
    if (lower.startsWith(TITLE)) {
      timeline.title = stripped.slice(TITLE.length).trim();
      continue;
    }

    if (lower.startsWith(SECTION)) {
      section = makeTimelineSection(stripped.slice(SECTION.length).trim());
      timeline.sections.push(section);
      continue;
    }

    // An event written before any section still belongs somewhere, so an unnamed one opens here.
    if (section === null) {
      section = makeTimelineSection("");
      timeline.sections.push(section);
    }

    const at = stripped.indexOf(DETAILS);
    const title = at >= 0 ? stripped.slice(0, at) : stripped;
    const details =
      at >= 0
        ? stripped
            .slice(at + DETAILS.length)
            .split(DETAIL_SEPARATOR)
            .map((d) => d.trim())
            .filter((d) => d !== "")
        : [];

    section.events.push(makeTimelineEvent(title.trim(), details));
  }

  return timeline;
}
