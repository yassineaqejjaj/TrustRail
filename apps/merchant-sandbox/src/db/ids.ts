import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 24);

export function newOrderId(): string {
  return `order_${nanoid()}`;
}

export function newRefundId(): string {
  return `refund_${nanoid()}`;
}
