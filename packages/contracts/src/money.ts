import { z } from "zod";
import { CURRENCIES } from "./enums.js";

/**
 * Upper bound on any single amount, in minor units (EUR cents): 10,000,000.00 EUR.
 * Purely a sanity bound to reject overflow / fat-fingered input before it
 * reaches arithmetic; it is not a business limit (policies set those).
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

/**
 * Strict integer minor-unit amount. Rejects negatives, zero, non-integers,
 * and anything that could indicate a decimal was passed in error (e.g.
 * `80.5` is rejected; the caller must pass `8050` for EUR 80.50... but V1
 * policies only ever deal in whole-cent integers, decimals are rejected
 * outright per spec: "Reject negative amounts, zero refunds, decimals").
 */
export const amountMinorSchema = z
  .number()
  .int("amount_minor must be an integer number of minor units")
  .positive("amount_minor must be greater than zero")
  .max(MAX_AMOUNT_MINOR, "amount_minor exceeds the maximum allowed value");

export const currencySchema = z.enum(CURRENCIES);
