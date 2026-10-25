"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  /** Human-readable message from the API `{ error }` (or a fallback). */
  error: string | null;
  /** Field name from a 400 `{ error, field }` response. */
  field: string | null;
  /** Optional `details` object from error bodies (e.g. 502 response preview). */
  details: unknown;
};

/** Only same-origin relative paths are allowed as post-login targets. */
export function sanitizeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  // Backslashes and control characters (tab, newline) are stripped or normalised by
  // URL parsing and can turn "/\t/evil" into "//evil" — reject them outright.
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const base = "http://sqllens.local";
    if (new URL(value, base).origin !== base) return "/";
  } catch {
    return "/";
  }
  return value;
}

/**
 * Fetch JSON from an API route. A 401 redirects to `/login?next=<current path>`.
 * Never throws; network failures are reported through `error`.
 */
export function useApi() {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    async function request<T>(
      url: string,
      init?: RequestInit,
      fallbackError = "Request failed"
    ): Promise<ApiResult<T>> {
      try {
        const response = await fetch(url, init);
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        const body = (payload ?? {}) as { error?: unknown; field?: unknown; details?: unknown };

        if (response.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
          return {
            ok: false,
            status: 401,
            data: null,
            error: "Authentication required",
            field: null,
            details: null,
          };
        }

        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            data: null,
            error: typeof body.error === "string" ? body.error : fallbackError,
            field: typeof body.field === "string" ? body.field : null,
            details: body.details ?? null,
          };
        }

        return {
          ok: true,
          status: response.status,
          data: payload as T,
          error: null,
          field: null,
          details: null,
        };
      } catch {
        return { ok: false, status: 0, data: null, error: fallbackError, field: null, details: null };
      }
    },
    [router, pathname]
  );
}
