# Changelog

This file records what THIS package changes, release by release. The upstream
[termaid](https://github.com/fasouto/termaid) keeps its own history: the version's major.minor names the termaid
release the port reproduces, and the patch counts this package's own additions on top of it. An entry marked ◉ is
such an addition, with no counterpart in termaid; every other entry ports something the upstream did.

## 0.8.1 (2026-08-13)

- ◉ `declaredType(source)` answers the type a source declares, `null` where the fallback would draw boxes of its syntax

## 0.8.0 (2026-08-13, termaid 0.8.0)

- Initial release: the termaid 0.8.0 renderer ported to TypeScript, held to byte parity with the reference
