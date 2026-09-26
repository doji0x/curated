# Curated

**Curated** is a Solana application for creating coins, inscribing artwork, and verifying that supported images are present in on-chain data. It also offers wallet-based profiles and a social feed. The application distinguishes a coin’s *served metadata*—which may be updated where the launch supports it—from the image bytes and transaction history independently verifiable on Solana.

## What the application does

- **Launch a coin:** On `/launch-coin`, choose an uploaded image or an existing inscribed NFT, enter coin details, and set a required first buy. Both use the same pump.fun create-and-buy transaction approved through Phantom. Pair selection, creator fees, holder rewards, and optional custom fee sharing are available for either image source; custom splits require a separate approval after launch.
- **Inscribe artwork:** Submit an image for a one-of-one NFT inscription, monitor progress, and review past inscriptions (`/inscribe`). Image bytes are written in resumable chunks and verified against the completed on-chain data.
- **Choose an inscribed image:** Select “Use inscribed NFT” in the unified launch form to use a verified on-chain image through the inscription resolver. `/launch` redirects to `/launch-coin`.
- **Edit supported coin metadata:** A confirmed coin launched through the supported public flow can have its served name, image, and links updated by the launching wallet’s signed request (`/edit-coin`). Eligibility and the scope of updates depend on the launch; this does not rewrite immutable on-chain records or guarantee that third-party caches refresh immediately.
- **Verify an inscription:** Submit a mint address or transaction signature on the home page. Independent checks examine supported Metaplex, LibrePlex, versioned-transaction, and token-held inscription paths and return evidence or an explicit inconclusive result.
- **Participate in the community:** Connect a wallet to create a profile and post to the feed (`/feed`).

## Metadata and provenance

A metadata URI tells clients where to retrieve a coin’s displayed information. Keeping control of the metadata served at that address can help creators correct errors and keep links and artwork presentation current, subject to authority and platform constraints. A served metadata update must not be confused with changing the original inscription: verification reads supported image bytes from Solana data rather than accepting a metadata image URL as proof.

A successful verification establishes that qualifying bytes and the reported linkage were observed at lookup time. It does **not** establish authorship, legal ownership, token safety, or future availability of an external metadata service.

## Architecture

| Layer | Implementation |
| --- | --- |
| Client | React, Vite, React Router, Tailwind CSS |
| Data and authentication | Base44 entities and authentication |
| Server | Base44 backend functions and scheduled workflows |
| Blockchain | Solana mainnet RPC; Metaplex and LibrePlex inscription verification |
| Wallet | Phantom connection and signed creator actions |

The frontend lives in `src/`, backend functions in `base44/functions/`, shared server logic in `base44/shared/`, and scheduled work in `base44/workflows/`. The main route definitions are in `src/App.jsx`.

## Development

This repository requires Node.js and npm. Install dependencies and start the frontend:

```bash
npm install
npm run dev
```

Use a Base44 environment linked to this application for features that call backend functions, authenticate users, or read and write records. Configure third-party credentials in the application’s secret settings; never commit wallet keys, RPC credentials, or API keys to the repository. Solana transaction features require a correctly configured mainnet RPC and funded signing wallets where applicable.

Available project checks:

```bash
npm run lint
npm run typecheck
npm run build
```

## Operational notes

- Inscription writes can take multiple transactions; the background worker stores progress to support resumption.
- Saved coin launches retain their mint keys in the originating browser. Check or resume unconfirmed launches from either image source; an uncertain submission is checked before another approval is requested. Older create-only drafts require an explicit first buy and fresh wallet approval before a new create-and-buy attempt.
- A `valid` verifier result describes the observed on-chain state; `unknown` means the evidence was inconclusive, not that an inscription is absent.
- Metadata services and third-party platforms may cache results, so displayed changes may lag behind an update.
- A long-lived metadata URI depends on its hosting domain and endpoint remaining available. Plan domain ownership and continuity before using one as permanent launch infrastructure.
- Administrative minting, launch management, and other privileged tools are separate from the public wallet flows.

## References

- [Solana documentation](https://solana.com/docs)
- [Metaplex inscriptions](https://developers.metaplex.com/inscription)
- [Base44 documentation](https://docs.base44.com)
## Creator reward claims

The admin claim action collects SOL creator rewards into the verified treasury.
Purchases are paused during this claim-only phase; the hourly worker reconciles
existing receipts without initiating buys. See [claim behavior, configuration,
and validation](docs/creator-reward-claims.md).
