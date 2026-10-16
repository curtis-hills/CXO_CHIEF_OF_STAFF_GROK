import { formatUtcTimestamp } from "../metrics/calendar";

export function connectionMessage(input: {
  mode: "mock" | "live";
  notice: string | null;
  dataAsOf: string | null;
}): { title: string; body: string } {
  if (input.mode === "mock") {
    return {
      title: "Demo data.",
      body: input.notice ?? "The database is empty, so this is a labeled stand-in.",
    };
  }
  const asOf = input.dataAsOf ? ` Data as of ${formatUtcTimestamp(input.dataAsOf)}.` : "";
  if (input.notice) {
    return { title: "Stored copy.", body: `${input.notice}${asOf}` };
  }
  return {
    title: "Stored copy.",
    body: `Pages read the last sync, not the live SubcontractorHub API.${asOf}`,
  };
}
