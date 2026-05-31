/**
 * CryptValt — Configuration
 * API keys handled by backend — never exposed in frontend
 */

const CONFIG = {
  BACKEND_URL:   'https://crypt-valt-backend-jkak.vercel.app',
  OWNER_WALLET:  '0x26A01Cb4af917a8FD359738b48Dc60E92b1C6504',
  PLATFORM_FEE:  0.20,
  INVENTOR_SHARE: 0.80,

  CONTRACTS: {
    CRYPTVALT:  null,
    GOVERNOR:   null,
    VALUATION:  null,
  },

  CHAIN_ID:   11155111,
  CHAIN_NAME: 'Sepolia Testnet',
  RPC_URL:    'https://rpc.sepolia.org',
};
