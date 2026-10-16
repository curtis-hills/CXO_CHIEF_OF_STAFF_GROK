import { PageHeader } from "@/components/ui";
import { formatUtcTimestamp } from "@/lib/metrics/calendar";
import { ENDPOINTS } from "@/lib/sync/catalog";
import { databaseConfigured, getStore } from "@/lib/sync/store";
import { runBackfillNow } from "./actions";

export const metadata = { title: "Sync" };

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const result = Array.isArray(query.result) ? query.result[0] : query.result;
  const configured = databaseConfigured();
  const store = configured ? getStore() : null;
  const runs = store ? await store.listRuns(40) : [];
  const cursors = store
    ? await Promise.all(ENDPOINTS.map(async (endpoint) => ({ id: endpoint.id, state: await store.getCursor(endpoint.id) })))
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Sync"
        title="Stored copy of SubcontractorHub"
        lede="Pages read this database. They do not call SubcontractorHub while rendering. The backfill walks every list at 50 rows a page and resumes from the saved cursor. The daily job runs at 09:00 UTC, about 2:00 AM Pacific during daylight time. An hourly job refreshes organizations only."
      />
      {result === "done" ? <p className="mb-4 text-sm">Backfill chunk finished.</p> : null}
      {result === "pending" ? (
        <p className="mb-4 text-sm">Backfill is still in progress. Run it again to continue from the saved cursor.</p>
      ) : null}
      {result === "error" ? <p className="mb-4 text-sm">The last chunk stopped on an error. The table below has the message.</p> : null}
      {result === "unconfigured" ? <p className="mb-4 text-sm">Connect the database before running a backfill.</p> : null}
      {!configured ? (
        <p className="mb-4 rounded-lg border border-line bg-card px-4 py-3 text-sm">
          DATABASE_URL is not set. Connect Neon from the Vercel Storage tab, then run the migration.
        </p>
      ) : null}
      <form action={runBackfillNow} className="mb-6">
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={!configured}>
          Run backfill now
        </button>
      </form>
      <h2 className="mb-2 font-serif text-2xl">Cursors</h2>
      <div className="mb-8 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="data">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Backfill</th>
              <th>High water</th>
              <th>Resume</th>
              <th>Unsupported filters</th>
            </tr>
          </thead>
          <tbody>
            {cursors.map((cursor) => (
              <tr key={cursor.id}>
                <td>{cursor.id}</td>
                <td>{cursor.state?.disabled ? "Unsupported" : cursor.state?.backfillComplete ? "Complete" : "In progress"}</td>
                <td className="text-xs">{cursor.state?.highWater ? formatUtcTimestamp(cursor.state.highWater) : "—"}</td>
                <td className="text-xs">{cursor.state?.cursor || cursor.state?.page ? "Saved" : "—"}</td>
                <td className="text-xs text-muted">{cursor.state?.unsupportedFilters.join(", ") || "—"}</td>
              </tr>
            ))}
            {cursors.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  No cursors yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <h2 className="mb-2 font-serif text-2xl">Runs</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="data">
          <thead>
            <tr>
              <th>Started</th>
              <th>Finished</th>
              <th>Endpoint</th>
              <th>Kind</th>
              <th>Rows</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="whitespace-nowrap text-xs">{formatUtcTimestamp(run.startedAt)}</td>
                <td className="whitespace-nowrap text-xs">{run.finishedAt ? formatUtcTimestamp(run.finishedAt) : "—"}</td>
                <td>{run.endpoint}</td>
                <td>{run.kind}</td>
                <td className="num">{run.rows}</td>
                <td>{run.status}</td>
                <td className="max-w-sm text-xs text-muted">{run.error ?? "—"}</td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">
                  No sync runs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
