import { PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { creatorVaultPda, PUMP_PROGRAM_ID } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda } from 'npm:@pump-fun/pump-swap-sdk@1.13.0';

export async function solClaimInstructions(ctx, sol) {
  const { online, wallet, connection } = ctx;
  const collectPump = Boolean(sol && !sol.pumpVault.isZero());
  const collectAmm = Boolean(sol && !sol.ammVault.isZero());
  const pumpVault = creatorVaultPda(wallet.publicKey);
  const info = collectPump ? await connection.getAccountInfo(pumpVault, 'confirmed') : null;
  if (collectPump && !info) throw new Error('SOL reward vault changed; refresh and try again.');
  const pumpRent = info ? await connection.getMinimumBalanceForRentExemption(info.data.length) : 0;
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(wallet.publicKey), new PublicKey('So11111111111111111111111111111111111111112'), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
  // This SDK method is SOL-only; its all-quotes counterpart is deliberately not used.
  let instructions = collectPump || collectAmm ? await online.collectCoinCreatorFeeInstructions(wallet.publicKey) : [];
  instructions = collectAmm ? instructions.filter(ix => !ix.programId.equals(PUMP_PROGRAM_ID) || collectPump) : instructions.filter(ix => ix.programId.equals(PUMP_PROGRAM_ID) && collectPump);
  return { instructions, fields: { collectPump, collectAmm, pumpVault: pumpVault.toBase58(), pumpRent: String(pumpRent), ammVault: ammVault.toBase58() } };
}