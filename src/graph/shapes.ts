// Ported from src/termaid/graph/shapes.py.

/** Every node shape a mermaid flowchart can spell, and the syntax each one is written with. */
export enum NodeShape {
  RECTANGLE = "RECTANGLE", // A[text] or plain A
  ROUNDED = "ROUNDED", // A(text)
  STADIUM = "STADIUM", // A([text])
  SUBROUTINE = "SUBROUTINE", // A[[text]]
  DIAMOND = "DIAMOND", // A{text}
  HEXAGON = "HEXAGON", // A{{text}}
  CIRCLE = "CIRCLE", // A((text))
  DOUBLE_CIRCLE = "DOUBLE_CIRCLE", // A(((text)))
  ASYMMETRIC = "ASYMMETRIC", // A>text]
  CYLINDER = "CYLINDER", // A[(text)]
  PARALLELOGRAM = "PARALLELOGRAM", // A[/text/]
  PARALLELOGRAM_ALT = "PARALLELOGRAM_ALT", // A[\text\]
  TRAPEZOID = "TRAPEZOID", // A[/text\]
  TRAPEZOID_ALT = "TRAPEZOID_ALT", // A[\text/]
  START_STATE = "START_STATE", // [*] start, a filled circle
  END_STATE = "END_STATE", // [*] end, a bullseye
  FORK_JOIN = "FORK_JOIN", // <<fork>> and <<join>>, a thick bar
  JUNCTION = "JUNCTION", // an invisible routing point
}
