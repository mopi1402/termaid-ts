// Ported from src/termaid/model/xychart.py.

/** How a series is drawn. */
export type ChartType = "bar" | "line";

export interface XYDataset {
  label: string;
  values: number[];
  chartType: ChartType;
}

export interface XYChart {
  title: string;
  xLabel: string;
  yLabel: string;
  xCategories: string[];
  /** The bounds an axis was declared with, as `min --> max`. */
  xRange: readonly [number, number] | null;
  yRange: readonly [number, number] | null;
  datasets: XYDataset[];
  horizontal: boolean;
  warnings: string[];
}

export const makeXYChart = (): XYChart => ({
  title: "",
  xLabel: "",
  yLabel: "",
  xCategories: [],
  xRange: null,
  yRange: null,
  datasets: [],
  horizontal: false,
  warnings: [],
});

export const makeXYDataset = (values: number[], chartType: ChartType): XYDataset => ({
  label: "",
  values,
  chartType,
});
