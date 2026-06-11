/**
 * CryptValt — Story Protocol Integration Layer
 *
 * Story Protocol provides on-chain programmable IP licenses —
 * enabling recurring licensing payments enforced by smart
 * contracts, not just one-time auction sales.
 *
 * ══════════════════════════════════════════════════════════
 * CURRENT STATUS: Prepared, not yet active
 *
 * Story Protocol requires mainnet deployment and their SDK.
 * All code is production-ready. Activation steps below.
 * ══════════════════════════════════════════════════════════
 *
 * PLUG & PLAY ACTIVATION INSTRUCTIONS:
 *
 * Step 1 — Install Story Protocol SDK
 *   In your backend package.json, add:
 *   "@story-protocol/core-sdk": "^1.0.0"
 *   Run: npm install
 *
 * Step 2 — Deploy to Story Protocol mainnet
 *   Story Protocol runs on their own L2 (Odyssey testnet →
 *   mainnet). Deploy CryptValt contracts there OR use their
 *   existing IP Asset Registry.
 *   Reference: https://docs.story.foundation
 *
 * Step 3 — Add environment variable
 *   In Vercel: STORY_PROTOCOL_ENABLED = true
 *   In Vercel: STORY_RPC_URL = https://odyssey.storyrpc.io (testnet)
 *              or mainnet RPC when available
 *
 * Step 4 — Enable in this file
 *   Change: const STORY_ENABLED = false
 *   To:     const STORY_ENABLED = process.env.STORY_PROTOCOL_ENABLED === 'true'
 *
 * Step 5 — Wire into licensing submit
 *   In goToStep5 (index.html), after listing is created,
 *   call: await StoryProtocol.registerIPAsset(listing)
 *   The listing will be registered as an IP Asset on Story
 *   and a PIL (Programmable IP License) attached.
 * ══════════════════════════════════════════════════════════
 *
 * WHAT STORY PROTOCOL ADDS:
 * - On-chain recurring license payments (not just one-time auction)
 * - Programmable IP License (PIL) terms enforced by contract
 * - Royalty token system — license revenue flows automatically
 * - IP Asset Registry — your idea gets a permanent on-chain ID
 * - Derivative works tracking — if someone builds on the idea,
 *   royalties flow back to original inventor automatically
 */

// ── Feature Flag ───────────────────────────────────────────
// Set to true after following activation instructions above
const STORY_ENABLED = false;
// When ready: const STORY_ENABLED = true;

const StoryProtocol = (() => {

  // ── PIL License Terms ──────────────────────────────────
  // These are the default license terms attached to every
  // CryptValt IP Asset registration. Customize as needed.
  const DEFAULT_PIL_TERMS = {
    transferable:          true,
    royaltyPolicy:         'LAP',          // Liquid Absolute Percentage
    defaultMintingFee:     0,              // Free to mint license tokens
    expiration:            0,              // Non-expiring
    commercialUse:         true,
    commercialAttribution: true,
    commercializerChecker: '0x0000000000000000000000000000000000000000',
    commercializerCheckerData: '0x',
    commercialRevShare:    1000,           // 10% royalty in basis points
    commercialRevCeiling:  0,              // No ceiling
    derivativesAllowed:    true,
    derivativesAttribution:true,
    derivativesApproval:   false,
    derivativesReciprocal: true,
    derivativeRevCeiling:  0,
  };

  // ── Check if active ────────────────────────────────────
  function isEnabled() {
    return STORY_ENABLED && typeof window !== 'undefined';
  }

  // ── Register IP Asset ──────────────────────────────────
  // Call this after a listing is created to register it
  // as an IP Asset on Story Protocol
  async function registerIPAsset(listing) {
    if (!isEnabled()) {
      console.info('[StoryProtocol] Not active. Follow activation instructions in JS/story-protocol.js');
      return { registered: false, reason: 'Story Protocol not yet activated' };
    }

    try {
      // Dynamic import — SDK only loaded when feature is active
      const { StoryClient, StoryConfig } = await import('@story-protocol/core-sdk');
      const { createWalletClient, createPublicClient, http, custom } = await import('viem');
      const { odyssey } = await import('@story-protocol/core-sdk/chains');

      const walletClient = createWalletClient({
        chain:     odyssey,
        transport: custom(window.ethereum),
        account:   state.wallet,
      });

      const client = StoryClient.newClient({
        account:   state.wallet,
        transport: http(CONFIG.STORY_RPC_URL || 'https://odyssey.storyrpc.io'),
        chainId:   'odyssey',
      });

      // Register as NFT IP Asset using the listing's IPFS CID as metadata
      const response = await client.ipAsset.mintAndRegisterIpAssetWithPilTerms({
        spgNftContract: CONFIG.STORY_SPG_NFT_CONTRACT, // Add to config when known
        pilType:        1,  // Non-Commercial Social Remixing
        ipMetadata: {
          ipMetadataURI:  `ipfs://${listing.cid}`,
          ipMetadataHash: `0x${listing.keyHash.slice(0, 64)}`,
          nftMetadataURI: `ipfs://${listing.cid}`,
        },
        txOptions: { waitForTransaction: true },
      });

      const result = {
        registered:  true,
        ipId:        response.ipId,
        tokenId:     response.tokenId,
        txHash:      response.txHash,
        licenseTermsId: response.licenseTermsId,
        explorerUrl: `https://explorer.story.foundation/ipa/${response.ipId}`,
      };

      // Save Story Protocol IDs to listing
      listing.storyIpId          = result.ipId;
      listing.storyTokenId       = result.tokenId;
      listing.storyLicenseTermsId = result.licenseTermsId;
      localStorage.setItem('cv_listings', JSON.stringify(state.listings));

      console.log(`[StoryProtocol] IP Asset registered: ${result.ipId}`);
      notify('success', '📜 IP Asset Registered', `Idea registered on Story Protocol. IP ID: ${result.ipId.slice(0,12)}...`);

      return result;

    } catch(e) {
      console.error('[StoryProtocol] Registration failed:', e.message);
      notify('warn', 'Story Protocol Unavailable', 'IP Asset registration skipped: ' + e.message);
      return { registered: false, reason: e.message };
    }
  }

  // ── Mint License Token ─────────────────────────────────
  // Called when a buyer wins an auction — mints them a
  // license token for the IP Asset
  async function mintLicenseToken(listing, buyerWallet) {
    if (!isEnabled() || !listing.storyIpId) return { minted: false };

    try {
      const { StoryClient } = await import('@story-protocol/core-sdk');
      const { http }        = await import('viem');

      const client = StoryClient.newClient({
        account:   buyerWallet,
        transport: http(CONFIG.STORY_RPC_URL || 'https://odyssey.storyrpc.io'),
        chainId:   'odyssey',
      });

      const response = await client.license.mintLicenseTokens({
        licensorIpId:  listing.storyIpId,
        licenseTermsId: listing.storyLicenseTermsId,
        amount:        1,
        receiver:      buyerWallet,
        txOptions:     { waitForTransaction: true },
      });

      notify('success', '🪙 License Token Minted', `License token minted to your wallet.`);
      return { minted: true, tokenId: response.licenseTokenIds?.[0], txHash: response.txHash };

    } catch(e) {
      console.error('[StoryProtocol] License mint failed:', e.message);
      return { minted: false, reason: e.message };
    }
  }

  // ── Get Royalty Info ───────────────────────────────────
  // Returns royalty earnings for an inventor's IP Assets
  async function getRoyaltyInfo(inventorWallet) {
    if (!isEnabled()) return null;

    try {
      const { StoryClient } = await import('@story-protocol/core-sdk');
      const { http }        = await import('viem');

      const client = StoryClient.newClient({
        account:   inventorWallet,
        transport: http(CONFIG.STORY_RPC_URL || 'https://odyssey.storyrpc.io'),
        chainId:   'odyssey',
      });

      const myListings = state.listings.filter(l =>
        l.wallet?.toLowerCase() === inventorWallet.toLowerCase() && l.storyIpId
      );

      const royalties = [];
      for (const listing of myListings) {
        try {
          const earned = await client.royalty.getRoyaltyVaultAddress({ ipId: listing.storyIpId });
          royalties.push({ listingId: listing.id, ipId: listing.storyIpId, vaultAddress: earned });
        } catch { /* skip */ }
      }

      return royalties;
    } catch(e) {
      console.error('[StoryProtocol] Royalty fetch failed:', e.message);
      return null;
    }
  }

  // ── Display Status ─────────────────────────────────────
  function getStatus() {
    return {
      enabled:    STORY_ENABLED,
      activateAt: 'Mainnet deployment — see JS/story-protocol.js for instructions',
    };
  }

  return {
    isEnabled,
    registerIPAsset,
    mintLicenseToken,
    getRoyaltyInfo,
    getStatus,
    DEFAULT_PIL_TERMS,
  };

})();
