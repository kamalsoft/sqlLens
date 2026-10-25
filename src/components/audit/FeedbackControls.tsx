"use client";

import { useState } from "react";

export type FeedbackStatus = "accepted" | "rejected" | "pending";
export type FeedbackEntry = { status: FeedbackStatus; note?: string | null; updatedAt?: string };

export function FeedbackControls({
  itemKey,
  entry,
  onChange,
}: {
  itemKey: string;
  entry: FeedbackEntry | undefined;
  onChange: (key: string, status: FeedbackStatus, note: string) => void;
}) {
  const status = entry?.status ?? "pending";
  const saved = entry?.note ?? "";
  const [note, setNote] = useState(saved);

  return (
    <div role="group" aria-label={`Feedback ${itemKey}`}>
      {(["accepted", "rejected", "pending"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={status === value}
          onClick={() => onChange(itemKey, value, note)}
        >
          {value === "accepted" ? "Accept" : value === "rejected" ? "Reject" : "Pending"}
        </button>
      ))}
      <label>
        <span>Note</span>
        <textarea
          aria-label={`Note ${itemKey}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
      </label>
      <button
        type="button"
        aria-label={`Save note ${itemKey}`}
        disabled={note === saved}
        onClick={() => onChange(itemKey, status, note)}
      >
        Save note
      </button>
    </div>
  );
}
