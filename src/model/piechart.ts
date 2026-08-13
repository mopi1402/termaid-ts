// Ported from src/termaid/model/piechart.py.

export interface PieSlice {
  label: string;
  value: number;
}

export interface PieChart {
  title: string;
  showData: boolean;
  slices: PieSlice[];
  warnings: string[];
}

export const makePieChart = (): PieChart => ({ title: "", showData: false, slices: [], warnings: [] });
