import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";

// Import the generated type
type ArbitrageBot = {
  "version": "0.1.0",
  "name": "arbitrage_bot",
  "instructions": [
    {
      "name": "initializeArbitrageState",
      "accounts": [
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "arbitrageState",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "minExecutionInterval",
          "type": "i64"
        }
      ]
    }
  ]
};

describe("arbitrage-bot", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.arbitrageBot as Program<ArbitrageBot>;
  
  // Test accounts
  let authority: Keypair;
  let user: Keypair;
  let mint: PublicKey;
  let userTokenAccount: PublicKey;
  let authorityTokenAccount: PublicKey;
  let arbitrageStatePDA: PublicKey;
  let bump: number;

  before(async () => {
    // Create test keypairs
    authority = Keypair.generate();
    user = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(authority.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(user.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    
    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create test token mint
    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6 // USDC decimals
    );

    // Create token accounts
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );

    authorityTokenAccount = await createAccount(
      provider.connection,
      authority,
      mint,
      authority.publicKey
    );

    // Mint some tokens to user account
    await mintTo(
      provider.connection,
      authority,
      mint,
      userTokenAccount,
      authority,
      1_000_000 // 1 token (6 decimals)
    );

    // Find PDA for arbitrage state
    [arbitrageStatePDA, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("arbitrage_state"), user.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initialize arbitrage state", async () => {
    const minExecutionInterval = new anchor.BN(300); // 5 minutes

    const tx = await program.methods
      .initializeArbitrageState(minExecutionInterval)
      .accounts({
        authority: user.publicKey,
        arbitrageState: arbitrageStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("Initialize transaction signature:", tx);

    // Verify the state was initialized correctly
    const stateAccount = await program.account.arbitrageState.fetch(arbitrageStatePDA);
    
    expect(stateAccount.authority.toString()).to.equal(user.publicKey.toString());
    expect(stateAccount.minExecutionInterval.toString()).to.equal(minExecutionInterval.toString());
    expect(stateAccount.isPaused).to.be.false;
    expect(stateAccount.totalTrades.toString()).to.equal("0");
    expect(stateAccount.totalProfit.toString()).to.equal("0");
  });

  it("Execute flash arbitrage", async () => {
    const borrowAmount = new anchor.BN(100_000); // 0.1 token
    const minProfitLamports = new anchor.BN(1_000); // Minimum profit

    // Create test swap routes
    const swapRoutes = [
      {
        dexId: { orca: {} },
        amountIn: new anchor.BN(50_000),
        minAmountOut: new anchor.BN(49_000),
        inputMint: mint,
        outputMint: mint, // In real scenario, this would be different
      }
    ];

    const tx = await program.methods
      .executeFlashArbitrage(borrowAmount, minProfitLamports, swapRoutes)
      .accounts({
        user: user.publicKey,
        arbitrageState: arbitrageStatePDA,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log("Flash arbitrage transaction signature:", tx);

    // Verify state was updated
    const stateAccount = await program.account.arbitrageState.fetch(arbitrageStatePDA);
    expect(stateAccount.totalTrades.toString()).to.equal("1");
  });

  it("Pause bot (authority only)", async () => {
    const tx = await program.methods
      .pauseBot()
      .accounts({
        authority: user.publicKey, // User is authority in this test
        arbitrageState: arbitrageStatePDA,
      })
      .signers([user])
      .rpc();

    console.log("Pause bot transaction signature:", tx);

    // Verify bot is paused
    const stateAccount = await program.account.arbitrageState.fetch(arbitrageStatePDA);
    expect(stateAccount.isPaused).to.be.true;
  });

  it("Resume bot (authority only)", async () => {
    const tx = await program.methods
      .resumeBot()
      .accounts({
        authority: user.publicKey,
        arbitrageState: arbitrageStatePDA,
      })
      .signers([user])
      .rpc();

    console.log("Resume bot transaction signature:", tx);

    // Verify bot is resumed
    const stateAccount = await program.account.arbitrageState.fetch(arbitrageStatePDA);
    expect(stateAccount.isPaused).to.be.false;
  });

  it("Update bot configuration", async () => {
    const newMinExecutionInterval = new anchor.BN(600); // 10 minutes

    const tx = await program.methods
      .updateBotConfig(newMinExecutionInterval)
      .accounts({
        authority: user.publicKey,
        arbitrageState: arbitrageStatePDA,
      })
      .signers([user])
      .rpc();

    console.log("Update config transaction signature:", tx);

    // Verify configuration was updated
    const stateAccount = await program.account.arbitrageState.fetch(arbitrageStatePDA);
    expect(stateAccount.minExecutionInterval.toString()).to.equal(newMinExecutionInterval.toString());
  });

  it("Fail to execute when paused", async () => {
    // First pause the bot
    await program.methods
      .pauseBot()
      .accounts({
        authority: user.publicKey,
        arbitrageState: arbitrageStatePDA,
      })
      .signers([user])
      .rpc();

    // Try to execute arbitrage while paused
    const borrowAmount = new anchor.BN(100_000);
    const minProfitLamports = new anchor.BN(1_000);
    const swapRoutes = [];

    try {
      await program.methods
        .executeFlashArbitrage(borrowAmount, minProfitLamports, swapRoutes)
        .accounts({
          user: user.publicKey,
          arbitrageState: arbitrageStatePDA,
          userTokenAccount: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      
      // Should not reach here
      expect.fail("Should have failed due to bot being paused");
    } catch (error) {
      expect(error.error.errorCode.code).to.equal("BotPaused");
    }
  });

  it("Fail with invalid parameters", async () => {
    // Resume bot first
    await program.methods
      .resumeBot()
      .accounts({
        authority: user.publicKey,
        arbitrageState: arbitrageStatePDA,
      })
      .signers([user])
      .rpc();

    // Try with zero borrow amount
    try {
      await program.methods
        .executeFlashArbitrage(new anchor.BN(0), new anchor.BN(1000), [])
        .accounts({
          user: user.publicKey,
          arbitrageState: arbitrageStatePDA,
          userTokenAccount: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
      
      expect.fail("Should have failed due to invalid amount");
    } catch (error) {
      expect(error.error.errorCode.code).to.equal("InvalidAmount");
    }
  });
});
