/** Browser-side fetch helpers. Server errors arrive as {error: friendly message} in English and are shown translated. */
import { translate } from "@/lib/i18n";
import { currentLocale } from "@/lib/i18n/client";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(translate(currentLocale(), message));
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- session expired: full reload to the login page
    if (typeof window !== "undefined") window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    throw new ApiError(401, "Please sign in again.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? "Something went wrong. Please try again.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "You're offline. Check your connection and try again.");
  }
  return handle<T>(res);
}

export async function apiSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "You're offline. Check your connection and try again.");
  }
  return handle<T>(res);
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
}
