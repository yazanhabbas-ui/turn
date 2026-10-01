import { describe, expect, it } from "vitest";
import { summarizeBackup } from "@/server/admin/backup-status";

const NOW = new Date("2026-10-01T12:00:00Z");

describe("summarizeBackup", () => {
  it("is 'none' without any file", () => {
    expect(summarizeBackup(null, null, NOW, 36).state).toBe("none");
  });

  it("is 'ok' for a recent success and reports the age", () => {
    const s = summarizeBackup(
      { finishedAt: "2026-10-01T02:30:00Z", file: "dor-x.dump", bytes: 10, verifiedRestore: true },
      null,
      NOW,
      36,
    );
    expect(s.state).toBe("ok");
    expect(s.lastSuccess?.ageHours).toBeCloseTo(9.5, 1);
    expect(s.lastSuccess?.verifiedRestore).toBe(true);
  });

  it("is 'stale' beyond the maximum age", () => {
    expect(summarizeBackup({ finishedAt: "2026-09-29T02:30:00Z" }, null, NOW, 36).state).toBe("stale");
  });

  it("a failure newer than the last success wins; an older one is ignored", () => {
    const success = { finishedAt: "2026-10-01T02:30:00Z" };
    expect(summarizeBackup(success, { at: "2026-10-01T03:00:00Z", error: "pg_dump failed" }, NOW, 36).state).toBe("failed");
    expect(summarizeBackup(success, { at: "2026-09-30T03:00:00Z", error: "old" }, NOW, 36).state).toBe("ok");
  });

  it("ignores malformed documents", () => {
    expect(summarizeBackup({ finishedAt: 5 }, { at: {} }, NOW, 36).state).toBe("none");
    expect(summarizeBackup({ finishedAt: "not a date" }, null, NOW, 36).state).toBe("none");
  });
});
