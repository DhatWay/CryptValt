/**
 * CryptValt — Configuration
 * API keys handled by backend — never exposed in frontend
 */

const CONFIG = {
  BACKEND_URL:    'https://crypt-valt-backend-jkak.vercel.app',
  OWNER_WALLET:   '0x05248CD920dAeB2E5369A63Fe93367f9F1bf5677',
  PLATFORM_FEE:   0.20,
  INVENTOR_SHARE: 0.80,

  // ── Sepolia Testnet Contracts (deployed 2026-06-13) ───
  CONTRACTS: {
    CRYPTVALT:            '0xfe059329cC4fa52C61523cCc05B385028018490F',
    CRYPTVALT_TOKEN:      '0x8eF8d713c146C59a00c43de285719dBdc27f3165',
    CRYPTVALT_GOVERNOR:   '0x2E250F5DdD03645ce15906f40832cd80B37a7441',
    CRYPTVALT_VALUATION:  '0x8736e2e6659d464B0b793C79A766a97268512748',
    CRYPTVALT_MEMBERSHIP: '0x9B3c1AF7C6ca6f59ab34895FE3445Dc207a775Ed',
    CRYPTVALT_FOUNDER:    '0x56608301685EBa37D4f652F9bB9D889869D8374C',
    CRYPTVALT_REVENUE:    '0x73ad0B6077d0DaE11BF342343d13f05a976BeB36',
    CRYPTVALT_DAO:        '0x645CA1ef74B4AC4D778D46eCb2BE3546eF378A4A',
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
