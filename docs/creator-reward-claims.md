# Creator reward claims: first phase

The admin claim action collects SOL creator rewards into
`3ggRizSixiDPXyHrEzBaZ3Nm8QfFRD1FbrkkYYpxMxkq`. It does not purchase or burn tokens.
The configured target coin is
`6ZdCWrLhmBJmoLCL8reNCBxqJGBxXgQyM2PcDo4kpump`.

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
  account rent required by direct PumpSwap collection. Claims are not subject
  to the buyback's 0.01 SOL minimum or 0.03 SOL reserve.

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

## Purchase protection and later phases

All new automatic and manual purchases, purchase previews, and attempts to enable
buybacks are blocked in this phase, even if an existing database record says
`enabled: true`. The hourly workflow only reconciles pending receipts. Already
submitted transactions may still land; the dashboard checks them and does not
rebroadcast historical purchase transactions. No live workflow setting is changed
by this source-only branch.

The later design is a per-coin ledger: 80% of each verified claim funds buying and
burning that same coin; 20% is retained by the treasury. This change does not yet
allocate or spend claims. Pooled creator-wallet receipts need attribution before
any per-coin budget is created. Network-fee funding remains a separate design
choice.

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
and verify its finalized receipt and treasury credit before implementing buys.
