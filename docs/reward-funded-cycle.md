# Reward-funded claim, buy and burn

This implements the five-minute cycle for Burn mint
`6ZdCWrLhmBJmoLCL8reNCBxqJGBxXgQyM2PcDo4kpump`, signed only by
`ADMIN_MINT_WALLET_SECRET_KEY`. Its derived wallet must be
`3ggRizSixiDPXyHrEzBaZ3Nm8QfFRD1FbrkkYYpxMxkq` on Solana mainnet.

## Accounting

The purchase budget is **never derived from wallet SOL balance**. For each
eligible finalized claim after activation, allocate `floor(received * 8000 / 10000)`
lamports to purchases and retain the remainder. Available buying power equals
these allocations minus actual finalized purchase transfers. All arithmetic uses
integer strings/BigInt; fees are included in the trade's quote spend, while
Solana transaction fees and account rent are operating expenses.

Only version-1 receipts with the verified wallet, SOL quote, mint-specific scope
and Burn attribution count. Pending, failed, historical, other-coin and pooled
creator-wallet claims do not count. Deposits, pre-existing SOL and reclaimed rent
never increase the reward budget. Small unspent quote remainders carry forward.
An empty eligible balance never purchases tokens, even from a rich wallet.

The first activation records `rewardStartedAt`; it does not retroactively allocate
old claims or assume that existing wallet funds are unspent rewards. Pausing and
reenabling preserve this timestamp. Do not edit/delete accounting records or
reset the timestamp to restart an interrupted cycle.

Retained rewards and the unspent allocation remain protected in the treasury.
Fund a separate operating balance sufficient for a 0.03 SOL reserve plus network
fees and token-account creation. The builder checks both the starting balance
and simulated post-transaction balance. These balance checks can block a
transaction; they can never enlarge the purchase budget. Manual claims use the
same protected balance once accounting has started.

## Execution and recovery

`Burn Buyback Sweep` schedules `runBurnRewardCycle` at `*/5 * * * *` UTC. The
worker takes the existing shared treasury lease and works for up to 210 seconds.
This is a scheduled check, not a guarantee of chain finalization within five
minutes. Pending transactions, insufficient operating funds, SDK validation
failures and RPC outages defer progress to a later run.

1. Reconcile saved pending transactions before preparing anything new.
2. Resume an unfinished purchase/burn/cleanup. Once a purchase is finalized,
   new claims cannot delay burning those tokens.
3. Otherwise claim isolated Burn creator rewards using the existing Pump SDK
   claim builder. Finalized transaction evidence determines the actual credit.
4. Buy on the bonding curve or canonical PumpSwap SOL pool, using the published
   exact-quote-input instruction and a 1% minimum-output slippage limit. Validate
   the instruction's account layout against the pinned SDK IDL. Measure actual
   quote transfers and the acquired Burn token delta from finalized metadata.
5. Send SPL `BurnChecked` for exactly that acquired amount, using the mint's
   actual Token or Token-2022 program. Verify the finalized token reduction.
6. Only after burning, close the token account if its balance is zero and the
   treasury can close it. Recover rent to the treasury as operating funds.
   Existing token holdings are preserved, and their account stays open. No
   Sol Incinerator service or third-party burn fee is needed.

These are separate transactions. `BurnRewardCycle` stores the phase and
`BuybackRecord` stores each transaction's exact signed bytes, signature, message
hash and finalized evidence. Persist before sending. An ambiguous send can only
rebroadcast the same bytes until the transaction finalizes or expires. A failed
burn retries burning in a later invocation; it never purchases again. A database
failure after on-chain success is recovered from the saved receipt before
advancing the phase. Never clear a pending receipt to force a retry.

Pausing stops new submissions/rebroadcasts, but already submitted transactions
may still land and are still reconciled. Resume to finish a saved burn. Pending
legacy purchases are reconciled but never rebroadcast automatically.

## Authorization and deployment

The worker ignores client-supplied mint, wallet and amount parameters. It first
uses the caller-scoped SDK to read the singleton control record under its
admin-only RLS. Only an authorized admin or platform service-role caller can
pass; the mere presence of an injected service header does not grant access.
Record writes then use the service-role SDK. Keep all three entities admin-only.

Deploy the new `BurnRewardCycle` entity and changed `BuybackRecord` and
`BurnBuybackState` schemas, both functions and their shared modules, workflow,
and UI together. Leave `automationEnabled` false initially. The control record
must already exist exactly once with key `burn-v1` and a valid expired lock.
Verify hosted secrets without printing them, mainnet RPC access, and the public
signer shown at `/admin/buybacks`.

Before activation, verify that a scheduled workflow invocation passes the
caller-scoped authorization and returns a paused result. Hosted scheduler
identity cannot be verified by local unit tests. If it returns 403, fix the
workflow's authenticated invocation; do not bypass RLS or trust a body flag.
Ensure the workflow is active and retains the five-minute schedule. An admin
then uses **Enable every 5 minutes**; this creates the accounting start time.
Check the first complete cycle's claim, buy and burn receipts, retained amount
and cleanup result in the dashboard. Keep the worker paused if evidence cannot
be reconciled. No deployment, live activation or signed mainnet transaction is
part of this source-code change.

## Scope and verification

This worker deliberately supports only the specified Burn mint. Future launches
need a mint registry and isolated mint-specific ledgers, cycles, claim sources
and locks before enabling this policy for each coin. Never assign a pooled
creator-vault balance to a single new launch.

Run the claim/cycle regression suite, lint and build with Node 24:

```sh
node --import ./tests/claims/register.mjs --test tests/claims/*.test.mjs
npm run lint
npm run build
```

Tests use the real pinned Pump instruction coders and mock persistence/RPC.
They cover accounting exclusions, exact purchase limits, burn deltas, zero-balance
cleanup, reserve protection, scheduler authorization, interruption recovery and
dashboard controls. An unsigned mainnet simulation of the exact-input Burn buy
succeeded on 2026-09-26; it submitted no transaction. Hosted end-to-end execution
and scheduler credentials still require deployment verification.

References: [Pump SDK](https://www.npmjs.com/package/@pump-fun/pump-sdk),
[Solana burn](https://solana.com/docs/tokens/basics/burn-tokens),
[Solana close account](https://solana.com/docs/tokens/basics/close-account),
[Base44 workflows](https://docs.base44.com/Building-your-app/Creating-workflows).
