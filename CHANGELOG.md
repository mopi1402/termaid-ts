# Changelog

This file records what THIS package changes, release by release. The upstream
[termaid](https://github.com/fasouto/termaid) keeps its own history: the version's major.minor names the termaid
release the port reproduces, and the patch counts this package's own additions on top of it. An entry marked ◉ is
such an addition, with no counterpart in termaid; every other entry ports something the upstream did.

## 0.8.2 (2026-08-15)

- ◉ `background: "light"` paints a drawing for a light terminal, every colour mirrored about its luminance, hue kept
- ◉ The mirror sits at the ONE seam a colour crosses, so a theme's palette, a chart's sections and a node's own `fill` all turn together
- ◉ Asking for `dark`, or asking for nothing, moves not a byte: the parity the bench measures is the default path

## 0.8.1 (2026-08-13)

- ◉ `declaredType(source)` answers the type a source declares, `null` where the fallback would draw boxes of its syntax

## 0.8.0 (2026-08-13, termaid 0.8.0)

- Initial release: the termaid 0.8.0 renderer ported to TypeScript, held to byte parity with the reference
