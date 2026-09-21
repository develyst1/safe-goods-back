// SPEC-001 §Fee computation — the single BE implementation. Pure; no Hono, no DB.
import { AppError } from "../lib/http";

export type PriceMode = "FEE_ADDED" | "FEE_INCLUDED";
export type FeePayer = "SELLER" | "BUYER" | "SPLIT";

export type FeeInput = {
  priceMode: PriceMode;
  feePayer: FeePayer;
  enteredPrice: number; // int ≥ 1
  ratePercent: number; // 0..100
  minimum: number; // int ≥ 0
};

export type FeeResult = {
  basePrice: number;
  fee: number;
  buyerPays: number;
  sellerReceives: number;
  feeRatePercent: number;
  feeMinimum: number;
};

const feeOf = (base: number, ratePercent: number, minimum: number): number =>
  Math.max(Math.ceil((ratePercent * base) / 100), minimum);

const buyerShareOf = (fee: number, payer: FeePayer): number =>
  payer === "SELLER" ? 0 : payer === "BUYER" ? fee : Math.ceil(fee / 2);

// Amounts for a given base price B (before the FEE_INCLUDED remainder rule).
const split = (base: number, input: FeeInput) => {
  const fee = feeOf(base, input.ratePercent, input.minimum);
  const buyerShare = buyerShareOf(fee, input.feePayer);
  return { fee, buyerShare, sellerShare: fee - buyerShare, buyerPays: base + buyerShare };
};

export const computeFee = (input: FeeInput): FeeResult => {
  const { enteredPrice: entered, ratePercent, minimum } = input;
  if (!Number.isInteger(entered) || entered < 1) throw new AppError(400, "VALIDATION_ERROR", "enteredPrice must be an integer ≥ 1");

  let base: number;
  let remainder = 0;
  if (input.priceMode === "FEE_ADDED") {
    base = entered;
  } else {
    // FEE_INCLUDED: T = entered; B = largest integer ≥ 1 with B + buyerShare(feeOf(B)) ≤ T.
    // buyerPays(B) is non-decreasing in B, so binary-search the boundary.
    if (split(1, input).buyerPays > entered) throw new AppError(400, "VALIDATION_ERROR", "price too low for the fee");
    let lo = 1;
    let hi = entered;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (split(mid, input).buyerPays <= entered) lo = mid;
      else hi = mid - 1;
    }
    base = lo;
    // Q-D default: the 1-baht remainder goes to the fee so the buyer pays exactly T.
    remainder = entered - split(base, input).buyerPays;
  }

  const s = split(base, input);
  return {
    basePrice: base,
    fee: s.fee + remainder,
    buyerPays: s.buyerPays + remainder,
    sellerReceives: base - s.sellerShare,
    feeRatePercent: ratePercent,
    feeMinimum: minimum,
  };
};
