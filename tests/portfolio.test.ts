import { describe, expect, it } from "vitest";
import { assemblePortfolio } from "../lib/data/assemble";
import { buildMockInputs } from "../lib/data/mock";
import { subtractCalendarDays } from "../lib/metrics/calendar";

const AS_OF = "2026-10-15T18:00:00.000Z";

function portfolio(overrides: Parameters<typeof assemblePortfolio>[0]["overrides"] = {}) {
  const mock = buildMockInputs(AS_OF);
  const assembled = assemblePortfolio({
    mode: "mock",
    asOf: AS_OF,
    orgs: mock.orgs,
    projectsByOrg: mock.projectsByOrg,
    proxies: mock.proxies,
    overrides,
  });
  const byId = Object.fromEntries(assembled.accounts.map((account) => [account.id, account]));
  return { ...assembled, byId };
}

describe("demo portfolio", () => {
  it("builds the stage, pace, and health stories from proxy dates", () => {
    const { byId, alerts } = portfolio();

    expect(byId.org_sunridge.stageTiming.inStageTone).toBe("green");
    expect(byId.org_sunridge.onboardingAt.source).toBe("proxy");
    expect(byId.org_peakline.stageTiming.inStageTone).toBe("red");
    expect(byId.org_peakline.waitingOnCustomer).toBe(true);
    expect(byId.org_peakline.stageTiming.clockPaused).toBe(false);
    expect(byId.org_peakline.stageTiming.businessDaysInStage).toBe(6);
    expect(byId.org_horizon.stageTiming.inStageTone).toBe("green");
    expect(byId.org_horizon.stageTiming.onboardingToLaunched.tone).toBe("red");
    expect(byId.org_copperline.stageTiming.inStageTone).toBe("red");
    expect(byId.org_northwind.cxm).toBeNull();
    expect(byId.org_northwind.legacySeamlessDealer).toBe(true);

    expect(byId.org_brightpath.pace?.status).toBe("on_pace");
    expect(byId.org_brightpath.pace?.actual).toBe(7);
    expect(byId.org_brightpath.pace?.excludedPreLaunch).toBe(1);
    expect(byId.org_cascade.pace?.status).toBe("at_risk");
    expect(byId.org_lumen.pace?.actual).toBe(0);
    expect(byId.org_lumen.pace?.status).toBe("at_risk");
    expect(byId.org_harbor.pace?.status).toBe("watch");
    expect(byId.org_harbor.pace?.status30).toBe("missed");
    expect(byId.org_mesa.pace?.status).toBe("on_pace");
    expect(byId.org_mesa.pace?.status30).toBe("achieved");
    expect(byId.org_solstice.pace?.status).toBe("achieved");
    expect(byId.org_solstice.pace?.actual).toBeGreaterThanOrEqual(25);
    expect(byId.org_solstice.pace?.projectsLast7Days).toBe(0);
    expect(byId.org_redrock.pace?.ratio).toBeGreaterThanOrEqual(0.7);
    expect(byId.org_redrock.pace?.status).toBe("at_risk");
    expect(byId.org_pinnacle.pace?.status).toBe("achieved");
    expect(byId.org_pinnacle.pace?.excludedTestOrDeleted).toBe(1);
    expect(byId.org_keystone.pace?.status).toBe("on_pace");
    expect(byId.org_dune.pace?.status).toBe("missed");
    expect(byId.org_dune.health.band).toBe("yellow");

    expect(byId.org_oak.health.score).toBe(100);
    expect(byId.org_oak.health.band).toBe("green");
    expect(byId.org_valley.health.band).toBe("red");
    expect(byId.org_valley.health.basis).toBe("baseline");
    expect(byId.org_summit.health.autoRed).toBe(true);
    expect(byId.org_summit.health.band).toBe("red");
    expect(byId.org_summit.paymentAgeSource).toBe("proxy");
    expect(byId.org_bluebonnet.health.autoRed).toBe(false);
    expect(byId.org_bluebonnet.health.score).toBe(37.5);
    expect(byId.org_willow.launchedAt.source).toBe("missing");
    expect(byId.org_willow.pace).toBeNull();
    expect(byId.org_willow.health.band).toBe("unscored");

    expect(alerts.some((alert) => alert.id === "unassigned_cxm:org_northwind" && alert.owner === "Craig Kersey")).toBe(
      true,
    );
    expect(alerts.some((alert) => alert.type === "ready_to_launch_stalled" && alert.orgId === "org_copperline")).toBe(
      true,
    );
  });

  it("lets a manual date replace a missing launch date", () => {
    const { byId } = portfolio({
      org_willow: {
        launchedAt: subtractCalendarDays(AS_OF, 12, 15),
        waitingOnCustomer: false,
      },
    });
    expect(byId.org_willow.launchedAt.source).toBe("manual");
    expect(byId.org_willow.pace?.day).toBe(12);
    expect(byId.org_willow.pace?.actual).toBe(2);
  });
});