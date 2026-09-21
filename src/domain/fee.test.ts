import { describe, expect, test } from "bun:test";
import { AppError } from "../lib/http";
import { computeFee, type FeeInput } from "./fee";

const run = (priceMode: FeeInput["priceMode"], feePayer: FeeInput["feePayer"], enteredPrice: number, ratePercent = 20, minimum = 20) =>
  computeFee({ priceMode, feePayer, enteredPrice, ratePercent, minimum });

// SPEC-001 §Fee computation reference rows + TASK-003 additions.
const rows: Array<[string, FeeInput["priceMode"], FeeInput["feePayer"], number, number, number, Partial<ReturnType<typeof run>>]> = [
  ["B=100 SELLER → 100/80/20", "FEE_ADDED", "SELLER", 100, 20, 20, { basePrice: 100, fee: 20, buyerPays: 100, sellerReceives: 80 }],
  ["B=100 BUYER → 120/100/20", "FEE_ADDED", "BUYER", 100, 20, 20, { basePrice: 100, fee: 20, buyerPays: 120, sellerReceives: 100 }],
  ["B=100 SPLIT → 110/90/20", "FEE_ADDED", "SPLIT", 100, 20, 20, { basePrice: 100, fee: 20, buyerPays: 110, sellerReceives: 90 }],
  ["B=50 BUYER → fee 20 (minimum), buyer 70", "FEE_ADDED", "BUYER", 50, 20, 20, { basePrice: 50, fee: 20, buyerPays: 70, sellerReceives: 50 }],
  ["FEE_INCLUDED T=120 BUYER → B=100", "FEE_INCLUDED", "BUYER", 120, 20, 20, { basePrice: 100, fee: 20, buyerPays: 120, sellerReceives: 100 }],
  ["rate 10% min 30, B=100 → fee 30 (AC-5)", "FEE_ADDED", "BUYER", 100, 10, 30, { basePrice: 100, fee: 30, buyerPays: 130, sellerReceives: 100, feeRatePercent: 10, feeMinimum: 30 }],
  ["FEE_INCLUDED T=121 BUYER → B=100, remainder to fee (Q-D default)", "FEE_INCLUDED", "BUYER", 121, 20, 20, { basePrice: 100, fee: 21, buyerPays: 121, sellerReceives: 100 }],
  ["FEE_INCLUDED T=100 SELLER → B=100 (buyer share 0)", "FEE_INCLUDED", "SELLER", 100, 20, 20, { basePrice: 100, fee: 20, buyerPays: 100, sellerReceives: 80 }],
  ["FEE_INCLUDED T=110 SPLIT → B=100", "FEE_INCLUDED", "SPLIT", 110, 20, 20, { basePrice: 100, fee: 20, buyerPays: 110, sellerReceives: 90 }],
  ["SPLIT rounds half up: B=105 → fee 21, buyer share 11", "FEE_ADDED", "SPLIT", 105, 20, 20, { basePrice: 105, fee: 21, buyerPays: 116, sellerReceives: 95 }],
];

describe("computeFee (SPEC-001 §Fee computation)", () => {
  for (const [name, mode, payer, price, rate, min, expected] of rows) {
    test(name, () => expect(run(mode, payer, price, rate, min)).toMatchObject(expected));
  }

  test("every result balances: buyerPays − sellerReceives = fee", () => {
    for (const [, mode, payer, price, rate, min] of rows) {
      const r = run(mode, payer, price, rate, min);
      expect(r.buyerPays - r.sellerReceives).toBe(r.fee);
    }
  });

  test("FEE_INCLUDED T=15 BUYER → VALIDATION_ERROR (no B ≥ 1 fits)", () => {
    expect(() => run("FEE_INCLUDED", "BUYER", 15)).toThrow(AppError);
    try {
      run("FEE_INCLUDED", "BUYER", 15);
    } catch (e) {
      expect((e as AppError).code).toBe("VALIDATION_ERROR");
      expect((e as AppError).status).toBe(400);
    }
  });

  test("enteredPrice < 1 or non-integer → VALIDATION_ERROR", () => {
    expect(() => run("FEE_ADDED", "BUYER", 0)).toThrow(AppError);
    expect(() => run("FEE_ADDED", "BUYER", 10.5)).toThrow(AppError);
  });
});
