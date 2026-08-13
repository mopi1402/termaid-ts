// Ported from src/termaid/model/journey.py.

/** How satisfying a step was, from one to five. */
export const DEFAULT_SCORE = 3;

export interface JourneyTask {
  title: string;
  score: number;
  actors: string[];
}

export interface JourneySection {
  title: string;
  tasks: JourneyTask[];
}

export interface Journey {
  title: string;
  sections: JourneySection[];
  warnings: string[];
}

export const makeJourney = (): Journey => ({ title: "", sections: [], warnings: [] });
export const makeJourneySection = (title: string): JourneySection => ({ title, tasks: [] });
