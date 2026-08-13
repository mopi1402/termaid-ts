// Ported from src/termaid/renderer/themes.py.
//
// A theme maps a semantic style key onto a Rich style string, which `output/rich.ts` turns into the escape sequence a
// terminal paints with. The strings are kept in Rich's own spelling, so a theme reads here exactly as it does there.

/** The regions a chart is cut into, painted in turn: kanban columns, quadrant regions, timeline sections. */
export type SectionColors = readonly string[];

export interface Theme {
  name: string;
  node: string;
  edge: string;
  arrow: string;
  subgraph: string;
  label: string;
  edgeLabel: string;
  subgraphLabel: string;
  default: string;
  /** A solid theme fills whole regions with a background, where a text theme paints the drawn characters alone. */
  isSolid: boolean;
  /** The overall background. */
  bgDefault: string;
  /** The fill of a node box. */
  bgNode: string;
  /** The fill of a subgraph region. */
  bgSubgraph: string;
  sectionColors: SectionColors;
}

/** The first four must be told apart at a glance, a quadrant chart naming them: blue, red, green, amber. */
const DEFAULT_SECTION_COLORS: SectionColors = [
  "#14385C",
  "#5C1424",
  "#145C28",
  "#5C4814",
  "#3C145C",
  "#145C50",
  "#5C2814",
  "#28145C",
];

const NO_STYLE = "";

/** The dataclass's own defaults, so a theme below states only what it changes. */
type ThemeFields = Pick<Theme, "name" | "node" | "edge" | "arrow" | "subgraph" | "label" | "edgeLabel" | "subgraphLabel"> &
  Partial<Theme>;

const makeTheme = (fields: ThemeFields): Theme => ({
  default: NO_STYLE,
  isSolid: false,
  bgDefault: NO_STYLE,
  bgNode: NO_STYLE,
  bgSubgraph: NO_STYLE,
  sectionColors: DEFAULT_SECTION_COLORS,
  ...fields,
});

export const THEMES: ReadonlyMap<string, Theme> = new Map(
  (
    [
      makeTheme({
        name: "default",
        node: "cyan",
        edge: "dim white",
        arrow: "bold yellow",
        subgraph: "dim cyan",
        label: "bold white",
        edgeLabel: "italic dim",
        subgraphLabel: "bold cyan",
        sectionColors: ["#14385C", "#5C1424", "#145C28", "#5C4814", "#3C145C", "#145C50", "#5C2814", "#28145C"],
      }),
      makeTheme({
        name: "terra",
        node: "bold #D4845A",
        edge: "#8B7E6A",
        arrow: "bold #E8A87C",
        subgraph: "#A07858",
        label: "#F5E6D3",
        edgeLabel: "italic #B89A7A",
        subgraphLabel: "bold #E8A87C",
        sectionColors: ["#502010", "#104820", "#504008", "#0E2850", "#401038", "#084840", "#503008", "#201050"],
      }),
      makeTheme({
        name: "neon",
        node: "bold magenta",
        edge: "dim cyan",
        arrow: "bold green",
        subgraph: "dim magenta",
        label: "bold white",
        edgeLabel: "italic cyan",
        subgraphLabel: "bold cyan",
        sectionColors: ["#0A1050", "#500A18", "#0A500A", "#50400A", "#400A50", "#0A5040", "#502A0A", "#1A0A50"],
      }),
      makeTheme({
        name: "mono",
        node: "bold white",
        edge: "dim",
        arrow: "bold white",
        subgraph: "dim",
        label: "white",
        edgeLabel: "italic dim",
        subgraphLabel: "bold white",
        sectionColors: ["#1A1A1A", "#303030", "#242424", "#383838", "#202020", "#343434", "#282828", "#2C2C2C"],
      }),
      makeTheme({
        name: "amber",
        node: "bold #FFB000",
        edge: "#806000",
        arrow: "bold #FFD080",
        subgraph: "#906800",
        label: "#FFD580",
        edgeLabel: "italic #B08030",
        subgraphLabel: "bold #FFC040",
        sectionColors: ["#50300A", "#0A2850", "#285008", "#500A28", "#280A50", "#0A5038", "#502008", "#0A1050"],
      }),
      makeTheme({
        name: "phosphor",
        node: "bold #33FF33",
        edge: "#1A8C1A",
        arrow: "bold #66FF66",
        subgraph: "#228B22",
        label: "#AAFFAA",
        edgeLabel: "italic #339933",
        subgraphLabel: "bold #55DD55",
        sectionColors: ["#083008", "#0A4808", "#081850", "#484808", "#081850", "#084830", "#480808", "#180850"],
      }),
      makeTheme({
        name: "gruvbox",
        node: "#FABD2F",
        edge: "#8EC07C",
        arrow: "bold #FE8019",
        subgraph: "#B8BB26",
        label: "bold #EBDBB2",
        edgeLabel: "italic #D5C4A1",
        subgraphLabel: "bold #D5C4A1",
        isSolid: true,
        bgDefault: "on #282828",
        bgNode: "on #3C3836",
        bgSubgraph: "on #32302F",
        sectionColors: ["#502010", "#085020", "#504008", "#082850", "#48082A", "#085048", "#502808", "#180850"],
      }),
      makeTheme({
        name: "monokai",
        node: "#F92672",
        edge: "#66D9EF",
        arrow: "bold #A6E22E",
        subgraph: "#AE81FF",
        label: "bold #F8F8F2",
        edgeLabel: "italic #E6DB74",
        subgraphLabel: "bold #AE81FF",
        isSolid: true,
        bgDefault: "on #272822",
        bgNode: "on #3E3D32",
        bgSubgraph: "on #333328",
        sectionColors: ["#50102A", "#085040", "#405008", "#380850", "#085038", "#502A08", "#081850", "#501010"],
      }),
      makeTheme({
        name: "dracula",
        node: "#BD93F9",
        edge: "#6272A4",
        arrow: "bold #50FA7B",
        subgraph: "#FF79C6",
        label: "bold #F8F8F2",
        edgeLabel: "italic #8BE9FD",
        subgraphLabel: "bold #FF79C6",
        isSolid: true,
        bgDefault: "on #282A36",
        bgNode: "on #44475A",
        bgSubgraph: "on #383A4A",
        sectionColors: ["#2A1040", "#0E4028", "#40380A", "#102A40", "#3C0A24", "#0A403A", "#402010", "#1A1040"],
      }),
      makeTheme({
        name: "nord",
        node: "#88C0D0",
        edge: "#4C566A",
        arrow: "bold #A3BE8C",
        subgraph: "#81A1C1",
        label: "bold #ECEFF4",
        edgeLabel: "italic #B48EAD",
        subgraphLabel: "bold #81A1C1",
        isSolid: true,
        bgDefault: "on #2E3440",
        bgNode: "on #3B4252",
        bgSubgraph: "on #343C4A",
        sectionColors: ["#143858", "#0A5830", "#501848", "#584810", "#48100A", "#581020", "#2A5010", "#381058"],
      }),
      makeTheme({
        name: "solarized",
        node: "#268BD2",
        edge: "#586E75",
        arrow: "bold #B58900",
        subgraph: "#2AA198",
        label: "bold #FDF6E3",
        edgeLabel: "italic #CB4B16",
        subgraphLabel: "bold #2AA198",
        isSolid: true,
        bgDefault: "on #002B36",
        bgNode: "on #073642",
        bgSubgraph: "on #053440",
        sectionColors: ["#0A3048", "#0A4820", "#380A38", "#483808", "#08403A", "#480A20", "#2A4008", "#100A48"],
      }),
    ] satisfies Theme[]
  ).map((theme) => [theme.name, theme])
);

const DEFAULT_THEME = "default";

/** A theme by name, an unknown one falling back to the default. */
export function getTheme(name: string): Theme {
  return THEMES.get(name) ?? (THEMES.get(DEFAULT_THEME) as Theme);
}
