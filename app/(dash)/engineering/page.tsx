import { Chip, PageHeader } from "@/components/ui";
import { ENGINEERING_REQUESTS, REQUEST_STATUS_LABEL, type EngineeringRequest } from "@/lib/data/engineering";

export const metadata = { title: "Engineering requests" };

const GROUPS = ["P0", "P1", "P2", "Later"] as const;

export default function EngineeringPage() {
  return (
    <>
      <PageHeader
        eyebrow="Engineering"
        title="Requests that unblock the clocks"
        lede="This list is a draft Curtis has not sent. Status stays “Draft, not sent” until someone records an owner and an ETA. P0 is what makes day 0 real. Until P0-1 ships, every Onboarding and Launched date in this dashboard is a proxy or a manual stand-in."
      />
      <div className="space-y-8">
        {GROUPS.map((priority) => (
          <section key={priority}>
            <h2 className="mb-2 font-serif text-2xl">{priority === "Later" ? "Later, from the CX strategy" : priority}</h2>
            <div className="overflow-x-auto rounded-lg border border-line bg-card">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Unblocks</th>
                  </tr>
                </thead>
                <tbody>
                  {ENGINEERING_REQUESTS.filter((item) => item.priority === priority).map((item) => (
                    <RequestRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function RequestRow({ item }: { item: EngineeringRequest }) {
  return (
    <tr>
      <td className="num whitespace-nowrap text-xs">{item.id}</td>
      <td>
        <p className="font-medium">{item.title}</p>
        <p className="mt-1 max-w-xl text-xs leading-5 text-muted">{item.summary}</p>
      </td>
      <td>
        <Chip tone="neutral">{REQUEST_STATUS_LABEL[item.status]}</Chip>
      </td>
      <td className="text-xs text-muted">{item.unblocks}</td>
    </tr>
  );
}
