import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 24);

export function newAccountId(): string {
  return `account_${nanoid()}`;
}

export function newActionId(): string {
  return `saasaction_${nanoid()}`;
}
