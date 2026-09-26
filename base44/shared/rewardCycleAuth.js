// Use the caller-scoped SDK, NOT asServiceRole. Base44 validates the caller's
// credential and the entity's admin-only RLS. This also accepts a valid platform
// service-role caller from Workflows, without trusting arbitrary request headers.
export async function authorizeRewardWorker(base44) {
  try {
    const rows = await base44.entities.BurnBuybackState.filter({ key: 'burn-v1' }, 'created_date', 2);
    return rows.length === 1;
  } catch { return false; }
}
