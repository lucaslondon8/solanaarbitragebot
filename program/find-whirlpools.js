// Save as find-whirlpools.js
const { Connection, PublicKey } = require('@solana/web3.js');

const connection = new Connection("https://api.devnet.solana.com");

// Orca addresses on devnet
const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WHIRLPOOLS_CONFIG = new PublicKey("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ");

// Token mints on devnet
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

function findWhirlpoolPda(tokenMintA, tokenMintB, tickSpacing) {
  const tickSpacingBytes = Buffer.alloc(2);
  tickSpacingBytes.writeUInt16LE(tickSpacing);

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("whirlpool"),
      WHIRLPOOLS_CONFIG.toBuffer(),
      tokenMintA.toBuffer(),
      tokenMintB.toBuffer(),
      tickSpacingBytes,
    ],
    WHIRLPOOL_PROGRAM_ID
  );
}

function findOraclePda(whirlpool) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), whirlpool.toBuffer()],
    WHIRLPOOL_PROGRAM_ID
  );
}

function findTickArrayPda(whirlpool, startTickIndex) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("tick_array"),
      whirlpool.toBuffer(),
      Buffer.from(startTickIndex.toString()),
    ],
    WHIRLPOOL_PROGRAM_ID
  );
}

async function findActiveWhirlpools() {
  console.log("🔍 Searching for active Whirlpools on devnet...");

  const pools = [
    { tokenA: "SOL", tokenB: "USDC", mintA: SOL_MINT, mintB: USDC_DEVNET, tickSpacing: 64 },
    { tokenA: "SOL", tokenB: "USDC", mintA: SOL_MINT, mintB: USDC_DEVNET, tickSpacing: 128 },
    { tokenA: "SOL", tokenB: "USDC", mintA: SOL_MINT, mintB: USDC_DEVNET, tickSpacing: 8 },
  ];

  for (const pool of pools) {
    try {
      console.log(`\n🌊 Checking ${pool.tokenA}/${pool.tokenB} (tick spacing: ${pool.tickSpacing})`);

      const [whirlpool, bump] = findWhirlpoolPda(pool.mintA, pool.mintB, pool.tickSpacing);
      console.log("  Whirlpool address:", whirlpool.toString());

      const accountInfo = await connection.getAccountInfo(whirlpool);
      if (!accountInfo) {
        console.log("  ❌ Pool does not exist");
        continue;
      }

      console.log("  ✅ Pool exists!");
      console.log("  📊 Data size:", accountInfo.data.length, "bytes");
      
      // Find associated accounts
      const [oracle] = findOraclePda(whirlpool);
      console.log("  🔮 Oracle:", oracle.toString());

      // Find tick arrays (around current tick - we'll use 0 as example)
      const [tickArray0] = findTickArrayPda(whirlpool, 0);
      const [tickArray1] = findTickArrayPda(whirlpool, 5632); // 88 * 64
      const [tickArray2] = findTickArrayPda(whirlpool, -5632);

      console.log("  📊 Tick Arrays:");
      console.log("    Array 0:", tickArray0.toString());
      console.log("    Array 1:", tickArray1.toString());
      console.log("    Array 2:", tickArray2.toString());

      // Check oracle exists
      const oracleInfo = await connection.getAccountInfo(oracle);
      console.log("  🔮 Oracle exists:", oracleInfo ? "✅" : "❌");

      // Parse basic whirlpool data (first few fields)
      if (accountInfo.data.length >= 200) {
        const data = accountInfo.data;
        
        // Basic whirlpool structure (simplified)
        const tokenVaultA = new PublicKey(data.slice(101, 133));
        const tokenVaultB = new PublicKey(data.slice(181, 213));
        
        console.log("  🪙 Token Vault A:", tokenVaultA.toString());
        console.log("  🪙 Token Vault B:", tokenVaultB.toString());

        console.log("\n  🎯 READY FOR TRADING!");
        console.log("  📋 Complete account set for orca_swap:");
        console.log("    whirlpool:", whirlpool.toString());
        console.log("    tokenVaultA:", tokenVaultA.toString());
        console.log("    tokenVaultB:", tokenVaultB.toString());
        console.log("    oracle:", oracle.toString());
        console.log("    tickArray0:", tickArray0.toString());
        console.log("    tickArray1:", tickArray1.toString());
        console.log("    tickArray2:", tickArray2.toString());
      }

    } catch (error) {
      console.log("  ❌ Error checking pool:", error.message);
    }
  }

  console.log("\n🚀 Next: Use these addresses in your orca_swap instruction!");
}

findActiveWhirlpools().catch(console.error);
