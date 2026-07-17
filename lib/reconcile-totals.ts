export type ReconcileTotalChange = {
  id: string;
  kind: "update" | "add" | "kept" | "unchanged" | "locked";
  statement: { amount: number } | null;
  tracked: { amount: number } | null;
};

export const RECONCILE_AMOUNT_TOLERANCE = 0.01;

export function defaultReconcileSelection(
  changes: Array<{ id: string; kind: ReconcileTotalChange["kind"] }>,
): Record<string, boolean> {
  const selected: Record<string, boolean> = {};
  for (const change of changes) {
    if (change.kind === "add" || change.kind === "update" || change.kind === "kept" || change.kind === "locked") {
      selected[change.id] = true;
    }
  }
  return selected;
}

export function computeProjectedTotal(
  changes: ReconcileTotalChange[],
  selected: Record<string, boolean>,
): number {
  return changes.reduce((sum, change) => {
    const isSelected = !!selected[change.id];
    if (change.kind === "add") return isSelected ? sum + (change.statement?.amount ?? 0) : sum;
    if (change.kind === "update") {
      return sum + (isSelected ? (change.statement?.amount ?? 0) : (change.tracked?.amount ?? 0));
    }
    if (change.kind === "kept" || change.kind === "locked") {
      return isSelected ? sum + (change.tracked?.amount ?? 0) : sum;
    }
    return sum + (change.tracked?.amount ?? 0);
  }, 0);
}

export function totalsMatch(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) <= RECONCILE_AMOUNT_TOLERANCE;
}

export function parseExpectedTotal(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("A positive expected total is required.");
  }
  return value;
}
