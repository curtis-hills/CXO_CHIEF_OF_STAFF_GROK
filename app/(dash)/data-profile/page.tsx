import type { ReactNode } from "react";
import { PageHeader, Stat } from "@/components/ui";
import { loadDataProfile } from "@/lib/data/profile-load";
import type { DataProfile, DataProfileReport } from "@/lib/data/profile";
import { formatNumber } from "@/lib/format";

export const metadata = { title: "Data profile" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DataProfilePage() {
  const report = await loadDataProfile();
  return (
    <>
      <PageHeader
        eyebrow="Data profile"
        title="What is in the synced tables"
        lede="A read-only look at the Neon copy of SubcontractorHub, so filters can be chosen from the values that are actually filled in. Every figure is a SELECT. Email addresses and phone numbers are left out."
      />
      <p className="mb-4 text-sm">
        <a className="text-tide underline" href="/api/data-profile">
          JSON
        </a>
        <span className="text-muted"> · same dashboard session · {report.generatedAt}</span>
      </p>
      <ProfileBody report={report} />
    </>
  );
}

function ProfileBody({ report }: { report: DataProfileReport }) {
  if (!report.databaseConnected) {
    return (
      <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm">
        The database is not connected. Connect Neon from the Vercel Storage tab and redeploy.
      </p>
    );
  }
  if (!report.migrationsApplied) {
    return (
      <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm">
        The sync tables are not set up yet. Open Sync and choose Set up database.
      </p>
    );
  }
  if (report.error || !report.profile) {
    return (
      <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm">
        The profile could not be read. {report.error ?? "Try the page again."}
      </p>
    );
  }
  return <ProfileView profile={report.profile} />;
}

function ProfileView({ profile }: { profile: DataProfile }) {
  return (
    <>
      <Section title="Row counts">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {profile.tables.map((table) => (
            <Stat key={table.table} label={table.table} value={formatNumber(table.rows, 0)} />
          ))}
        </div>
      </Section>

      <Section title="JSON keys">
        <p className="mb-3 text-sm text-muted">
          Fill rate is how often the top-level raw key is present and non-empty. Keys that look like type, status, role, plan, active, is_test, parent, office, or sub_org list their top 25 values.
        </p>
        {profile.keys.map((table) => (
          <div key={table.table} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold">
              {table.table} <span className="font-normal text-muted">{formatNumber(table.rows, 0)} rows</span>
            </h3>
            <DataTable>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Present</th>
                  <th>Filled</th>
                  <th>Fill rate</th>
                </tr>
              </thead>
              <tbody>
                {table.keys.map((key) => (
                  <tr key={key.key}>
                    <td>{key.key}</td>
                    <td className="num">{formatNumber(key.present, 0)}</td>
                    <td className="num">{formatNumber(key.filled, 0)}</td>
                    <td className="num">{percent(key.fillRate)}</td>
                  </tr>
                ))}
                {table.keys.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-sm text-muted">
                      No top-level keys.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </DataTable>
          </div>
        ))}
        <h3 className="mb-2 text-sm font-semibold">Values worth filtering on</h3>
        <DataTable>
          <thead>
            <tr>
              <th>Table</th>
              <th>Key</th>
              <th>Value</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {profile.categorical.flatMap((field) =>
              field.values.length === 0
                ? [
                    <tr key={`${field.table}.${field.key}`}>
                      <td>{field.table}</td>
                      <td>{field.key}</td>
                      <td className="text-muted">No populated values</td>
                      <td className="num">0</td>
                    </tr>,
                  ]
                : field.values.map((value, index) => (
                    <tr key={`${field.table}.${field.key}.${value.value}`}>
                      <td>{index === 0 ? field.table : ""}</td>
                      <td>
                        {index === 0 ? field.key : ""}
                        {index === 0 && field.truncated ? <span className="text-muted"> · top 25 of {field.distinctValues}</span> : null}
                      </td>
                      <td>{value.value}</td>
                      <td className="num">{formatNumber(value.count, 0)}</td>
                    </tr>
                  )),
            )}
            {profile.categorical.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-sm text-muted">
                  No type, status, role, plan, active, is_test, parent, office, or sub_org keys yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </DataTable>
      </Section>

      <Section title="Test and demo orgs">
        <p className="mb-3 text-sm text-muted">
          Org names that contain “test” or “demo”. The flag table is the projects.is_test column, plus any raw is_test key that is present.
        </p>
        <p className="mb-3 text-sm">
          {formatNumber(profile.testOrgs.total, 0)} matching orgs
          {profile.testOrgs.total > profile.testOrgs.shown ? `, showing ${formatNumber(profile.testOrgs.shown, 0)}` : ""}.
        </p>
        <DataTable>
          <thead>
            <tr>
              <th>Id</th>
              <th>Name</th>
              <th>Status</th>
              <th>Account type</th>
              <th>Sub status</th>
            </tr>
          </thead>
          <tbody>
            {profile.testOrgs.orgs.map((org) => (
              <tr key={org.id}>
                <td className="text-xs">{org.id}</td>
                <td>{org.name ?? "—"}</td>
                <td>{org.status ?? "—"}</td>
                <td>{org.accountType ?? "—"}</td>
                <td>{org.subStatus ?? "—"}</td>
              </tr>
            ))}
            {profile.testOrgs.orgs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  No org name contains test or demo.
                </td>
              </tr>
            ) : null}
          </tbody>
        </DataTable>
        <div className="mt-4">
          <DataTable>
            <thead>
              <tr>
                <th>Flag</th>
                <th>True</th>
                <th>False</th>
                <th>Null</th>
                <th>Missing</th>
                <th>Other</th>
              </tr>
            </thead>
            <tbody>
              {profile.isTestFlags.map((flag) => (
                <tr key={flag.source}>
                  <td>{flag.source}</td>
                  <td className="num">{formatNumber(flag.trueCount, 0)}</td>
                  <td className="num">{formatNumber(flag.falseCount, 0)}</td>
                  <td className="num">{formatNumber(flag.nullCount, 0)}</td>
                  <td className="num">{formatNumber(flag.missingCount, 0)}</td>
                  <td className="num">{formatNumber(flag.otherCount, 0)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </Section>

      <Section title="How a project links to an org">
        <p className="mb-3 text-sm text-muted">
          Each route is one way to reach an org id. Mapped means that id exists in orgs. A raw object uses its id. Commissions, esign status, and financials join through project_id, the payload project_id, or project.id.
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Stat label="Projects mapped to an org" value={formatNumber(profile.projectsMapped, 0)} />
          <Stat label="Projects with no org" value={formatNumber(profile.projectsUnmapped, 0)} />
        </div>
        <DataTable>
          <thead>
            <tr>
              <th>Route</th>
              <th>Projects with a link</th>
              <th>Mapped to an org</th>
              <th>Orgs</th>
            </tr>
          </thead>
          <tbody>
            {profile.linkRoutes.map((route) => (
              <tr key={route.route}>
                <td>
                  <div>{route.route}</div>
                  <div className="text-xs text-muted">{route.label}</div>
                </td>
                <td className="num">{formatNumber(route.projectsWithLink, 0)}</td>
                <td className="num">{formatNumber(route.projectsMapped, 0)}</td>
                <td className="num">{formatNumber(route.orgs, 0)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <Section title="Projects per month">
        <p className="mb-3 text-sm text-muted">
          UTC month of projects.created_at. {formatNumber(profile.projectsMissingCreatedAt, 0)} projects have no created_at.
        </p>
        <DataTable>
          <thead>
            <tr>
              <th>Month</th>
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {profile.projectsByMonth.map((month) => (
              <tr key={month.month}>
                <td>{month.month}</td>
                <td className="num">{formatNumber(month.projects, 0)}</td>
              </tr>
            ))}
            {profile.projectsByMonth.length === 0 ? (
              <tr>
                <td colSpan={2} className="text-sm text-muted">
                  No created_at values yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </DataTable>
      </Section>

      <Section title="Orgs by mapped projects">
        <p className="mb-3 text-sm">
          {formatNumber(profile.orgsWithZeroProjects, 0)} orgs have zero mapped projects. The table is the top 25 by mapped project count, counting a project once per org across every route above.
        </p>
        <DataTable>
          <thead>
            <tr>
              <th>Org</th>
              <th>Name</th>
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {profile.topOrgs.map((org) => (
              <tr key={org.id}>
                <td className="text-xs">{org.id}</td>
                <td>{org.name ?? "—"}</td>
                <td className="num">{formatNumber(org.projects, 0)}</td>
              </tr>
            ))}
            {profile.topOrgs.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-sm text-muted">
                  No orgs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </DataTable>
      </Section>

      <Section title="Data quality">
        <p className="mb-3 text-sm text-muted">
          Null rate includes blank text. Duplicate ids are primary keys that occur more than once. Duplicate raw ids are payload id values that occur on more than one row. A raw id mismatch is a payload id that differs from the primary key.
        </p>
        <p className="mb-3 text-sm">
          {formatNumber(profile.duplicateOrgNameGroups, 0)} org names are shared by more than one org
          {profile.duplicateOrgNameGroups > profile.duplicateOrgNames.length
            ? `, showing ${formatNumber(profile.duplicateOrgNames.length, 0)}`
            : ""}
          .
        </p>
        {profile.duplicateOrgNames.length > 0 ? (
          <div className="mb-6">
            <DataTable>
              <thead>
                <tr>
                  <th>Org name</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {profile.duplicateOrgNames.map((name) => (
                  <tr key={name.name}>
                    <td>{name.name}</td>
                    <td className="num">{formatNumber(name.count, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ) : null}
        {profile.quality.map((table) => (
          <div key={table.table} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold">{table.table}</h3>
            <p className="mb-2 text-xs text-muted">
              Duplicate ids {formatNumber(table.duplicateIds, 0)} · duplicate raw ids {formatNumber(table.duplicateRawIds, 0)} · raw id mismatches{" "}
              {formatNumber(table.rawIdMismatches, 0)}
            </p>
            <DataTable>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Nulls</th>
                  <th>Null rate</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((column) => (
                  <tr key={column.column}>
                    <td>{column.column}</td>
                    <td className="num">{formatNumber(column.nulls, 0)}</td>
                    <td className="num">{percent(column.nullRate)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ))}
      </Section>

      <Section title="Notes">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {profile.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-serif text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="data">{children}</table>
    </div>
  );
}

function percent(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
