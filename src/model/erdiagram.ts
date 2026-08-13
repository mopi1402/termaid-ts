// Ported from src/termaid/model/erdiagram.py.

export interface Attribute {
  /** The declared type, `string`, `int`, `varchar(255)`. */
  type: string;
  name: string;
  /** `PK`, `FK`, `UK`, in the order they were written. */
  keys: string[];
  comment: string;
}

export interface Entity {
  name: string;
  /** What `p[Person]` asked for it to be called on screen. */
  alias: string;
  attributes: Attribute[];
}

/** What the entity is called on screen, which is its alias where it has one. */
export const displayName = (entity: Entity): string => entity.alias || entity.name;

export interface Relationship {
  entity1: string;
  entity2: string;
  /** The left marker: `||`, `|o`, `}|`, `}o`. */
  card1: string;
  /** The right marker: `||`, `o|`, `|{`, `o{`. */
  card2: string;
  /** `solid` for an identifying relationship, `dashed` for one that is not. */
  lineStyle: string;
  label: string;
}

export interface ERDiagram {
  entities: Map<string, Entity>;
  relationships: Relationship[];
  direction: string;
  warnings: string[];
}

export const DEFAULT_DIRECTION = "TB";

export const makeEntity = (name: string): Entity => ({ name, alias: "", attributes: [] });

export const makeERDiagram = (): ERDiagram => ({
  entities: new Map(),
  relationships: [],
  direction: DEFAULT_DIRECTION,
  warnings: [],
});
