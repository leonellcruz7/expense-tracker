export function parseLastFour(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 4) {
    throw new Error("Enter exactly 4 digits.");
  }
  return digits;
}

export function formatCardLabel(name: string, lastFour?: string | null): string {
  const trimmed = name.trim();
  if (!lastFour || !/^\d{4}$/.test(lastFour)) return trimmed;
  return `${trimmed} •••• ${lastFour}`;
}
