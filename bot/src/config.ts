import { PublicKey } from '@solana/web3.js';

// An enum to make the venues type-safe and readable
export enum DEX {
  Orca = 'Orca',
  Raydium = 'Raydium',
}

// Token Mints (Mainnet)
export const MINTS = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'), // Wrapped SOL
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
  mSOL: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
};

// DEX Program IDs
export const DEX_PROGRAMS = {
  [DEX.Orca]: new PublicKey('whirLbMiicVdio4iht4A5Q6gnsMwU5IscRascQfA4B4'),
  [DEX.Raydium]: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'), // Raydium Liquidity Pool V4
};

// Pools to monitor
export const POOLS_TO_WATCH = {
  [DEX.Orca]: [
    new PublicKey('HJPjoWUrhoZzkNfRpHuieeFk9WcOPjhpAihcjC3gCzko'), // SOL/USDC (0.05%)
    new PublicKey('7hYVjX2G2P3d2eWdjG7E1aEaH8Co7A8jV5Tf5s8a2abF'), // SOL/USDT (0.05%)
    new PublicKey('555wW3bjVdAzpasJpTe2o495aHSf3h2mHB51yJB12A1e'), // USDC/USDT (0.01%)
    new PublicKey('9KpjcpK31p42T2aM5zT4kGk2kH3pX1zW22p22eG4t1Xq'), // mSOL/SOL (0.05%)
  ],
  [DEX.Raydium]: [
    new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqbAaGMA3LdN2gq7'), // SOL-USDC
    new PublicKey('382sK2A2b2Vv7x2nF4V3vCW1p2aBf3h2B6nB12a4b1eF'), // SOL-USDT
    new PublicKey('H2a4b1eF3h2B6nB12a4b1eF58oQChx4yWmvKdwLLZzBi'), // USDC-USDT
    new PublicKey('F4H2FYD4KCoNkY11McCe8BenwNYB9KpjcpK31p42T2aM'), // mSOL-SOL
    ],
};

// Solend Program and Reserve IDs (Mainnet)
export const SOLEND_CONFIG = {
  PROGRAM_ID: new PublicKey('So1endDq2YkqhipRh3WabuyC5scIPEaAiVnAEb2M25A'),
  USDC_RESERVE: new PublicKey('BgxfHDRbznSgVLfec2IeAo9TSMhPGEug22S2wea9mXg0'),
  USDC_LIQUIDITY_SUPPLY: new PublicKey('869s2f4Dme2o4aVDB522s2WEa9mXg0BgxfHDRbznSgVL'),
  LENDING_MARKET: new PublicKey('4UpD2fh7xH3VP9xp4sMcpMTgfSJmsfpUVLQDEbVsfk6A'),
  LENDING_MARKET_AUTHORITY: new PublicKey('DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby'),
  PYTH_USDC_PRICE_ACCOUNT: new PublicKey('Gnt27xtC473ZT2Mw5u8wKw2k2p4S61tbeG4o4DUx2Lpi'),
};
