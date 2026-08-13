# @tayomi/termaid-ts

Mermaid diagrams drawn as Unicode art in the terminal.

A TypeScript port of [termaid](https://github.com/fasouto/termaid) by Fabio Souto, held to **byte parity** with it: the
same source, the same width and the same theme produce the same bytes as the reference binary, colour codes included.

> This is an unofficial port, not affiliated with the termaid project. See [What this is a port of](#what-this-is-a-port-of).

```
╭───────────╮
│           │
│   Idle    │◄──╮
│           │   │
╰─────┬─────╯   │
      │         │stop
 start│         │
      ▼         │
╭───────────╮   │
│           │   │
│  Running  ├───╯
│           │
╰───────────╯
```

## Install

```sh
npm install @tayomi/termaid-ts
```

No runtime dependencies. Node 22 or later.

## Use it as a library

```ts
import { render, renderThemedText, printToConsole } from "@tayomi/termaid-ts";

const source = "stateDiagram-v2\n  Idle --> Running : start\n";

// plain text
console.log(render(source, { width: 80 }));

// painted, folded to a console's width the way the reference's own console does
process.stdout.write(printToConsole(renderThemedText(source, { width: 80 }, "neon")));
```

`render` and `renderThemedText` take the same `Options` the command line exposes: `width`, `useAscii`, `paddingX`,
`paddingY`, `roundedEdges`, `gap`. Every parser and every renderer is exported by name too, for a caller that wants one
diagram kind without the dispatcher.

`renderThemedText` returns a `Text`, not a string: a painted drawing is a grid of styled cells, and folding it to a
width is the console's job rather than the library's. `renderThemed` is the shortcut that paints and stringifies in one
call, without folding.

## Use it as a command

```sh
termaid diagram.mmd --width 100 --theme neon
echo 'graph LR; A-->B' | termaid
termaid --themes
termaid --demo
```

Colour follows the same rule the reference follows, which is Rich's: `NO_COLOR` silences everything, a dumb `TERM`
silences it too, and what is left paints on a terminal alone or where `FORCE_COLOR` holds a non-empty value.

## Diagram kinds

Flowchart, state, sequence, class, ER, gantt, git graph, journey, kanban, mindmap, packet, pie, quadrant, timeline,
treemap, xy chart, architecture, block.

## How parity is held

Three checks, and none of them trusts the other two.

| Command | What it answers |
| --- | --- |
| `bun run compare` | the port against takes of the reference frozen under `fixtures/expected/` |
| `bun run differential` | the port against the LIVE binary, on a deliberately hostile corpus of mutated sources |
| `bun run verify` | the typecheck and the suite |

The frozen takes say what the binary drew the day the oracle ran, so a version bump invalidates all of them at once:
`bun run oracle` writes them again. The differential harness is the one that catches what frozen takes cannot, since it
feeds both sides truncated lines, unclosed delimiters, empty labels and arrows inside labels, and a port has to be wrong
in exactly the same way as the reference.

## What this is a port of

[termaid](https://github.com/fasouto/termaid) is a Python tool by **Fabio Souto**, MIT licensed. It reads Mermaid and
draws it in the terminal. This package is that tool rewritten in TypeScript, so a Node project can draw the same
diagrams without spawning a Python process.

Three things are worth knowing about how the rewrite was done.

**It is a port, not a reimplementation.** The Python module tree is kept file for file, so `parser/gantt.py` is
`parser/gantt.ts` and an upstream change names its own place here. Where CPython or [Rich](https://github.com/Textualize/rich)
have a behaviour JavaScript does not, that behaviour is written out rather than approximated: `pycompat.ts` holds the
CPython semantics the port leans on (banker's rounding, `%g`, `str.center`, code point ordering) and `richcompat.ts`
holds the slice of Rich it depends on, down to Rich emitting one SGR sequence per character.

**Parity is the specification, not an aspiration.** The reference binary's own bytes are the only verdict: what
`termaid 0.8.0` draws is frozen under `fixtures/expected/`, and a fixture counts only once the port renders the same
bytes. The version number tracks the reference it answers to.

**It is verified against the live binary, not only against frozen output.** Frozen takes say what the reference drew on
one day, for sources someone chose. The differential harness runs both implementations side by side on a hostile
corpus, and it has already found things frozen takes could not: a case where the reference is non deterministic, and a
malformed date format the port accepted where CPython refuses the whole render.

**Not affiliated with the termaid project.** MIT permits the derivative work and this package carries the original
copyright notice; the name says what it is a port of, nothing more. See [NOTICE.md](NOTICE.md).

### What is not ported

`--tui`, the Textual interface, which has no equivalent here. The command reports that and exits.
