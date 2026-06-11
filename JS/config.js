/**
 * CryptValt — Configuration
 * API keys handled by backend — never exposed in frontend
 */

const CONFIG = {
  BACKEND_URL:    'https://crypt-valt-backend-jkak.vercel.app',
  OWNER_WALLET:   '0x05248CD920dAeB2E5369A63Fe93367f9F1bf5677',
  PLATFORM_FEE:   0.20,
  INVENTOR_SHARE: 0.80,

  CONTRACTS: {
    CRYPTVALT:  null,   // Fill in after Sepolia deployment
    GOVERNOR:   null,
    VALUATION:  null,
  },

  // ── Sepolia Testnet (active) ───────────────────────────
  CHAIN_ID:   11155111,
  CHAIN_NAME: 'Sepolia Testnet',
  RPC_URL:    'https://eth-sepolia.g.alchemy.com/v2/d9dDJRLcCVtzyTu2URTDk',

  // ── Ethereum Mainnet (activate after audit) ───────────
  // CHAIN_ID:   1,
  // CHAIN_NAME: 'Ethereum Mainnet',
  // RPC_URL:    'https://eth-mainnet.g.alchemy.com/v2/d9dDJRLcCVtzyTu2URTDk',

  // ── Story Protocol (activate post-mainnet) ────────────
  STORY_RPC_URL: 'https://odyssey.storyrpc.io',
};
