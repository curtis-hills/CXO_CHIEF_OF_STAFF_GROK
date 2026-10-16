import Link from "next/link";
import { Chip, PageHeader } from "@/components/ui";
import { AGENTS, coveragePercent, type AgentProfile } from "@/lib/data/agents";

export const metadata = { title: "Agents" };

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Agents"
        title="Planned roster"
        lede="None of these agents are running. Each card is a placeholder with the data it would need. Agents draft. A human approves every customer message and every billing or account change. Agents never see secrets. The CXM Admin agent does setup later. It does not set Launched."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((agent) => (
          <AgentCard key={agent.slug} agent={agent} />
        ))}
      </div>
    </>
  );
}

function AgentCard({ agent }: { agent: AgentProfile }) {
  const coverage = coveragePercent(agent);
  return (
    <Link href={`/agents/${agent.slug}`} className="rounded-lg border border-line bg-card p-4 hover:border-tide">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{agent.name}</h2>
        <Chip tone={agent.status === "partial" ? "watch" : "neutral"}>
          {agent.status === "partial" ? "Partial data" : "Blocked"}
        </Chip>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{agent.purpose}</p>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>Data coverage</span>
          <span className="num">{coverage}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-stone-200">
          <div className="h-1.5 rounded-full bg-tide" style={{ width: `${coverage}%` }} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">Not running · last run never · Phase 1 placeholder</p>
    </Link>
  );
}
