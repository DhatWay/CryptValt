/**
 * CryptValt — Configuration
 * All platform config, contract addresses, and ABIs
 */

const CONFIG = {
  PINATA_API_KEY:    '%%PINATA_API_KEY%%',
  PINATA_API_SECRET: '%%PINATA_API_SECRET%%',
  ANTHROPIC_API_KEY: '%%ANTHROPIC_API_KEY%%',
  OWNER_WALLET:      '0x26A01Cb4af917a8FD359738b48Dc60E92b1C6504',
  PLATFORM_FEE:      0.20,
  INVENTOR_SHARE:    0.80,

  CONTRACTS: {
    CRYPTVALT:  null,
    GOVERNOR:   null,
    VALUATION:  null,
  },

  CHAIN_ID:   11155111,
  BACKEND_URL: 'https://crypt-valt-backend-jkak.vercel.app',
  CHAIN_NAME: 'Sepolia Testnet',
  RPC_URL:    'https://rpc.sepolia.org',
};

const ABIS = {
  CRYPTVALT: [
    'function getListing(uint256) view returns (tuple(uint128,uint64,uint64,uint128,uint64,uint64,uint96,uint96,uint64,address,uint32,address,uint8,bool,bool,bool,string,string,string,string))',
    'function getBidders(uint256) view returns (address[])',
    'function getBid(uint256,address) view returns (bytes32,uint256,uint256,uint256,bool,bool,bool)',
    'function getWinnerKey(uint256) view returns (string)',
    'function getInventorListings(address) view returns (uint256[])',
    'function getBidderHistory(address) view returns (uint256[])',
    'function getPlatformStats() view returns (uint256,uint256,uint256,uint256,bool)',
    'function getNonce(address) view returns (uint256)',
    'function pendingWithdrawals(address) view returns (uint256)',
    'function listingCount() view returns (uint256)',
    'function paused() view returns (bool)',
    'function listIdea(string,string,string,uint256,uint256,uint256,uint256,uint256,bytes) returns (uint256)',
    'function commitBid(uint256,bytes32) payable',
    'function revealBid(uint256,uint256,bytes32)',
    'function settleAuction(uint256)',
    'function deliverKey(uint256,string,bytes)',
    'function claimKeyDeadlineRefund(uint256)',
    'function raiseDispute(uint256,string)',
    'function withdraw()',
    'function listSecondary(uint256,uint256)',
    'function buySecondary(uint256) payable',
    'event IdeaListed(uint256 indexed,address indexed,string,string,uint256,uint256,uint256,uint256)',
    'event BidCommitted(uint256 indexed,address indexed,bytes32,uint256,uint256)',
    'event AuctionSettled(uint256 indexed,address indexed,uint256,uint256,uint256,uint256)',
    'event FundsReleased(uint256 indexed,address indexed,uint256,address,uint256)',
  ],
  GOVERNOR: [
    'function canBid(address) view returns (bool,string)',
    'function canList(address) view returns (bool,string)',
    'function getTrustTier(address) view returns (string)',
    'function getReputationScore(address) view returns (uint256)',
    'function getGovernanceStats() view returns (uint256,uint256,uint256,bool)',
  ],
  VALUATION: [
    'function quickEstimate(uint256,string,uint256) view returns (uint256,uint256,uint256)',
    'function getValuation(uint256) view returns (tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256))',
    'function getCategoryProfile(string) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  ],
};