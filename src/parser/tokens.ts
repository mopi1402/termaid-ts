// Ported from src/termaid/parser/tokens.py.
//
// The token kinds a hand-written flowchart lexer would name. NOTHING reads them in the reference either: the parsers
// there match line shapes with regexes and never tokenise. Ported because the file is part of the tree, not because a
// caller wants it.

export enum TokenType {
  // Header
  GRAPH = "GRAPH",
  FLOWCHART = "FLOWCHART",
  DIRECTION = "DIRECTION", // TB, TD, LR, BT, RL

  // Structural
  SUBGRAPH = "SUBGRAPH",
  END = "END",
  DIRECTION_KW = "DIRECTION_KW", // the `direction` keyword inside a subgraph

  // Nodes
  ID = "ID",
  LABEL = "LABEL", // text inside shape delimiters

  // Shape delimiters
  BRACKET_OPEN = "BRACKET_OPEN", // [
  BRACKET_CLOSE = "BRACKET_CLOSE", // ]
  PAREN_OPEN = "PAREN_OPEN", // (
  PAREN_CLOSE = "PAREN_CLOSE", // )
  BRACE_OPEN = "BRACE_OPEN", // {
  BRACE_CLOSE = "BRACE_CLOSE", // }

  // Edges
  ARROW_SOLID = "ARROW_SOLID", // -->
  ARROW_DOTTED = "ARROW_DOTTED", // -.->
  ARROW_THICK = "ARROW_THICK", // ==>
  ARROW_OPEN = "ARROW_OPEN", // ---
  ARROW_DOTTED_OPEN = "ARROW_DOTTED_OPEN", // -.-
  ARROW_THICK_OPEN = "ARROW_THICK_OPEN", // ===
  ARROW_INVISIBLE = "ARROW_INVISIBLE", // ~~~
  ARROW_BIDIR = "ARROW_BIDIR", // <-->
  ARROW_CROSS = "ARROW_CROSS", // --x
  ARROW_CIRCLE = "ARROW_CIRCLE", // --o

  // Edge labels
  PIPE = "PIPE", // |
  EDGE_LABEL = "EDGE_LABEL", // text between pipes

  // Misc
  AMPERSAND = "AMPERSAND", // &
  CLASSDEF = "CLASSDEF", // the classDef keyword
  CLASS = "CLASS", // the class keyword, for a class assignment
  STYLE = "STYLE", // the style keyword
  CLICK = "CLICK", // the click keyword
  TRIPLE_COLON = "TRIPLE_COLON", // ::: , the shorthand for a style class
  SEMICOLON = "SEMICOLON", // ;
  COMMENT = "COMMENT", // %%
  NEWLINE = "NEWLINE",
  EOF = "EOF",
}
