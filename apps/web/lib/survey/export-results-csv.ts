import { SESSION_STATUS_LABELS, type ResultsTable } from "@/lib/mock/workspace";

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build a UTF-8 CSV (with BOM) for the selected session rows. */
export function buildResultsCsv(table: ResultsTable, sessionIds: string[]): string {
  const idSet = new Set(sessionIds);
  const rows = table.rows.filter((r) => idSet.has(r.sessionId));

  const headers = ["日期", "状态", "任务", "摘要", ...table.questionColumns];
  const lines = rows.map((row) =>
    [
      row.date,
      SESSION_STATUS_LABELS[row.status],
      row.task,
      row.summary,
      ...row.answers,
    ]
      .map((cell) => escapeCsv(cell))
      .join(","),
  );

  return `\uFEFF${[headers.join(","), ...lines].join("\n")}`;
}
