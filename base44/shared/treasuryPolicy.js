/** Allocation of creator rewards, NOT a trading fee or a token-supply tax. */
export const TREASURY_ADDRESS = '3ggRizSixiDPXyHrEzBaZ3Nm8QfFRD1FbrkkYYpxMxkq';
export const TREASURY_SHARE_BPS = 10000;
export const TREASURY_POLICY_VERSION = 1;
export function treasuryRecipients() {
  return [{ type: 'wallet', value: TREASURY_ADDRESS, shareBps: TREASURY_SHARE_BPS }];
}
export function treasuryPolicy() {
  return { treasuryPolicyVersion: TREASURY_POLICY_VERSION, treasuryAddress: TREASURY_ADDRESS,
    treasuryShareBps: TREASURY_SHARE_BPS, holderReward: false, feeRecipients: treasuryRecipients() };
}
export function policyAssert(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { status: 400 });
}
export function assertTreasuryIntent(input) {
  policyAssert(input.treasuryPolicyVersion === TREASURY_POLICY_VERSION && input.treasuryAddress === TREASURY_ADDRESS &&
    input.treasuryShareBps === TREASURY_SHARE_BPS, 'Review the current 100% treasury reward policy before preparing a launch.');
  policyAssert(input.holderReward === false, 'Holder rewards are incompatible with the treasury reward policy.');
  const rows = input.feeRecipients;
  policyAssert(Array.isArray(rows) && rows.length === 1 && rows[0].type === 'wallet' &&
    rows[0].value === TREASURY_ADDRESS && rows[0].shareBps === TREASURY_SHARE_BPS,
  'Every new launch must allocate exactly 100% of creator rewards to the Curated treasury.');
}
export function assertLockedTreasuryConfig(config, mint) {
  const address = value => typeof value === 'string' ? value : value?.toBase58?.();
  policyAssert(address(config?.mint) === address(mint), 'Fee-sharing configuration belongs to another mint.');
  policyAssert(config.version === 2 && config.adminRevoked === true, 'Fee-sharing allocation is not a supported locked V2 configuration.');
  policyAssert(config.status && Object.keys(config.status).length === 1 && Object.hasOwn(config.status, 'active'),
    'Fee-sharing configuration is not active.');
  policyAssert(config.shareholders?.length === 1 && address(config.shareholders[0].address) === TREASURY_ADDRESS &&
    config.shareholders[0].shareBps === TREASURY_SHARE_BPS, 'On-chain creator reward allocation does not match the treasury policy.');
}
