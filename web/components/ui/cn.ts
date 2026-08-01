/** Minimal className joiner. Repo policy forbids new dependencies, so no clsx. */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
