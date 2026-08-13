// Ported from src/termaid/model/quadrant.py.

export interface QuadrantPoint {
  label: string;
  /** Both from 0 to 1, the origin at the bottom left. */
  x: number;
  y: number;
}

export interface QuadrantChart {
  title: string;
  xLabel: string;
  yLabel: string;
  /** Clockwise from the top right, which is how mermaid numbers them. */
  quadrant1: string;
  quadrant2: string;
  quadrant3: string;
  quadrant4: string;
  points: QuadrantPoint[];
  warnings: string[];
}

export const makeQuadrantChart = (): QuadrantChart => ({
  title: "",
  xLabel: "",
  yLabel: "",
  quadrant1: "Q1",
  quadrant2: "Q2",
  quadrant3: "Q3",
  quadrant4: "Q4",
  points: [],
  warnings: [],
});
