"use client";

import { useState } from "react";
import { useApi } from "@/components/api-client";

export function SharePanel({ auditId }: { auditId: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState(24);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function create() {
    setPending(true);
    setError("");
    setMessage("");
    const res = await api<{ url: string; expiresAt: string }>(
      `/api/audit/${auditId}/share`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlHours: ttl }),
      },
      "Unable to create share link"
    );
    if (res.ok && res.data) setLink(res.data);
    else if (res.status !== 401) setError(res.error ?? "Unable to create share link");
    setPending(false);
  }

  async function revoke() {
    setPending(true);
    setError("");
    setMessage("");
    const res = await api<{ success: boolean }>(
      `/api/audit/${auditId}/share`,
      { method: "DELETE" },
      "Unable to revoke share link"
    );
    if (res.ok) {
      setLink(null);
      setMessage("Share link revoked.");
    } else if (res.status !== 401) {
      setError(res.error ?? "Unable to revoke share link");
    }
    setPending(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Link copied.");
    } catch {
      setError("Unable to copy; select the link and copy it manually.");
    }
  }

  const fullUrl = link ? `${window.location.origin}${link.url}` : "";

  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Share
      </button>
      {open && (
        <div role="dialog" aria-label="Share record">
          <label>
            <span>Link lifetime (hours, 1-720)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={ttl}
              onChange={(event) => setTtl(Number(event.target.value))}
              disabled={pending}
            />
          </label>
          <button type="button" onClick={() => void create()} disabled={pending}>
            {pending ? "Working..." : "Create link"}
          </button>
          <button type="button" onClick={() => void revoke()} disabled={pending}>
            Revoke link
          </button>
          {link && (
            <div>
              <input readOnly aria-label="Share link" value={fullUrl} />
              <button type="button" onClick={() => void copy(fullUrl)}>
                Copy link
              </button>
              <p>Expires {new Date(link.expiresAt).toLocaleString()}</p>
            </div>
          )}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
