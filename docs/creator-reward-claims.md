# Creator reward claims

The admin claim action collects SOL creator rewards into
`3ggRizSixiDPXyHrEzBaZ3Nm8QfFRD1FbrkkYYpxMxkq`. It does not purchase or burn tokens.
The configured target coin is
`6ZdCWrLhmBJmoLCL8reNCBxqJGBxXgQyM2PcDo4kpump`.
The separate [reward-funded cycle](reward-funded-cycle.md) can allocate these
verified receipts to automatic purchases and burns after explicit activation.

## Why the previous button failed

`action: claim` called the purchase builder with the wallet's available balance.
It never collected reward vaults. The status response also presented wallet SOL
above the reserve as unclaimed rewards.

A read-only mainnet inspection on 2026-09-26 found Burn on its bonding curve with
an active V2 sharing configuration, admin revoked, and the treasury as its sole
10000-bps shareholder. The configuration is
`7SVJ9rwFAtLkZJHXYu4S3JaUnEmuX5j79i5Y24ZeZEZA`; its Pump SOL vault is
`GHQx9fVKLxsLvimRHtH2zEmQh83JnwRipgiw6CVpwAS8`.
This is a mint-specific distribution, not a direct claim against the treasury's
ordinary creator vault. The handler rechecks on-chain state for every attempt.

## Runtime configuration

- Set `ADMIN_MINT_WALLET_SECRET_KEY` in the backend's secret environment. The
  existing `secrets.get` integration is preserved. A local `.env` is not proof
  that a hosted Base44 function received the secret.
- The existing parser accepts a base58-encoded 64-byte Solana keypair or a JSON
  array of 64 bytes. The derived public key must match the treasury above.
- Set `SOLANA_RPC_URL` to a mainnet RPC with transaction history. The mainnet
  genesis check and admin-only authorization remain mandatory.
- The existing single `BurnBuybackState` record with key `burn-v1` is required.
  Duplicate or missing control records fail closed; they are not auto-created
  during an invocation.
- Keep enough SOL in the treasury to pay the network fee and any temporary WSOL
  account rent required by direct PumpSwap collection. Before reward automation
  is first activated, claims require only the actual fee. Once its accounting
  starts, manual claims also protect all unspent/retained rewards and require a
  separately funded 0.03 SOL operating reserve.

No private key was read during development. The backend credential still needs
to be verified in the deployed environment before a real claim.

## Claim behavior

1. Validate the mint, curve, quote asset, canonical pool and fee recipient.
2. For active sharing configurations, use
   `OnlinePumpSdk.buildDistributeCreatorFeesInstructions(mint, options)`. The SDK
   includes PumpSwap consolidation after graduation. Check Pump's distribution
   minimum before preparing. The current action supports SOL only.
3. For an ordinary creator equal to the treasury, use the SOL-quote
   `collectCoinCreatorFeeV2Instructions` path. Only include funded vaults.
   Label these receipts `creator-wallet`: a creator vault may pool multiple
   coins, so its whole balance must never be assigned to Burn.
4. Build and simulate a versioned transaction. Save the exact signature and signed
   bytes under the existing worker lock before sending. On uncertain sends,
   reconcile or rebroadcast the same transaction rather than creating another.
5. After finalization, verify the transaction message hash, payer, source-vault
   movements and treasury receipt. Record only actual rewards received; exclude
   fees, pre-existing wrapped SOL, and refunded destination-account rent.
6. A failed transaction credits no rewards. A missing finalized receipt remains
   pending. An expired transaction is rechecked before being marked failed.
   Inconsistent receipt evidence blocks further claims for reconciliation.

`BuybackRecord.claimVersion = 1` selects the new receipt path. Existing records
retain their original settlement behavior. New claims remain separate from the
legacy allocation totals. Zero-value finalized distributions can be recorded as
zero if another permissionless caller already distributed the rewards.

## Purchase protection

### Admin claim controls

The dashboard follows a receipt by signature across refreshes and history pages.
Finalized and failed receipts replace the original submission message. New claims
require a verified signer, valid nonzero reward data and a successful status read;
a worker lock is displayed separately from a pending transaction.

`action: recover` requires a saved signature belonging to the treasury and a
`claimVersion: 1` receipt. It checks that receipt under the worker lock and may
rebroadcast only its existing signed transaction. It never prepares a new claim
or retries a historical purchase. Expired, failed or finalized claims are not
resent. The UI's **Retry saved claim** button uses this action; **Refresh status**
only reads/reconciles transaction status.

Deploy the function and UI together. `claimUiVersion: 1` advertises the recovery
and tracked-receipt response contract; the new UI disables transaction controls
if it encounters an older backend. No private key is passed to the browser.

The SDK reference for collection is the README distributed with the pinned
`@pump-fun/pump-sdk@2.0.0` package (Creator fees and Fee Sharing sections), also
published at https://www.npmjs.com/package/@pump-fun/pump-sdk?activeTab=readme.
Fee-sharing coins use `getMinimumDistributableFee` and
`buildDistributeCreatorFeesInstructions`; ordinary creator vaults use the direct
collection path. UI retries do not build any new SDK instructions or change fee
sharing. The platform's 80/20 spending policy is separate from Pump's
on-chain shareholder configuration.

### Allocation worker

Direct wallet-funded purchases and purchase previews remain disabled. The
five-minute workflow calls `runBurnRewardCycle`, which uses a new explicit
`automationEnabled` flag, defaulting to false. The old `enabled` flag cannot
authorize spending. Existing historical purchases are reconciled without being
rebroadcast. Source changes alone do not activate a live worker.

The [cycle implementation and rollout](reward-funded-cycle.md) explain the
receipt-only 80/20 ledger, burn recovery, operating funds and account cleanup.
Pooled creator-wallet receipts remain ineligible for Burn purchases.

## Verification

Run with Node 22.15+ (CI uses Node 24):

```bash
node --import ./tests/claims/register.mjs --test tests/claims/*.test.mjs
npm run lint
npm run build
npm run typecheck
```

The test resolver maps Deno `npm:` imports to repository-lockfile packages. Tests
use real Pump SDK builders and account decoders, public account fixtures, and
mocked RPC/record persistence. They never send network transactions or need keys.

An unsigned mainnet simulation of the SDK distribution instruction against the
observed Burn configuration succeeded (379 bytes without compute instructions,
23,992 compute units). This is evidence of instruction compatibility, not a
submitted claim or proof of deployed secrets. Finalized end-to-end execution has
not been performed.

Before merging/deployment, review the entity schema additions alongside the
function/shared modules and dashboard changes. After deployment, check the
verified public wallet and claim estimate, submit a claim through the admin UI,
and verify its finalized receipt and treasury credit. Follow the cycle rollout
instructions before enabling automatic purchases and burns.
