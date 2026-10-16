export type ApiPerson = {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
};

export type ApiSubscription = {
  status?: string | null;
  plan?: {
    id?: string | number | null;
    name?: string | null;
    unit_price?: number | string | null;
    interval?: string | null;
  } | null;
};

/** Shape returned by GET /api/v1/superadmin/orgs. Lifecycle dates are optional until P0-1. */
export type ApiOrg = {
  id: string | number;
  name?: string | null;
  email?: string | null;
  status?: string | null;
  sub_status?: string | null;
  payment_status?: string | null;
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  products?: string[] | null;
  customer_types?: string[] | null;
  active_user_count?: number | null;
  customer_experience_manager?: ApiPerson | null;
  account_executive?: ApiPerson | null;
  subscriptions?: ApiSubscription[] | null;
  onboarding_at?: string | null;
  ready_to_launch_at?: string | null;
  launched_at?: string | null;
  account_type?: string | null;
  legacy_seamless_dealer?: boolean | null;
  target_launch_date?: string | null;
};

export type ApiProject = {
  id: string | number;
  created_at?: string | null;
  job_type?: string | null;
  system_size?: number | string | null;
  is_test?: boolean | null;
  deleted_at?: string | null;
  equipment?: {
    module?: string | null;
    inverter?: string | null;
    batteries?: string | null;
  } | null;
  sales_metrics?: {
    gross_amount?: number | null;
    net_amount?: number | null;
  } | null;
};

export type CursorPage<T> = {
  results?: {
    data?: T[];
    per_page?: number;
    next_cursor?: string | null;
    prev_cursor?: string | null;
  };
};
