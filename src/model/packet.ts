// Ported from src/termaid/model/packet.py.

/** How many bits a row holds, which is what a network packet is drawn in. */
export const ROW_BITS = 32;

export interface PacketField {
  start: number;
  /** Inclusive, so a one-bit field has the same start and end. */
  end: number;
  label: string;
}

export interface Packet {
  fields: PacketField[];
  rowBits: number;
  warnings: string[];
}

export const makePacket = (): Packet => ({ fields: [], rowBits: ROW_BITS, warnings: [] });
export const fieldBits = (field: PacketField): number => field.end - field.start + 1;
