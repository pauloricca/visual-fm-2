export function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Object.is(value, -0)) return '0';
  return String(value);
}
