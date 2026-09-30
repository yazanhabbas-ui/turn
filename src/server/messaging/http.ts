import { env } from "../env";

export type HttpOutcome = { status: number; json: unknown; text: string } | { error: string; timeout: boolean };

/** fetch with a timeout; network failures come back as a value, never a throw. */
export async function httpRequest(url: string, init: RequestInit): Promise<HttpOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env().MESSAGING_TIMEOUT_SECONDS * 1000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  } catch (err) {
    const timeout = err instanceof Error && err.name === "AbortError";
    return { error: timeout ? "timeout" : err instanceof Error ? err.message.slice(0, 200) : "network_error", timeout };
  } finally {
    clearTimeout(timer);
  }
}

/** 408, 425, 429 and 5xx are worth retrying; other 4xx are the request's fault. */
export const isRetryableStatus = (s: number) => s === 408 || s === 425 || s === 429 || s >= 500;

/** Reads a dotted path such as "messages.0.id" from parsed JSON. */
export function pickPath(json: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  let cur: unknown = json;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur === undefined || cur === null ? undefined : String(cur);
}
