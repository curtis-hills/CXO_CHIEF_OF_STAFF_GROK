export type LifecycleOverride = {
  onboardingAt?: string | null;
  readyToLaunchAt?: string | null;
  launchedAt?: string | null;
  waitingOnCustomer?: boolean;
  waitingReason?: string | null;
  updatedAt?: string;
};
