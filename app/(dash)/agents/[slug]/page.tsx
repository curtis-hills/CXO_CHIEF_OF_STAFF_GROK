import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip } from "@/components/ui";
import { agentBySlug, coveragePercent } from "@/lib/data/agents";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = agentBySlug(slug);
  return { title: agent?.name ?? "Agent" };
}

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = agentBySlug(slug);
  if (!agent) notFound();
  const coverage = coveragePercent(agent);

  return (
    <>
      <Link href="/agents" className="text-sm text-tide">
        All agents
      </Link>
      <header className="mt-3 mb-6 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={agent.status === "partial" ? "watch" : "neutral"}>
            {agent.status === "partial" ? "Partial data" : "Blocked on data"}
          </Chip>
          <Chip tone="neutral">Not running</Chip>
        </div>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight">{agent.name}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{agent.purpose}</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-card p-4 text-sm leading-6">
          <h2 className="font-semibold">Placeholder</h2>
          <p className="mt-2 text-muted">Last run: never. Items produced in the last 24 hours: 0. Open alerts from this agent: none yet. The queue on this dashboard is computed in the app, not by an agent run.</p>
          <p className="mt-3">
            <span className="text-muted">Triggers. </span>
            {agent.triggers}
          </p>
          <p className="mt-2">
            <span className="text-muted">Actions. </span>
            {agent.actions}
          </p>
          <p className="mt-2">
            <span className="text-muted">KPIs. </span>
            {agent.kpis}
          </p>
        </section>
        <section className="rounded-lg border border-line bg-card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Data coverage</h2>
            <span className="num text-sm">{coverage}%</span>
          </div>
          <ul className="divide-y divide-line">
            {agent.coverage.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{item.label}</span>
                <Chip tone={item.state === "available" ? "good" : item.state === "partial" ? "watch" : "neutral"}>
                  {item.state}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
