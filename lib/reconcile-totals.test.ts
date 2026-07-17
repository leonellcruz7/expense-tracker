import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeProjectedTotal,
  defaultReconcileSelection,
  parseExpectedTotal,
  totalsMatch,
  type ReconcileTotalChange,
} from "./reconcile-totals";

const row = (
  partial: Partial<ReconcileTotalChange> & Pick<ReconcileTotalChange, "id" | "kind">,
): ReconcileTotalChange => ({
  statement: null,
  tracked: null,
  ...partial,
});

describe("defaultReconcileSelection", () => {
  it("selects add/update/kept/locked and skips unchanged", () => {
    const selected = defaultReconcileSelection([
      { id: "a", kind: "add" },
      { id: "u", kind: "update" },
      { id: "k", kind: "kept" },
      { id: "l", kind: "locked" },
      { id: "x", kind: "unchanged" },
    ]);
    assert.deepEqual(selected, { a: true, u: true, k: true, l: true });
  });
});

describe("computeProjectedTotal", () => {
  it("matches default UI new-total math including locked", () => {
    const changes: ReconcileTotalChange[] = [
      row({ id: "1", kind: "add", statement: { amount: 100 } }),
      row({ id: "2", kind: "update", statement: { amount: 50 }, tracked: { amount: 40 } }),
      row({ id: "3", kind: "unchanged", tracked: { amount: 20 } }),
      row({ id: "4", kind: "kept", tracked: { amount: 10 } }),
      row({ id: "5", kind: "locked", tracked: { amount: 5 } }),
    ];
    const selected = defaultReconcileSelection(changes);
    assert.equal(computeProjectedTotal(changes, selected), 185);
  });

  it("respects unchecked kept/locked and unselected update falls back to tracked", () => {
    const changes: ReconcileTotalChange[] = [
      row({ id: "2", kind: "update", statement: { amount: 50 }, tracked: { amount: 40 } }),
      row({ id: "4", kind: "kept", tracked: { amount: 10 } }),
      row({ id: "5", kind: "locked", tracked: { amount: 5 } }),
    ];
    assert.equal(computeProjectedTotal(changes, { "2": false, "4": false, "5": true }), 45);
  });
});

describe("totalsMatch", () => {
  it("allows 0.01 tolerance", () => {
    assert.equal(totalsMatch(10, 10.01), true);
    assert.equal(totalsMatch(10, 10.02), false);
  });
});

describe("parseExpectedTotal", () => {
  it("accepts positive finite numbers", () => {
    assert.equal(parseExpectedTotal(12.34), 12.34);
  });

  it("rejects missing, zero, negative, non-finite", () => {
    for (const value of [undefined, null, 0, -1, Number.NaN, "10", {}]) {
      assert.throws(() => parseExpectedTotal(value));
    }
  });
});
