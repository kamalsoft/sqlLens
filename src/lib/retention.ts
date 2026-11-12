import "server-only";
import { purgeExpired } from "@/db/audit-repo";
import { readAppConfig } from "@/lib/app-config";
import { logError } from "@/lib/redact";
import { purgeOldLogs } from "@/lib/sp-executor";

/** SEC-T4: applies `retentionDays` to audit records, expired sessions and run logs. */
export async function runRetention(): Promise<void> {
  try {
    const { retentionDays } = await readAppConfig();
    const db = purgeExpired(retentionDays);
    const logs = purgeOldLogs(retentionDays);
    if (db.audits || db.sessions || logs) {
      console.info(`[retention] removed ${db.audits} audit record(s), ${db.sessions} session(s), ${logs} run log(s) older than ${retentionDays} days`);
    }
  } catch (error) {
    logError("[retention]", error);
  }
}
