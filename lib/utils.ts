export { cn } from "cn"

/** `text.slice(0, max)` that never splits an emoji (a lone surrogate half breaks Postgres jsonb). */
export function truncate(text: string, max: number): string {
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}
