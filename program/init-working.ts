// Save as init-working.ts
import { Connection, PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';

// Your program ID
const PROGRAM_ID = new PublicKey("98sqBn3ThFx8GLofFhnikdQcKxskr86vEbtRTLcw1fPZ");
const connection = new Connection("https://api.devnet.solana.com");

async function initializeArbitrageState() {
  try {
    console.log("🚀 Initializing Arbitrage State...");

    // Load wallet
    const secretKey = JSON.parse(fs.readFileSync('wallet.json', 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));
    
    console.log("👤 Wallet:", wallet.publicKey.toString());

    // Setup provider
    const walletWrapper = new Wallet(wallet);
    const provider = new AnchorProvider(connection, walletWrapper, {});

    // Find arbitrage state PDA
    const [arbitrageState, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("arbitrage_state"), wallet.publicKey.toBuffer()],
      PROGRAM_ID
    );

    console.log("🤖 Arbitrage state PDA:", arbitrageState.toString());
    console.log("📊 PDA bump:", bump);

    // Check if already exists
    const existingAccount = await connection.getAccountInfo(arbitrageState);
    if (existingAccount) {
      console.log("✅ Arbitrage state already initialized!");
      return;
    }

    // Try to load the generated IDL
    let idl;
    try {
      idl = JSON.parse(fs.readFileSync('./target/idl/arbitrage_program.json', 'utf8'));
      console.log("📄 Loaded IDL from target/idl/arbitrage_program.json");
    } catch {
      console.log("❌ Could not load IDL. Let's use the anchor test command instead.");
      console.log("Run: anchor test --skip-deploy --provider.cluster devnet");
      return;
    }

    // Dynamic import for the Program class with IDL
    const { Program } = await import('@coral-xyz/anchor');
    const program = new Program(idl, provider);

    // Initialize with 60 second minimum execution interval
    const minExecutionInterval = new BN(60);

    console.log("📝 Initializing with parameters:");
    console.log("  Min execution interval:", minExecutionInterval.toString(), "seconds");

    const tx = await program.methods
      .initializeArbitrageState(minExecutionInterval)
      .accounts({
        authority: wallet.publicKey,
        arbitrageState: arbitrageState,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Arbitrage state initialized!");
    console.log("📝 Transaction signature:", tx);
    console.log("🎯 Ready for Orca swap testing!");

  } catch (error) {
    console.error("❌ Initialization failed:", error);
    
    // If it's an account already exists error, that's actually good
    if (error.message && error.message.includes("already in use")) {
      console.log("✅ Arbitrage state was already initialized!");
    }
  }
}

initializeArbitrageState().catch(console.error);
