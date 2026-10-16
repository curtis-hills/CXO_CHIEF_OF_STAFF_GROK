import type { ApiOrg, ApiProject, ApiSubscription } from "../api/types";
import type { AccountType } from "../domain";
import { subtractBusinessDays, subtractCalendarDays } from "../metrics/calendar";
import type { ChecklistSeed } from "./checklists";

type DraftProxy = {
  onboardingBusinessDaysAgo?: number;
  readyToLaunchBusinessDaysAgo?: number;
  launchedCalendarDaysAgo?: number;
  accountType: AccountType;
  legacySeamlessDealer?: boolean;
  waitingOnCustomer?: boolean;
  waitingReason?: string | null;
  failedPaymentDays?: number;
  checklist?: ChecklistSeed;
};

export type ProxyProfile = {
  onboardingAt?: string;
  readyToLaunchAt?: string;
  launchedAt?: string;
  accountType: AccountType;
  legacySeamlessDealer?: boolean;
  waitingOnCustomer?: boolean;
  waitingReason?: string | null;
  failedPaymentDays?: number;
  checklist?: ChecklistSeed;
};

export type MockInputs = {
  orgs: ApiOrg[];
  projectsByOrg: Record<string, ApiProject[]>;
  proxies: Record<string, ProxyProfile>;
};

const MAYA = { id: "cxm_maya", name: "Maya Chen", email: "maya.chen@demo.example" };
const ANDRE = { id: "cxm_andre", name: "Andre Walsh", email: "andre.walsh@demo.example" };
const PRIYA = { id: "cxm_priya", name: "Priya Shah", email: "priya.shah@demo.example" };
const CHRIS = { id: "ae_chris", name: "Chris Dalton", email: "chris.dalton@demo.example" };
const ELENA = { id: "ae_elena", name: "Elena Voss", email: "elena.voss@demo.example" };

function plans(names: string[]): ApiSubscription[] {
  return names.map((name) => ({
    status: "active",
    plan: { name, unit_price: 500, interval: "month" },
  }));
}

function project(asOf: string, orgId: string, index: number, daysAgo: number, isTest: boolean): ApiProject {
  const jobs = ["solar", "roofing", "hvac", "battery"];
  return {
    id: `${orgId}-p${index}`,
    created_at: subtractCalendarDays(asOf, daysAgo, 15),
    job_type: jobs[index % jobs.length],
    system_size: `${4 + (index % 7)}.${index % 10}`,
    is_test: isTest,
    sales_metrics: {
      gross_amount: 16000 + (index % 9) * 2400,
      net_amount: 14000 + (index % 9) * 2100,
    },
  };
}

function fromOffsets(asOf: string, orgId: string, launchedDaysAgo: number, offsets: number[]): ApiProject[] {
  return offsets.map((offset, index) => project(asOf, orgId, index, launchedDaysAgo - offset, false));
}

function spread(asOf: string, orgId: string, startAgo: number, endAgo: number, count: number, startIndex: number): ApiProject[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const ago = count === 1 ? startAgo : Math.round(startAgo - ((startAgo - endAgo) * index) / (count - 1));
    return project(asOf, orgId, startIndex + index, ago, false);
  });
}

type Draft = {
  org: ApiOrg;
  proxy: DraftProxy;
  projects: (asOf: string) => ApiProject[];
};

function draft(org: ApiOrg, proxy: DraftProxy, projects: Draft["projects"]): Draft {
  return { org, proxy, projects };
}

const SV = ["Sales Velocity"];
const SVPM = ["Sales Velocity", "Project Management"];
const ALL = ["Sales Velocity", "Project Management", "Ambassador"];

function catalog(): Draft[] {
  return [
    draft(
      {
        id: "org_sunridge",
        name: "Sunridge Energy",
        email: "ops@sunridge.example",
        status: "Onboarding",
        sub_status: "In Progress",
        payment_status: "paid",
        address: { city: "Phoenix", state: "AZ", postal_code: "85004" },
        products: ["Solar"],
        customer_types: ["EPC"],
        active_user_count: 4,
        customer_experience_manager: MAYA,
        account_executive: CHRIS,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "epc",
        onboardingBusinessDaysAgo: 1,
        checklist: { entry: 0.78, setup: 0.2, launch: 0 },
      },
      () => [],
    ),
    draft(
      {
        id: "org_peakline",
        name: "Peakline Roofing",
        email: "hello@peakline.example",
        status: "Onboarding",
        sub_status: "In Progress",
        payment_status: "paid",
        address: { city: "Denver", state: "CO", postal_code: "80202" },
        products: ["Roofing"],
        customer_types: ["EPC"],
        active_user_count: 2,
        customer_experience_manager: ANDRE,
        account_executive: ELENA,
        subscriptions: plans(SV),
      },
      {
        accountType: "epc",
        onboardingBusinessDaysAgo: 6,
        waitingOnCustomer: true,
        waitingReason: "intake",
        checklist: { entry: 0.45, setup: 0.1, launch: 0 },
      },
      () => [],
    ),
    draft(
      {
        id: "org_horizon",
        name: "Horizon Sales Partners",
        email: "team@horizon.example",
        status: "Ready to Launch",
        sub_status: "In Progress",
        payment_status: "paid",
        address: { city: "Austin", state: "TX", postal_code: "78701" },
        products: ["Solar"],
        customer_types: ["Sales Org"],
        active_user_count: 8,
        customer_experience_manager: PRIYA,
        account_executive: CHRIS,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "sales_org",
        onboardingBusinessDaysAgo: 8,
        readyToLaunchBusinessDaysAgo: 2,
        checklist: { entry: 1, setup: 0.85, launch: 0.2 },
      },
      () => [],
    ),
    draft(
      {
        id: "org_copperline",
        name: "Copperline Installing",
        email: "office@copperline.example",
        status: "Ready to Launch",
        sub_status: "In Progress",
        payment_status: "paid",
        address: { city: "Tucson", state: "AZ", postal_code: "85701" },
        products: ["Solar", "Battery"],
        customer_types: ["Seamless Installing Dealer"],
        active_user_count: 6,
        customer_experience_manager: MAYA,
        account_executive: ELENA,
        subscriptions: plans(ALL),
      },
      {
        accountType: "seamless_installing_dealer",
        onboardingBusinessDaysAgo: 12,
        readyToLaunchBusinessDaysAgo: 6,
        checklist: { entry: 1, setup: 0.9, launch: 0.15 },
      },
      () => [],
    ),
    draft(
      {
        id: "org_northwind",
        name: "Northwind Home",
        email: "owner@northwind.example",
        status: "Onboarding",
        sub_status: "In Progress",
        payment_status: "paid",
        address: { city: "Boise", state: "ID", postal_code: "83702" },
        products: ["Solar"],
        customer_types: ["Seamless Dealer"],
        active_user_count: 3,
        customer_experience_manager: null,
        account_executive: CHRIS,
        subscriptions: plans(SV),
      },
      {
        accountType: "sales_org",
        legacySeamlessDealer: true,
        onboardingBusinessDaysAgo: 2,
        checklist: { entry: 0.6, setup: 0, launch: 0, forceOpen: ["E12"] },
      },
      () => [],
    ),
    draft(
      {
        id: "org_atlas",
        name: "Atlas Mechanical",
        email: "ops@atlas.example",
        status: "Onboarding",
        sub_status: "In Progress",
        payment_status: "paid",
        address: { city: "Sacramento", state: "CA", postal_code: "95814" },
        products: ["HVAC"],
        customer_types: ["EPC"],
        active_user_count: 1,
        customer_experience_manager: ANDRE,
        account_executive: ELENA,
        subscriptions: plans(SV),
      },
      {
        accountType: "epc",
        onboardingBusinessDaysAgo: 0,
        checklist: { entry: 0.3, setup: 0, launch: 0 },
      },
      () => [],
    ),
    draft(
      {
        id: "org_brightpath",
        name: "BrightPath Solar",
        email: "hello@brightpath.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Las Vegas", state: "NV", postal_code: "89101" },
        products: ["Solar"],
        customer_types: ["EPC"],
        active_user_count: 14,
        customer_experience_manager: MAYA,
        account_executive: CHRIS,
        subscriptions: plans(ALL),
      },
      {
        accountType: "epc",
        onboardingBusinessDaysAgo: 18,
        readyToLaunchBusinessDaysAgo: 14,
        launchedCalendarDaysAgo: 12,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => [
        ...fromOffsets(asOf, "org_brightpath", 12, [1, 3, 4, 6, 8, 9, 11]),
        project(asOf, "org_brightpath", 50, 15, false),
        project(asOf, "org_brightpath", 51, 14, true),
      ],
    ),
    draft(
      {
        id: "org_cascade",
        name: "Cascade Comfort",
        email: "team@cascade.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Portland", state: "OR", postal_code: "97204" },
        products: ["HVAC", "Solar"],
        customer_types: ["Sales Org"],
        active_user_count: 11,
        customer_experience_manager: PRIYA,
        account_executive: ELENA,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "sales_org",
        onboardingBusinessDaysAgo: 28,
        readyToLaunchBusinessDaysAgo: 24,
        launchedCalendarDaysAgo: 22,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => fromOffsets(asOf, "org_cascade", 22, [2, 6, 10, 18]),
    ),
    draft(
      {
        id: "org_mesa",
        name: "Mesa Valley Sales",
        email: "ops@mesavalley.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Mesa", state: "AZ", postal_code: "85201" },
        products: ["Solar"],
        customer_types: ["Sales Org"],
        active_user_count: 22,
        customer_experience_manager: ANDRE,
        account_executive: CHRIS,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "sales_org",
        launchedCalendarDaysAgo: 45,
        onboardingBusinessDaysAgo: 52,
        readyToLaunchBusinessDaysAgo: 48,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => fromOffsets(asOf, "org_mesa", 45, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 33, 36, 38, 40, 42, 44]),
    ),
    draft(
      {
        id: "org_lumen",
        name: "Lumen Field Services",
        email: "ops@lumen.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Albuquerque", state: "NM", postal_code: "87102" },
        products: ["Solar"],
        customer_types: ["EPC"],
        active_user_count: 5,
        customer_experience_manager: MAYA,
        account_executive: ELENA,
        subscriptions: plans(SV),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 9,
        onboardingBusinessDaysAgo: 16,
        readyToLaunchBusinessDaysAgo: 12,
        checklist: { entry: 1, setup: 1, launch: 0.8 },
      },
      () => [],
    ),
    draft(
      {
        id: "org_harbor",
        name: "Harbor Roof & Solar",
        email: "office@harbor.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Tampa", state: "FL", postal_code: "33602" },
        products: ["Roofing", "Solar"],
        customer_types: ["EPC"],
        active_user_count: 17,
        customer_experience_manager: PRIYA,
        account_executive: CHRIS,
        subscriptions: plans(ALL),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 36,
        onboardingBusinessDaysAgo: 44,
        readyToLaunchBusinessDaysAgo: 40,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => fromOffsets(asOf, "org_harbor", 36, [2, 6, 10, 14, 18, 22, 26, 29, 32, 33, 34, 35]),
    ),
    draft(
      {
        id: "org_solstice",
        name: "Solstice Partners",
        email: "team@solstice.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "San Diego", state: "CA", postal_code: "92101" },
        products: ["Solar", "Battery"],
        customer_types: ["Seamless Installing Dealer"],
        active_user_count: 19,
        customer_experience_manager: ANDRE,
        account_executive: ELENA,
        subscriptions: plans(ALL),
      },
      {
        accountType: "seamless_installing_dealer",
        launchedCalendarDaysAgo: 58,
        onboardingBusinessDaysAgo: 66,
        readyToLaunchBusinessDaysAgo: 62,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) =>
        fromOffsets(
          asOf,
          "org_solstice",
          58,
          Array.from({ length: 26 }, (_, index) => 1 + Math.round((index * 48) / 25)),
        ),
    ),
    draft(
      {
        id: "org_redrock",
        name: "Redrock Dealers",
        email: "owner@redrock.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "St. George", state: "UT", postal_code: "84770" },
        products: ["Solar"],
        customer_types: ["Seamless Dealer"],
        active_user_count: 7,
        customer_experience_manager: MAYA,
        account_executive: CHRIS,
        subscriptions: plans(SV),
      },
      {
        accountType: "sales_org",
        legacySeamlessDealer: true,
        launchedCalendarDaysAgo: 20,
        onboardingBusinessDaysAgo: 26,
        readyToLaunchBusinessDaysAgo: 22,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => fromOffsets(asOf, "org_redrock", 20, [1, 3, 5, 8, 10]),
    ),
    draft(
      {
        id: "org_pinnacle",
        name: "Pinnacle EPC Group",
        email: "ops@pinnacle.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Dallas", state: "TX", postal_code: "75201" },
        products: ["Solar", "Roofing"],
        customer_types: ["EPC"],
        active_user_count: 31,
        customer_experience_manager: PRIYA,
        account_executive: ELENA,
        subscriptions: plans(ALL),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 28,
        onboardingBusinessDaysAgo: 36,
        readyToLaunchBusinessDaysAgo: 32,
        checklist: { entry: 1, setup: 1, launch: 0.9, forceOpen: ["L6"] },
      },
      (asOf) => [
        ...fromOffsets(asOf, "org_pinnacle", 28, [1, 3, 5, 7, 9, 11, 13, 15, 18, 20, 24, 27]),
        project(asOf, "org_pinnacle", 80, 18, true),
      ],
    ),
    draft(
      {
        id: "org_keystone",
        name: "Keystone Solar",
        email: "hello@keystone.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Charlotte", state: "NC", postal_code: "28202" },
        products: ["Solar"],
        customer_types: ["EPC"],
        active_user_count: 16,
        customer_experience_manager: ANDRE,
        account_executive: CHRIS,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 50,
        onboardingBusinessDaysAgo: 58,
        readyToLaunchBusinessDaysAgo: 54,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => fromOffsets(asOf, "org_keystone", 50, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 32, 34, 36, 38, 40, 42, 44, 45, 46, 48, 49]),
    ),
    draft(
      {
        id: "org_dune",
        name: "Dune Country EPC",
        email: "ops@dunecountry.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "El Paso", state: "TX", postal_code: "79901" },
        products: ["Solar"],
        customer_types: ["EPC"],
        active_user_count: 9,
        customer_experience_manager: MAYA,
        account_executive: ELENA,
        subscriptions: plans(SV),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 62,
        onboardingBusinessDaysAgo: 70,
        readyToLaunchBusinessDaysAgo: 66,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => fromOffsets(asOf, "org_dune", 62, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 40, 48, 55, 61]),
    ),
    draft(
      {
        id: "org_oak",
        name: "Oak Street Roofing",
        email: "office@oakstreet.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Nashville", state: "TN", postal_code: "37203" },
        products: ["Roofing"],
        customer_types: ["EPC"],
        active_user_count: 24,
        customer_experience_manager: PRIYA,
        account_executive: CHRIS,
        subscriptions: plans(ALL),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 110,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => [...spread(asOf, "org_oak", 29, 1, 12, 0), ...spread(asOf, "org_oak", 88, 40, 18, 20)],
    ),
    draft(
      {
        id: "org_valley",
        name: "Valleywide Solar",
        email: "team@valleywide.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Fresno", state: "CA", postal_code: "93721" },
        products: ["Solar"],
        customer_types: ["Sales Org"],
        active_user_count: 13,
        customer_experience_manager: ANDRE,
        account_executive: ELENA,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "sales_org",
        launchedCalendarDaysAgo: 95,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => [...spread(asOf, "org_valley", 29, 1, 6, 0), ...spread(asOf, "org_valley", 89, 40, 39, 10)],
    ),
    draft(
      {
        id: "org_summit",
        name: "Summit Air HVAC",
        email: "billing@summitair.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "failed",
        address: { city: "Salt Lake City", state: "UT", postal_code: "84101" },
        products: ["HVAC"],
        customer_types: ["EPC"],
        active_user_count: 18,
        customer_experience_manager: MAYA,
        account_executive: CHRIS,
        subscriptions: plans(SVPM),
      },
      {
        accountType: "epc",
        launchedCalendarDaysAgo: 80,
        failedPaymentDays: 10,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => [...spread(asOf, "org_summit", 28, 1, 15, 0), ...spread(asOf, "org_summit", 70, 40, 15, 20)],
    ),
    draft(
      {
        id: "org_bluebonnet",
        name: "Bluebonnet Sales",
        email: "ops@bluebonnet.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "failed",
        address: { city: "Houston", state: "TX", postal_code: "77002" },
        products: ["Solar", "HVAC"],
        customer_types: ["Sales Org"],
        active_user_count: 10,
        customer_experience_manager: PRIYA,
        account_executive: ELENA,
        subscriptions: plans(SV),
      },
      {
        accountType: "sales_org",
        launchedCalendarDaysAgo: 75,
        failedPaymentDays: 2,
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => [...spread(asOf, "org_bluebonnet", 28, 2, 8, 0), ...spread(asOf, "org_bluebonnet", 70, 35, 22, 10)],
    ),
    draft(
      {
        id: "org_willow",
        name: "Willow & Pine",
        email: "owner@willowpine.example",
        status: "Launched",
        sub_status: "Active",
        payment_status: "paid",
        address: { city: "Bend", state: "OR", postal_code: "97701" },
        products: ["Roofing"],
        customer_types: ["EPC"],
        active_user_count: 4,
        customer_experience_manager: ANDRE,
        account_executive: CHRIS,
        subscriptions: plans(SV),
      },
      {
        accountType: "epc",
        checklist: { entry: 1, setup: 1, launch: 1 },
      },
      (asOf) => [project(asOf, "org_willow", 0, 3, false), project(asOf, "org_willow", 1, 1, false)],
    ),
  ];
}

export function buildMockInputs(asOf: string): MockInputs {
  const orgs: ApiOrg[] = [];
  const projectsByOrg: Record<string, ApiProject[]> = {};
  const proxies: Record<string, ProxyProfile> = {};

  for (const row of catalog()) {
    const { onboardingBusinessDaysAgo, readyToLaunchBusinessDaysAgo, launchedCalendarDaysAgo, ...rest } = row.proxy;
    orgs.push(row.org);
    projectsByOrg[String(row.org.id)] = row.projects(asOf);
    proxies[String(row.org.id)] = {
      ...rest,
      onboardingAt:
        onboardingBusinessDaysAgo === undefined ? undefined : subtractBusinessDays(asOf, onboardingBusinessDaysAgo),
      readyToLaunchAt:
        readyToLaunchBusinessDaysAgo === undefined
          ? undefined
          : subtractBusinessDays(asOf, readyToLaunchBusinessDaysAgo),
      launchedAt:
        launchedCalendarDaysAgo === undefined ? undefined : subtractCalendarDays(asOf, launchedCalendarDaysAgo, 15),
    };
  }

  return { orgs, projectsByOrg, proxies };
}
