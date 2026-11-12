// SEC-T4: retention runs when the server starts, then once a day.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runRetention } = await import("./lib/retention");
  await runRetention();
  // One daily timer per process, even when development reloads this module.
  const flag = globalThis as { __sqllensRetentionTimer?: boolean };
  if (flag.__sqllensRetentionTimer) return;
  flag.__sqllensRetentionTimer = true;
  setInterval(() => void runRetention(), 24 * 3600 * 1000).unref();
}
