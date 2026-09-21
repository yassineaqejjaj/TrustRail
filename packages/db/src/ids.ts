import { customAlphabet } from "nanoid";
import { PREFIXES } from "@trustrail/contracts";

// Unambiguous alphabet (no 0/O/I/l), 24 chars -> well above the 20-char
// minimum the contracts' idSchema regex requires.
const nanoid = customAlphabet("23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 24);

export function newId(kind: keyof typeof PREFIXES): string {
  return `${PREFIXES[kind]}_${nanoid()}`;
}
