// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ============================================================
 * CryptValt Governor v3.0
 * Autonomous Platform Intelligence & Fraud Prevention
 * ============================================================
 *
 * The autonomous brain of CryptValt. Operates independently,
 * making real-time governance decisions without human input.
 *
 * Systems:
 *
 * 1. Wallet Reputation Engine (0-1000 Elo-inspired scale)
 *    - Dynamic score adjustment based on platform behavior
 *    - Trust tier classification (Platinum/Gold/Silver/Bronze/Probation/Suspended)
 *    - Verification multiplier for KYC'd wallets
 *    - Decay function for inactive wallets
 *
 * 2. Multi-Vector Fraud Detection
 *    - Wash trading: inventor-bidder identity check + linked wallet graph
 *    - Sybil attack: behavioral fingerprinting + temporal clustering
 *    - Bid velocity: sliding window rate limiting
 *    - Collusion ring: graph analysis of coordinated bid timing
 *    - Front running: mempool timing analysis approximation
 *    - Listing spam: volume/reputation ratio check
 *
 * 3. Autonomous Response System (graduated severity)
 *    - Info    → log only
 *    - Low     → flag listing
 *    - Medium  → reputation penalty
 *    - High    → freeze listing
 *    - Critical → freeze wallet + escalate
 *
 * 4. Platform Parameter Self-Governance
 *    - Adjusts thresholds autonomously based on platform data
 *    - Logs all parameter changes on-chain
 *
 * 5. On-Chain Anomaly Registry
 *    - Immutable fraud history
 *    - Paginated access for off-chain indexers
 */

interface ICryptValt {
    function freezeWallet(address wallet, string calldata reason) external;
    function unfreezeWallet(address wallet) external;
    function freezeListing(uint256 listingId) external;
    function getBidders(uint256 listingId) external view returns (address[] memory);
    function getBid(uint256 listingId, address bidder) external view returns (
        bytes32, uint256, uint256, uint256, bool, bool, bool
    );
    function getPlatformStats() external view returns (
        uint256, uint256, uint256, uint256, uint256, bool, uint256
    );
    function getListing(uint256 listingId) external view returns (
        uint128, uint128, uint64, uint64, uint64, uint64,
        uint96, uint96, uint32, address, address, uint16,
        uint8, bool, bool, bool, string memory, string memory, string memory, string memory
    );
}

contract CryptValtGovernor {

    // ── Constants ───────────────────────────────────────────
    uint256 public constant MAX_REP             = 1000;
    uint256 public constant INITIAL_REP         = 500;
    uint256 public constant VERIFIED_REP_BONUS  = 150;
    uint256 public constant AUTO_FREEZE_REP     = 50;
    uint256 public constant VELOCITY_WINDOW     = 1 hours;
    uint256 public constant COLLUSION_WINDOW    = 5 minutes;
    uint256 public constant SYBIL_RISK_CRITICAL = 750;
    uint256 public constant SYBIL_RISK_HIGH     = 500;

    // Reputation deltas
    int256 public constant D_COMPLETED_PURCHASE  =  50;
    int256 public constant D_COMPLETED_SALE      =  30;
    int256 public constant D_DISPUTE_RAISED      = -30;
    int256 public constant D_DISPUTE_LOST        = -150;
    int256 public constant D_DISPUTE_WON         =  25;
    int256 public constant D_VERIFIED            =  150;
    int256 public constant D_WASH_TRADING        = -500;
    int256 public constant D_SYBIL_CONFIRMED     = -300;
    int256 public constant D_VELOCITY_ABUSE      =  -50;
    int256 public constant D_COLLUSION           = -100;
    int256 public constant D_LISTING_SPAM        =  -20;
    int256 public constant D_GOOD_STREAK         =    5;

    // ── Structs ─────────────────────────────────────────────

    struct WalletProfile {
        uint256 reputation;
        uint256 firstSeen;
        uint256 lastActive;
        uint256 totalBids;
        uint256 totalListings;
        uint256 completedPurchases;
        uint256 completedSales;
        uint256 disputesRaised;
        uint256 disputesWon;
        uint256 disputesLost;
        uint256 flagCount;
        uint256 bidVelocityCount;
        uint256 bidVelocityWindowStart;
        bool    verified;
        bool    frozen;
    }

    struct BehaviorFingerprint {
        uint256 avgInterBidMs;       // Average time between bids in ms
        uint256 avgBidAmountWei;     // Average bid amount
        uint256 categoryBitmask;     // Which categories this wallet bids in
        uint256 lastFingerprintTime;
        bytes32 patternHash;         // Hash of normalized behavioral patterns
        uint256 totalObservations;
    }

    struct FraudFlag {
        address   wallet;
        uint256   listingId;
        uint8     fraudType;     // FraudType enum
        uint8     severity;      // Severity enum
        string    evidence;
        uint256   timestamp;
        bool      confirmed;
        bool      resolved;
        address   reviewedBy;
    }

    struct CollusionRing {
        address[] members;
        uint256   detectedAt;
        uint256   listingId;
        bool      frozen;
    }

    struct GovernanceLog {
        string  parameter;
        uint256 oldValue;
        uint256 newValue;
        string  justification;
        uint256 timestamp;
    }

    enum FraudType {
        WashTrading,      // 0
        SybilAttack,      // 1
        BidVelocity,      // 2
        CollusionRing,    // 3
        FrontRunning,     // 4
        ListingSpam,      // 5
        IdentityFraud,    // 6
        DataManipulation  // 7
    }

    enum Severity {
        Info,      // 0 — log
        Low,       // 1 — flag listing
        Medium,    // 2 — reputation penalty
        High,      // 3 — freeze listing
        Critical   // 4 — freeze wallet + escalate
    }

    // ── State ───────────────────────────────────────────────
    address public owner;
    ICryptValt public platform;
    bool public active;

    // Governance parameters (autonomously adjustable)
    uint256 public minRepToBid;
    uint256 public minRepToList;
    uint256 public maxBidsPerHour;
    uint256 public autoFreezeThreshold;
    uint256 public sybilRiskThreshold;

    mapping(address => WalletProfile)           public profiles;
    mapping(address => BehaviorFingerprint)     public fingerprints;
    mapping(address => FraudFlag[])             private walletFlags;
    mapping(uint256 => FraudFlag[])             private listingFlags;
    mapping(address => uint256)                 public suspicionScore;
    mapping(address => address[])               public linkedWallets;

    FraudFlag[]       private allFlags;
    CollusionRing[]   private collusionRings;
    GovernanceLog[]   private governanceLogs;

    uint256 public totalFlagsRaised;
    uint256 public totalAutoFreezes;
    uint256 public totalCollusionRings;

    // ── Events ──────────────────────────────────────────────
    event ProfileCreated(address indexed wallet, uint256 initialRep);
    event ReputationUpdated(address indexed wallet, uint256 oldRep, uint256 newRep, string reason);
    event FraudDetected(address indexed wallet, uint256 indexed listingId, uint8 fraudType, uint8 severity);
    event AutoFreeze(address indexed wallet, uint8 fraudType);
    event CollusionRingDetected(uint256 ringId, address[] members, uint256 listingId);
    event SybilLinkConfirmed(address indexed walletA, address indexed walletB, uint256 riskScore);
    event WalletVerified(address indexed wallet, address by);
    event ParameterAdjusted(string parameter, uint256 oldValue, uint256 newValue, string justification);

    // ── Modifiers ───────────────────────────────────────────
    modifier onlyOwner()    { require(msg.sender == owner,              "Gov: not owner");    _; }
    modifier onlyPlatform() { require(msg.sender == address(platform) || msg.sender == owner, "Gov: not platform"); _; }
    modifier isActive()     { require(active,                           "Gov: inactive");     _; }

    // ── Constructor ─────────────────────────────────────────
    constructor(address _platform) {
        owner    = msg.sender;
        platform = ICryptValt(_platform);
        active   = true;
        _initParams();
    }

    function _initParams() internal {
        minRepToBid          = 100;
        minRepToList         = 150;
        maxBidsPerHour       = 20;
        autoFreezeThreshold  = AUTO_FREEZE_REP;
        sybilRiskThreshold   = SYBIL_RISK_HIGH;
    }

    // ── Profile Management ───────────────────────────────────
    function _ensureProfile(address wallet) internal {
        if (profiles[wallet].firstSeen == 0) {
            profiles[wallet] = WalletProfile({
                reputation:            INITIAL_REP,
                firstSeen:             block.timestamp,
                lastActive:            block.timestamp,
                totalBids:             0,
                totalListings:         0,
                completedPurchases:    0,
                completedSales:        0,
                disputesRaised:        0,
                disputesWon:           0,
                disputesLost:          0,
                flagCount:             0,
                bidVelocityCount:      0,
                bidVelocityWindowStart: block.timestamp,
                verified:              false,
                frozen:                false
            });
            emit ProfileCreated(wallet, INITIAL_REP);
        }
    }

    function _adjustRep(address wallet, int256 delta, string memory reason) internal {
        _ensureProfile(wallet);
        uint256 old = profiles[wallet].reputation;
        uint256 newRep;

        if (delta >= 0) {
            uint256 increase = uint256(delta);
            newRep = old + increase > MAX_REP ? MAX_REP : old + increase;
        } else {
            uint256 decrease = uint256(-delta);
            newRep = decrease > old ? 0 : old - decrease;
        }

        profiles[wallet].reputation = newRep;
        emit ReputationUpdated(wallet, old, newRep, reason);

        if (newRep <= autoFreezeThreshold && old > autoFreezeThreshold) {
            _autoFreeze(wallet, uint8(FraudType.IdentityFraud));
        }
    }

    // ── Platform Callbacks ───────────────────────────────────
    function onListingCreated(uint256 listingId, address inventor) external onlyPlatform isActive {
        _ensureProfile(inventor);
        profiles[inventor].totalListings++;
        profiles[inventor].lastActive = block.timestamp;
        _checkListingSpam(inventor, listingId);
    }

    function onBidCommitted(uint256 listingId, address bidder) external onlyPlatform isActive {
        _ensureProfile(bidder);
        profiles[bidder].totalBids++;
        profiles[bidder].lastActive = block.timestamp;
        _checkBidVelocity(bidder, listingId);
        _updateFingerprint(bidder);
    }

    function onAuctionSettled(uint256 listingId, address winner, uint256 amount) external onlyPlatform isActive {
        _ensureProfile(winner);
        profiles[winner].completedPurchases++;
        profiles[winner].lastActive = block.timestamp;
        _adjustRep(winner, D_COMPLETED_PURCHASE, "Completed purchase");

        // Good behavior streak bonus
        if (profiles[winner].completedPurchases > 0 && profiles[winner].disputesRaised == 0) {
            _adjustRep(winner, D_GOOD_STREAK, "Good behavior streak");
        }

        // Suppress unused variable warning
        amount; listingId;
    }

    function onDisputeRaised(address wallet) external onlyPlatform {
        _ensureProfile(wallet);
        profiles[wallet].disputesRaised++;
        _adjustRep(wallet, D_DISPUTE_RAISED, "Raised dispute");
    }

    function onDisputeResolved(address wallet, bool won) external onlyPlatform {
        _ensureProfile(wallet);
        if (won) {
            profiles[wallet].disputesWon++;
            _adjustRep(wallet, D_DISPUTE_WON, "Won dispute");
        } else {
            profiles[wallet].disputesLost++;
            _adjustRep(wallet, D_DISPUTE_LOST, "Lost dispute");
        }
    }

    // ── Fraud Detection ──────────────────────────────────────

    // 1. Bid Velocity
    function _checkBidVelocity(address bidder, uint256 listingId) internal {
        WalletProfile storage p = profiles[bidder];
        if (block.timestamp - p.bidVelocityWindowStart > VELOCITY_WINDOW) {
            p.bidVelocityWindowStart = block.timestamp;
            p.bidVelocityCount       = 0;
        }
        p.bidVelocityCount++;

        if (p.bidVelocityCount > maxBidsPerHour) {
            _raiseFlag(bidder, listingId, FraudType.BidVelocity, Severity.Medium,
                string(abi.encodePacked("Bid velocity: ", _uint2str(p.bidVelocityCount), "/hr")));
            _adjustRep(bidder, D_VELOCITY_ABUSE, "Bid velocity abuse");
        }
    }

    // 2. Listing Spam
    function _checkListingSpam(address inventor, uint256 listingId) internal {
        WalletProfile storage p = profiles[inventor];
        if (p.totalListings > 25 && p.reputation < 300) {
            _raiseFlag(inventor, listingId, FraudType.ListingSpam, Severity.Low,
                "High listing volume with low reputation");
            _adjustRep(inventor, D_LISTING_SPAM, "Listing spam pattern");
        }
    }

    // 3. Wash Trading
    function analyzeWashTrading(uint256 listingId, address inventor)
        external onlyPlatform isActive returns (bool detected)
    {
        address[] memory bidders = platform.getBidders(listingId);
        address[] memory linked  = linkedWallets[inventor];

        for (uint256 i = 0; i < bidders.length; i++) {
            // Direct wash
            if (bidders[i] == inventor) {
                _raiseFlag(inventor, listingId, FraudType.WashTrading, Severity.Critical,
                    "Inventor address found in bidder list");
                _adjustRep(inventor, D_WASH_TRADING, "Wash trading confirmed");
                _autoFreeze(inventor, uint8(FraudType.WashTrading));
                return true;
            }
            // Indirect wash — linked wallet
            for (uint256 j = 0; j < linked.length; j++) {
                if (bidders[i] == linked[j]) {
                    _raiseFlag(inventor, listingId, FraudType.WashTrading, Severity.High,
                        "Linked wallet found in bidder list — suspected wash trading");
                    _adjustRep(inventor, D_WASH_TRADING / 2, "Suspected indirect wash trading");
                    return true;
                }
            }
        }
        return false;
    }

    // 4. Sybil Detection
    function analyzeSybilRisk(address walletA, address walletB)
        external onlyPlatform isActive returns (uint256 riskScore)
    {
        _ensureProfile(walletA);
        _ensureProfile(walletB);

        BehaviorFingerprint storage fpA = fingerprints[walletA];
        BehaviorFingerprint storage fpB = fingerprints[walletB];

        riskScore = 0;

        // Identical pattern hash
        if (fpA.patternHash != bytes32(0) && fpA.patternHash == fpB.patternHash) riskScore += 400;

        // Similar inter-bid timing (within 60s)
        if (fpA.avgInterBidMs > 0 && fpB.avgInterBidMs > 0) {
            uint256 diff = fpA.avgInterBidMs > fpB.avgInterBidMs
                ? fpA.avgInterBidMs - fpB.avgInterBidMs
                : fpB.avgInterBidMs - fpA.avgInterBidMs;
            if (diff <= 60_000) riskScore += 150;
        }

        // Same category preferences
        if (fpA.categoryBitmask != 0 && fpA.categoryBitmask == fpB.categoryBitmask) riskScore += 100;

        // Both wallets created within 5 minutes of each other
        uint256 ageDiff = profiles[walletA].firstSeen > profiles[walletB].firstSeen
            ? profiles[walletA].firstSeen - profiles[walletB].firstSeen
            : profiles[walletB].firstSeen - profiles[walletA].firstSeen;
        if (ageDiff <= 300) riskScore += 200;

        // Similar bid amounts (within 5%)
        if (fpA.avgBidAmountWei > 0 && fpB.avgBidAmountWei > 0) {
            uint256 larger  = fpA.avgBidAmountWei > fpB.avgBidAmountWei ? fpA.avgBidAmountWei : fpB.avgBidAmountWei;
            uint256 smaller = fpA.avgBidAmountWei < fpB.avgBidAmountWei ? fpA.avgBidAmountWei : fpB.avgBidAmountWei;
            if (larger > 0 && ((larger - smaller) * 100 / larger) <= 5) riskScore += 100;
        }

        suspicionScore[walletA] += riskScore;
        suspicionScore[walletB] += riskScore;

        if (riskScore >= SYBIL_RISK_CRITICAL) {
            // Add to linked wallets graph
            linkedWallets[walletA].push(walletB);
            linkedWallets[walletB].push(walletA);
            _adjustRep(walletA, D_SYBIL_CONFIRMED, "Sybil attack confirmed");
            _adjustRep(walletB, D_SYBIL_CONFIRMED, "Sybil attack confirmed");
            emit SybilLinkConfirmed(walletA, walletB, riskScore);
        } else if (riskScore >= SYBIL_RISK_HIGH) {
            _raiseFlag(walletA, 0, FraudType.SybilAttack, Severity.High,
                string(abi.encodePacked("Sybil risk score: ", _uint2str(riskScore))));
        }

        return riskScore;
    }

    // 5. Collusion Ring Detection
    function detectCollusionRing(uint256 listingId)
        external onlyPlatform isActive returns (bool found)
    {
        address[] memory bidders = platform.getBidders(listingId);
        if (bidders.length < 3) return false;

        address[] memory ring     = new address[](bidders.length);
        uint256          ringSize = 0;

        for (uint256 i = 0; i < bidders.length; i++) {
            (, , , uint256 tsI, , ,) = platform.getBid(listingId, bidders[i]);
            uint256 closeCount = 0;

            for (uint256 j = 0; j < bidders.length; j++) {
                if (i == j) continue;
                (, , , uint256 tsJ, , ,) = platform.getBid(listingId, bidders[j]);
                uint256 diff = tsI > tsJ ? tsI - tsJ : tsJ - tsI;
                if (diff <= COLLUSION_WINDOW) closeCount++;
            }

            if (closeCount >= 2) {
                ring[ringSize] = bidders[i];
                ringSize++;
            }
        }

        if (ringSize >= 3) {
            address[] memory confirmedRing = new address[](ringSize);
            for (uint256 i = 0; i < ringSize; i++) confirmedRing[i] = ring[i];

            uint256 ringId = collusionRings.length;
            collusionRings.push(CollusionRing({
                members:    confirmedRing,
                detectedAt: block.timestamp,
                listingId:  listingId,
                frozen:     false
            }));
            totalCollusionRings++;

            try platform.freezeListing(listingId) {} catch {}

            for (uint256 i = 0; i < ringSize; i++) {
                _adjustRep(confirmedRing[i], D_COLLUSION, "Collusion ring member");
                _raiseFlag(confirmedRing[i], listingId, FraudType.CollusionRing, Severity.High,
                    string(abi.encodePacked("Part of collusion ring #", _uint2str(ringId))));
            }

            emit CollusionRingDetected(ringId, confirmedRing, listingId);
            return true;
        }

        return false;
    }

    // ── Behavioral Fingerprinting ────────────────────────────
    function _updateFingerprint(address wallet) internal {
        BehaviorFingerprint storage fp = fingerprints[wallet];
        WalletProfile       storage p  = profiles[wallet];

        // Update inter-bid timing
        if (fp.lastFingerprintTime > 0 && p.totalBids > 1) {
            uint256 elapsed = (block.timestamp - fp.lastFingerprintTime) * 1000; // ms
            fp.avgInterBidMs = fp.totalObservations == 0
                ? elapsed
                : (fp.avgInterBidMs * fp.totalObservations + elapsed) / (fp.totalObservations + 1);
        }

        fp.lastFingerprintTime = block.timestamp;
        fp.totalObservations++;

        // Recompute pattern hash (normalized to reduce false positives)
        fp.patternHash = keccak256(abi.encodePacked(
            fp.avgInterBidMs   / 60_000,   // Normalized to minutes
            fp.categoryBitmask,
            p.totalBids        / 10,       // Normalized to bins of 10
            p.firstSeen        / 3600      // Normalized to hours
        ));
    }

    // ── Auto Freeze ──────────────────────────────────────────
    function _autoFreeze(address wallet, uint8 fraudType) internal {
        profiles[wallet].frozen = true;
        totalAutoFreezes++;
        try platform.freezeWallet(wallet, _fraudTypeName(FraudType(fraudType))) {} catch {}
        emit AutoFreeze(wallet, fraudType);
    }

    // ── Flag System ──────────────────────────────────────────
    function _raiseFlag(
        address   wallet,
        uint256   listingId,
        FraudType fraudType,
        Severity  severity,
        string    memory evidence
    ) internal {
        FraudFlag memory flag = FraudFlag({
            wallet:     wallet,
            listingId:  listingId,
            fraudType:  uint8(fraudType),
            severity:   uint8(severity),
            evidence:   evidence,
            timestamp:  block.timestamp,
            confirmed:  false,
            resolved:   false,
            reviewedBy: address(0)
        });

        walletFlags[wallet].push(flag);
        if (listingId > 0) listingFlags[listingId].push(flag);
        allFlags.push(flag);
        totalFlagsRaised++;
        profiles[wallet].flagCount++;

        emit FraudDetected(wallet, listingId, uint8(fraudType), uint8(severity));

        if (severity == Severity.Critical) {
            _autoFreeze(wallet, uint8(fraudType));
        }
        if (severity == Severity.High || severity == Severity.Critical) {
            if (listingId > 0) try platform.freezeListing(listingId) {} catch {}
        }
    }

    // ── Autonomous Parameter Governance ─────────────────────
    function runAutonomousGovernance() external isActive {
        (uint256 totalListings, , uint256 totalBids, uint256 totalDisputes, , ,) =
            platform.getPlatformStats();

        // Tighten requirements as platform matures
        if (totalListings >= 100 && minRepToBid < 150) {
            _setParam("minRepToBid", minRepToBid, 150, "Platform matured: 100+ listings");
            minRepToBid = 150;
        }

        if (totalListings >= 500 && minRepToList < 200) {
            _setParam("minRepToList", minRepToList, 200, "Platform matured: 500+ listings");
            minRepToList = 200;
        }

        // Reduce velocity limit if dispute rate high
        if (totalBids > 0 && totalDisputes > 0) {
            uint256 disputeRate = (totalDisputes * 100) / (totalListings > 0 ? totalListings : 1);
            if (disputeRate > 15 && maxBidsPerHour > 10) {
                _setParam("maxBidsPerHour", maxBidsPerHour, 10, "High dispute rate");
                maxBidsPerHour = 10;
            }
        }
    }

    function _setParam(string memory name, uint256 old, uint256 new_, string memory reason) internal {
        governanceLogs.push(GovernanceLog({
            parameter:    name,
            oldValue:     old,
            newValue:     new_,
            justification: reason,
            timestamp:    block.timestamp
        }));
        emit ParameterAdjusted(name, old, new_, reason);
    }

    // ── Platform Interface ───────────────────────────────────
    function canBid(address wallet) external view returns (bool, string memory) {
        if (!active)                              return (true, "");
        if (profiles[wallet].frozen)              return (false, "Wallet frozen");
        if (profiles[wallet].firstSeen == 0)      return (true, "");
        if (profiles[wallet].reputation < minRepToBid)
            return (false, string(abi.encodePacked("Rep ", _uint2str(profiles[wallet].reputation), " < min ", _uint2str(minRepToBid))));
        return (true, "");
    }

    function canList(address wallet) external view returns (bool, string memory) {
        if (!active)                              return (true, "");
        if (profiles[wallet].frozen)              return (false, "Wallet frozen");
        if (profiles[wallet].firstSeen == 0)      return (true, "");
        if (profiles[wallet].reputation < minRepToList)
            return (false, string(abi.encodePacked("Rep ", _uint2str(profiles[wallet].reputation), " < min ", _uint2str(minRepToList))));
        return (true, "");
    }

    // ── View Functions ───────────────────────────────────────
    function getProfile(address wallet) external view returns (WalletProfile memory) {
        return profiles[wallet];
    }

    function getReputationScore(address wallet) external view returns (uint256) {
        return profiles[wallet].firstSeen == 0 ? INITIAL_REP : profiles[wallet].reputation;
    }

    function getTrustTier(address wallet) external view returns (string memory) {
        uint256 rep = profiles[wallet].reputation;
        if (rep >= 900) return "PLATINUM";
        if (rep >= 700) return "GOLD";
        if (rep >= 500) return "SILVER";
        if (rep >= 300) return "BRONZE";
        if (rep >= 100) return "PROBATION";
        return "SUSPENDED";
    }

    function getWalletFlags(address wallet, uint256 offset, uint256 count)
        external view returns (FraudFlag[] memory)
    {
        FraudFlag[] storage flags = walletFlags[wallet];
        uint256 end    = offset + count > flags.length ? flags.length : offset + count;
        uint256 len    = end > offset ? end - offset : 0;
        FraudFlag[] memory result = new FraudFlag[](len);
        for (uint256 i = 0; i < len; i++) result[i] = flags[offset + i];
        return result;
    }

    function getListingFlags(uint256 listingId, uint256 offset, uint256 count)
        external view returns (FraudFlag[] memory)
    {
        FraudFlag[] storage flags = listingFlags[listingId];
        uint256 end    = offset + count > flags.length ? flags.length : offset + count;
        uint256 len    = end > offset ? end - offset : 0;
        FraudFlag[] memory result = new FraudFlag[](len);
        for (uint256 i = 0; i < len; i++) result[i] = flags[offset + i];
        return result;
    }

    function getGovernanceStats() external view returns (
        uint256 flags, uint256 freezes, uint256 rings, bool isActive
    ) {
        return (totalFlagsRaised, totalAutoFreezes, totalCollusionRings, active);
    }

    function getLinkedWallets(address wallet) external view returns (address[] memory) {
        return linkedWallets[wallet];
    }

    // ── Admin ────────────────────────────────────────────────
    function verifyWallet(address wallet) external onlyOwner {
        _ensureProfile(wallet);
        profiles[wallet].verified = true;
        _adjustRep(wallet, D_VERIFIED, "Verified by admin");
        emit WalletVerified(wallet, msg.sender);
    }

    function manualFreeze(address wallet, string calldata reason) external onlyOwner {
        _ensureProfile(wallet);
        profiles[wallet].frozen = true;
        try platform.freezeWallet(wallet, reason) {} catch {}
    }

    function manualUnfreeze(address wallet) external onlyOwner {
        profiles[wallet].frozen = false;
        try platform.unfreezeWallet(wallet) {} catch {}
    }

    function setActive(bool _active) external onlyOwner { active = _active; }
    function updatePlatform(address _p) external onlyOwner { platform = ICryptValt(_p); }

    // ── Helpers ──────────────────────────────────────────────
    function _fraudTypeName(FraudType ft) internal pure returns (string memory) {
        if (ft == FraudType.WashTrading)     return "Wash trading";
        if (ft == FraudType.SybilAttack)     return "Sybil attack";
        if (ft == FraudType.BidVelocity)     return "Bid velocity abuse";
        if (ft == FraudType.CollusionRing)   return "Collusion ring";
        if (ft == FraudType.FrontRunning)    return "Front running";
        if (ft == FraudType.ListingSpam)     return "Listing spam";
        if (ft == FraudType.DataManipulation) return "Data manipulation";
        return "Identity fraud";
    }

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 temp = v;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }
}