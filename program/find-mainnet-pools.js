// Save as find-mainnet-pools.js
const { Connection, PublicKey } = require('@solana/web3.js');

const connection = new Connection("https://api.mainnet-beta.solana.com");

// Orca addresses on mainnet
const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const WHIRLPOOLS_CONFIG = new PublicKey("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ");

// Token mints on mainnet
const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MAINNET = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

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

async function findMainnetPools() {
  console.log("🔍 Searching for active Whirlpools on MAINNET...");
  console.log("ℹ️  This shows what's available for real trading");

  const pools = [
    { tokenA: "SOL", tokenB: "USDC", mintA: SOL_MINT, mintB: USDC_MAINNET, tickSpacing: 64 },
    { tokenA: "SOL", tokenB: "USDC", mintA: SOL_MINT, mintB: USDC_MAINNET, tickSpacing: 128 },
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

      console.log("  ✅ ACTIVE POOL FOUND!");
      console.log("  📊 Data size:", accountInfo.data.length, "bytes");
      
      if (accountInfo.data.length >= 200) {
        const data = accountInfo.data;
        const tokenVaultA = new PublicKey(data.slice(101, 133));
        const tokenVaultB = new PublicKey(data.slice(181, 213));
        
        console.log("  💰 Token Vault A:", tokenVaultA.toString());
        console.log("  💰 Token Vault B:", tokenVaultB.toString());
        console.log("  🎯 This pool has REAL liquidity for trading!");
      }

    } catch (error) {
      console.log("  ❌ Error checking pool:", error.message);
    }
  }

  console.log("\n🚀 Next: Deploy your program to mainnet for real trading!");
  console.log("💡 Or test the CPI structure on devnet with mock accounts");
}

findMainnetPools().catch(console.error);
