// Ported from src/termaid/model/timeline.py.

export interface TimelineEvent {
  title: string;
  details: string[];
}

export interface TimelineSection {
  title: string;
  events: TimelineEvent[];
}

export interface Timeline {
  title: string;
  sections: TimelineSection[];
  warnings: string[];
}

export const makeTimeline = (): Timeline => ({ title: "", sections: [], warnings: [] });
export const makeTimelineSection = (title: string): TimelineSection => ({ title, events: [] });
export const makeTimelineEvent = (title: string, details: string[] = []): TimelineEvent => ({ title, details });
