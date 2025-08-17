import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';
import { ArbitrageOpportunity } from './discovery';
import { SOLEND_CONFIG } from './config';
import { 
    TOKEN_PROGRAM_ID, 
    createInitializeAccountInstruction,
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    createCloseAccountInstruction,
} from '@solana/spl-token';

/**
 * Assembles and executes the full flash loan arbitrage transaction and sweeps the profit.
 */
export async function executeFlashLoanArbitrage(
  program: Program,
  wallet: Keypair,
  opportunity: ArbitrageOpportunity,
  borrowAmount: bigint,
  borrowTokenMint: PublicKey, // We need to know which token we're borrowing (e.g., USDC mint)
) {
  console.log(`🚀 Executing flash loan for ${borrowAmount} of mint ${borrowTokenMint.toBase58()}`);

  // This temporary account will be created on-chain to hold the borrowed funds.
  const tempTokenAccount = Keypair.generate();
  
  // Instructions to create and initialize the temporary token account.
  // The owner of this account will be our main bot wallet.
  const createTempAccountIx = SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: tempTokenAccount.publicKey,
      lamports: await program.provider.connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TOKEN_PROGRAM_ID,
  });
  const initTempAccountIx = createInitializeAccountInstruction(
      tempTokenAccount.publicKey,
      borrowTokenMint,
      wallet.publicKey, // Set our main wallet as the owner/authority
      TOKEN_PROGRAM_ID
  );

  // Instruction to borrow from Solend
  const borrowIx = new TransactionInstruction({ /* ... same as before ... */ });

  // Your program's arbitrage instruction
  const arbitrageIx = await program.methods
    .executeArbitrage(/* ... */)
    .accounts({
      authority: wallet.publicKey,
      tradeWallet: tempTokenAccount.publicKey,
      // ... remainingAccounts ...
    }).instruction();

  // Instruction to repay the loan to Solend
  const repayIx = new TransactionInstruction({ /* ... same as before ... */ });

  // Assemble the main arbitrage transaction
  const arbTransaction = new Transaction()
    .add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      createTempAccountIx,
      initTempAccountIx,
      borrowIx,
      arbitrageIx,
      repayIx
    );
    
  try {
    // We must sign with both our main wallet and the keypair for the temp account we're creating
    const signature = await program.provider.sendAndConfirm(arbTransaction, [wallet, tempTokenAccount]);
    console.log('✅ Arbitrage transaction confirmed! Signature:', signature);

    // --- PROFIT SWEEP LOGIC ---
    console.log('🧹 Sweeping profits...');

    // 1. Get our main wallet's permanent Associated Token Account (ATA) for this token.
    // This will create it if it doesn't exist.
    const permanentProfitAta = await getOrCreateAssociatedTokenAccount(
        program.provider.connection,
        wallet, // Payer
        borrowTokenMint,
        wallet.publicKey, // Owner
    );

    // 2. Get the balance of the temporary account. This balance *is* the profit.
    const profitBalance = await program.provider.connection.getTokenAccountBalance(tempTokenAccount.publicKey);
    const profitAmount = BigInt(profitBalance.value.amount);

    if (profitAmount > 0) {
        // 3. Create the instruction to transfer the entire profit balance to our permanent ATA.
        const sweepIx = createTransferInstruction(
            tempTokenAccount.publicKey,   // From
            permanentProfitAta.address,   // To
            wallet.publicKey,             // Authority (our main wallet)
            profitAmount
        );

        // 4. Create the instruction to close the temporary account and reclaim its rent SOL.
        const closeTempAccountIx = createCloseAccountInstruction(
            tempTokenAccount.publicKey,   // Account to close
            wallet.publicKey,             // Destination for rent SOL
            wallet.publicKey              // Authority
        );

        // 5. Build and send the cleanup transaction.
        const cleanupTx = new Transaction().add(sweepIx, closeTempAccountIx);
        const cleanupSig = await program.provider.sendAndConfirm(cleanupTx, [wallet]);
        console.log(`✅ Profit swept to ${permanentProfitAta.address.toBase58()}. Signature: ${cleanupSig}`);

    } else {
        console.log('ℹ️ No profit balance to sweep.');
    }

  } catch (error) {
    console.error('❌ Transaction failed:', error);
  }
}
