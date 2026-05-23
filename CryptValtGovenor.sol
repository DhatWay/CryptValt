// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ============================================================
 * CryptValt Governing Algorithm v2.0
 * Autonomous Platform Intelligence & Fraud Detection
 * ============================================================
 *
 * This contract is the autonomous brain of CryptValt.
 * It operates independently, making real-time decisions
 * without human intervention.
 *
 * Core Systems:
 * 1. Dynamic Wallet Reputation Engine (0-1000 point scale)
 * 2. Multi-vector Fraud Detection
 *    - Sybil attack detection via behavioral fingerprinting
 *    - Wash trading detection via graph analysis
 *    - Bid sniping pattern recognition
 *    - Velocity abuse detection
 *    - Collusion ring detection
 * 3. Autonomous Response System (graduated severity)
 * 4. Platform Parameter Self-Governance
 * 5. On-chain Anomaly Registry
 * 6. Reputation-Weighted Trust Scores
 */

interface ICryptValt {
    function freezeWallet(address wallet, string calldata reason) external;
    function unfreezeWallet(address wallet) external;
    function freezeListing(uint256 listingId) external;
    function getBidders(uint256 listingId) external view returns (address[] memory);
    function getBid(uint256 listingId, address bidder) external view
        returns (
            bytes32 commitment,
            uint256 revealedAmount,
            uint256 depositAmount,
            uint256 timestamp,
            bool revealed,
            bool refunded,
            bool isWinner
        );
    function getPlatformStats() external view returns (
        uint256 totalListings,
        uint256 totalVolume,
        uint256 totalBids,
        uint256 totalDisputes,
        bool paused
    );
}

contract CryptValtGovernor {

    // ============================================================
    // CONSTANTS
    // ============================================================
    uint256 public constant MAX_REPUTATION          = 1000;
    uint256 public constant INITIAL_REPUTATION      = 500;
    uint256 public constant MIN_REPUTATION_TO_BID   = 100;
    uint256 public constant MIN_REPUTATION_TO_LIST  = 150;
    uint256 public constant AUTO_FREEZE_THRESHOLD   = 50;
    uint256 public constant VELOCITY_WINDOW         = 1 hours;
    uint256 public constant MAX_BIDS_PER_HOUR       = 15;
    uint256 public constant COLLUSION_TIME_WINDOW   = 5 minutes;
    uint256 public constant SYBIL_PATTERN_THRESHOLD = 3;

    // Reputation deltas
    int256 public constant REP_COMPLETED_PURCHASE   = int256(50);
    int256 public constant REP_SUCCESSFUL_LISTING   = int256(30);
    int256 public constant REP_DISPUTE_RAISED       = int256(-30);
    int256 public constant REP_DISPUTE_LOST         = int256(-100);
    int256 public constant REP_DISPUTE_WON          = int256(20);
    int256 public constant REP_VERIFIED             = int256(150);
    int256 public constant REP_WASH_TRADING         = int256(-500);
    int256 public constant REP_SYBIL_CONFIRMED      = int256(-300);
    int256 public constant REP_VELOCITY_ABUSE       = int256(-50);
    int256 public constant REP_SNIPE_PATTERN        = int256(-20);
    int256 public constant REP_GOOD_BEHAVIOR        = int256(5);

    // ============================================================
    // STRUCTS
    // ============================================================

    struct WalletProfile {
        uint256 reputation;           // 0-1000
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
        uint256 bidVelocityCount;     // Bids in last VELOCITY_WINDOW
        uint256 bidVelocityWindow;    // Window start timestamp
        bool    verified;
        bool    frozen;
        address[] linkedWallets;      // Suspected sybil links
    }

    struct FraudFlag {
        address  wallet;
        uint256  listingId;
        FraudType fraudType;
        Severity severity;
        string   evidence;
        uint256  timestamp;
        bool     confirmed;
        bool     resolved;
        address  reviewedBy;
    }

    struct BehaviorFingerprint {
        uint256 avgBidTiming;         // Average time between bids
        uint256 avgBidAmount;         // Average bid size
        uint256 preferredCategories;  // Bitmask
        uint256 txNonce;              // Tracks on-chain nonce patterns
        bytes32 patternHash;          // Hash of behavioral patterns
    }

    struct CollusionGraph {
        address[] members;
        uint256   detectedAt;
        bool      frozen;
    }

    struct GovernanceProposal {
        string   parameter;
        uint256  currentValue;
        uint256  proposedValue;
        string   justification;
        uint256  proposedAt;
        bool     executed;
    }

    enum FraudType {
        WashTrading,        // 0
        SybilAttack,        // 1
        BidManipulation,    // 2
        VelocityAbuse,      // 3
        CollusionRing,      // 4
        FrontRunning,       // 5
        SpamListing,        // 6
        IdentityFraud       // 7
    }

    enum Severity {
        Info,       // 0 — Log only
        Low,        // 1 — Monitor
        Medium,     // 2 — Flag listing
        High,       // 3 — Freeze listing
        Critical    // 4 — Freeze wallet + escalate
    }

    // ============================================================
    // STATE
    // ============================================================
    address public owner;
    ICryptValt public platform;
    bool public active;

    mapping(address => WalletProfile)           public profiles;
    mapping(address => BehaviorFingerprint)     public fingerprints;
    mapping(address => FraudFlag[])             public walletFlags;
    mapping(uint256 => FraudFlag[])             public listingFlags;
    mapping(uint256 => CollusionGraph)          public collusionGraphs;
    mapping(bytes32 => bool)                    public knownPatterns;
    mapping(address => uint256)                 public suspicionScore;
    mapping(uint256 => GovernanceProposal[])    public proposalHistory;

    FraudFlag[]   public allFlags;
    uint256       public totalFlagsRaised;
    uint256       public totalAutoFreezes;
    uint256       public totalCollusionRingsDetected;

    // Autonomous parameter registry
    mapping(bytes32 => uint256) public parameters;

    // ============================================================
    // EVENTS
    // ============================================================
    event WalletProfileCreated(address indexed wallet, uint256 initialReputation);
    event ReputationChanged(address indexed wallet, uint256 oldRep, uint256 newRep, string reason);
    event FraudDetected(address indexed wallet, uint256 indexed listingId, FraudType fraudType, Severity severity);
    event AutoFreeze(address indexed wallet, FraudType reason, uint256 evidence);
    event CollusionRingDetected(uint256 ringId, address[] members);
    event SybilLinkDetected(address indexed walletA, address indexed walletB, string evidence);
    event ParameterProposed(string parameter, uint256 currentValue, uint256 proposedValue, string justification);
    event ParameterExecuted(string parameter, uint256 oldValue, uint256 newValue);
    event GoodBehaviorRewarded(address indexed wallet, uint256 streak);
    event WalletVerified(address indexed wallet, address by);

    // ============================================================
    // MODIFIERS
    // ============================================================
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPlatform() {
        require(msg.sender == address(platform) || msg.sender == owner, "Not platform");
        _;
    }

    modifier governorActive() {
        require(active, "Governor inactive");
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================
    constructor(address _platform) {
        owner    = msg.sender;
        platform = ICryptValt(_platform);
        active   = true;
        _initParameters();
    }

    function _initParameters() internal {
        parameters[keccak256("minReputationBid")]    = MIN_REPUTATION_TO_BID;
        parameters[keccak256("minReputationList")]   = MIN_REPUTATION_TO_LIST;
        parameters[keccak256("autoFreezeThreshold")] = AUTO_FREEZE_THRESHOLD;
        parameters[keccak256("maxBidsPerHour")]      = MAX_BIDS_PER_HOUR;
    }

    // ============================================================
    // WALLET PROFILE MANAGEMENT
    // ============================================================
    function _ensureProfile(address wallet) internal {
        if (profiles[wallet].firstSeen == 0) {
            profiles[wallet].reputation = INITIAL_REPUTATION;
            profiles[wallet].firstSeen  = block.timestamp;
            profiles[wallet].lastActive = block.timestamp;
            emit WalletProfileCreated(wallet, INITIAL_REPUTATION);
        }
    }

    function _adjustReputation(address wallet, int256 delta, string memory reason) internal {
        _ensureProfile(wallet);
        uint256 old = profiles[wallet].reputation;
        if (delta > 0) {
            uint256 increase = uint256(delta);
            profiles[wallet].reputation = old + increase > MAX_REPUTATION
                ? MAX_REPUTATION
                : old + increase;
        } else {
            uint256 decrease = uint256(-delta);
            profiles[wallet].reputation = decrease > old ? 0 : old - decrease;
        }
        emit ReputationChanged(wallet, old, profiles[wallet].reputation, reason);

        // Auto-freeze on critically low reputation
        if (profiles[wallet].reputation <= AUTO_FREEZE_THRESHOLD) {
            _triggerAutoFreeze(wallet, FraudType.IdentityFraud, profiles[wallet].reputation);
        }
    }

    // ============================================================
    // PLATFORM CALLBACKS — Called by CryptValt on events
    // ============================================================
    function onListingCreated(uint256 listingId, address inventor)
        external onlyPlatform governorActive {
        _ensureProfile(inventor);
        profiles[inventor].totalListings++;
        profiles[inventor].lastActive = block.timestamp;
        _checkListingSpam(inventor, listingId);
    }

    function onBidCommitted(uint256 listingId, address bidder)
        external onlyPlatform governorActive {
        _ensureProfile(bidder);
        profiles[bidder].totalBids++;
        profiles[bidder].lastActive = block.timestamp;
        _checkBidVelocity(bidder, listingId);
        _updateBehaviorFingerprint(bidder);
    }

    function onAuctionSettled(uint256 listingId, address winner, uint256 amount)
        external onlyPlatform governorActive {
        _ensureProfile(winner);
        profiles[winner].completedPurchases++;
        _adjustReputation(winner, REP_COMPLETED_PURCHASE, "Completed purchase");
        _runPostSettlementAnalysis(listingId, winner, amount);
    }

    function onDisputeRaised(address wallet) external onlyPlatform {
        _adjustReputation(wallet, REP_DISPUTE_RAISED, "Dispute raised");
        profiles[wallet].disputesRaised++;
    }

    function onDisputeResolved(address wallet, bool won) external onlyPlatform {
        if (won) {
            _adjustReputation(wallet, REP_DISPUTE_WON, "Won dispute");
            profiles[wallet].disputesWon++;
        } else {
            _adjustReputation(wallet, REP_DISPUTE_LOST, "Lost dispute");
            profiles[wallet].disputesLost++;
        }
    }

    function onSaleCompleted(address inventor) external onlyPlatform {
        _adjustReputation(inventor, REP_SUCCESSFUL_LISTING, "Successful sale");
        profiles[inventor].completedSales++;
    }

    // ============================================================
    // FRAUD DETECTION ENGINE
    // ============================================================

    // 1. BID VELOCITY ABUSE
    function _checkBidVelocity(address bidder, uint256 listingId) internal {
        WalletProfile storage p = profiles[bidder];
        uint256 now_ = block.timestamp;

        // Reset velocity window if expired
        if (now_ - p.bidVelocityWindow > VELOCITY_WINDOW) {
            p.bidVelocityWindow = now_;
            p.bidVelocityCount  = 0;
        }

        p.bidVelocityCount++;

        if (p.bidVelocityCount > parameters[keccak256("maxBidsPerHour")]) {
            _raiseFraudFlag(
                bidder,
                listingId,
                FraudType.VelocityAbuse,
                Severity.Medium,
                "Bid velocity exceeds maximum threshold"
            );
            _adjustReputation(bidder, REP_VELOCITY_ABUSE, "Velocity abuse");
        }
    }

    // 2. LISTING SPAM DETECTION
    function _checkListingSpam(address inventor, uint256 listingId) internal {
        WalletProfile storage p = profiles[inventor];
        if (p.totalListings > 20 && p.reputation < 300) {
            _raiseFraudFlag(
                inventor,
                listingId,
                FraudType.SpamListing,
                Severity.Low,
                "High listing count with low reputation"
            );
        }
    }

    // 3. WASH TRADING DETECTION
    // Detects when inventor is effectively bidding on their own listing
    function analyzeForWashTrading(uint256 listingId, address inventor)
        external onlyPlatform governorActive returns (bool detected) {

        address[] memory bidders = platform.getBidders(listingId);

        for (uint256 i = 0; i < bidders.length; i++) {
            // Direct wash — inventor IS a bidder
            if (bidders[i] == inventor) {
                _raiseFraudFlag(
                    inventor,
                    listingId,
                    FraudType.WashTrading,
                    Severity.Critical,
                    "Inventor address found in bidder list"
                );
                _adjustReputation(inventor, REP_WASH_TRADING, "Wash trading confirmed");
                _triggerAutoFreeze(inventor, FraudType.WashTrading, listingId);
                return true;
            }

            // Indirect wash — linked wallet bidding
            address[] memory linked = profiles[inventor].linkedWallets;
            for (uint256 j = 0; j < linked.length; j++) {
                if (bidders[i] == linked[j]) {
                    _raiseFraudFlag(
                        inventor,
                        listingId,
                        FraudType.WashTrading,
                        Severity.High,
                        "Linked wallet found in bidder list"
                    );
                    _adjustReputation(inventor, REP_WASH_TRADING / 2, "Suspected wash trading via linked wallet");
                    return true;
                }
            }
        }
        return false;
    }

    // 4. SYBIL DETECTION via behavioral fingerprinting
    function analyzeSybilRisk(address walletA, address walletB)
        external onlyPlatform governorActive returns (uint256 riskScore) {

        _ensureProfile(walletA);
        _ensureProfile(walletB);

        BehaviorFingerprint storage fpA = fingerprints[walletA];
        BehaviorFingerprint storage fpB = fingerprints[walletB];

        riskScore = 0;

        // Identical pattern hashes — very strong signal
        if (fpA.patternHash == fpB.patternHash && fpA.patternHash != bytes32(0)) {
            riskScore += 400;
        }

        // Same bid timing patterns
        if (_withinRange(fpA.avgBidTiming, fpB.avgBidTiming, 60)) {
            riskScore += 150;
        }

        // Similar bid amounts
        if (_withinRange(fpA.avgBidAmount, fpB.avgBidAmount, fpA.avgBidAmount / 10)) {
            riskScore += 100;
        }

        // Same preferred categories
        if (fpA.preferredCategories != 0 && fpA.preferredCategories == fpB.preferredCategories) {
            riskScore += 100;
        }

        // Both created around same time
        if (_withinRange(profiles[walletA].firstSeen, profiles[walletB].firstSeen, 300)) {
            riskScore += 150;
        }

        if (riskScore >= 600) {
            // High confidence sybil link
            profiles[walletA].linkedWallets.push(walletB);
            profiles[walletB].linkedWallets.push(walletA);
            suspicionScore[walletA] += riskScore;
            suspicionScore[walletB] += riskScore;

            emit SybilLinkDetected(walletA, walletB, "Behavioral fingerprint match");

            if (riskScore >= 800) {
                _adjustReputation(walletA, REP_SYBIL_CONFIRMED, "Sybil attack confirmed");
                _adjustReputation(walletB, REP_SYBIL_CONFIRMED, "Sybil attack confirmed");
            }
        }

        return riskScore;
    }

    // 5. COLLUSION RING DETECTION
    function detectCollusionRing(uint256 listingId)
        external onlyPlatform governorActive returns (bool found) {

        address[] memory bidders = platform.getBidders(listingId);
        if (bidders.length < 3) return false;

        // Check if multiple bidders all bid within COLLUSION_TIME_WINDOW of each other
        uint256 clusterCount = 0;
        address[] memory clusterMembers = new address[](bidders.length);

        for (uint256 i = 0; i < bidders.length; i++) {
            (,,,uint256 tsI,,, ) = platform.getBid(listingId, bidders[i]);

            uint256 closeCount = 0;
            for (uint256 j = 0; j < bidders.length; j++) {
                if (i == j) continue;
                (,,,uint256 tsJ,,,) = platform.getBid(listingId, bidders[j]);
                if (_withinRange(tsI, tsJ, COLLUSION_TIME_WINDOW)) {
                    closeCount++;
                }
            }

            if (closeCount >= 2) {
                clusterMembers[clusterCount] = bidders[i];
                clusterCount++;
            }
        }

        if (clusterCount >= 3) {
            address[] memory ring = new address[](clusterCount);
            for (uint256 i = 0; i < clusterCount; i++) {
                ring[i] = clusterMembers[i];
            }

            uint256 ringId = totalCollusionRingsDetected;
            collusionGraphs[ringId] = CollusionGraph({
                members:     ring,
                detectedAt:  block.timestamp,
                frozen:      false
            });
            totalCollusionRingsDetected++;

            // Flag listing
            platform.freezeListing(listingId);

            // Reduce reputation of all ring members
            for (uint256 i = 0; i < ring.length; i++) {
                _adjustReputation(ring[i], -100, "Collusion ring member");
                _raiseFraudFlag(ring[i], listingId, FraudType.CollusionRing, Severity.High,
                    "Part of detected collusion ring");
            }

            emit CollusionRingDetected(ringId, ring);
            return true;
        }

        return false;
    }

    // 6. POST-SETTLEMENT ANALYSIS
    function _runPostSettlementAnalysis(
        uint256 listingId,
        address winner,
        uint256 amount
    ) internal {
        WalletProfile storage wp = profiles[winner];

        // Reward good behavior streak
        if (wp.completedPurchases > 0 && wp.disputesRaised == 0) {
            _adjustReputation(winner, REP_GOOD_BEHAVIOR, "Good behavior streak");
            emit GoodBehaviorRewarded(winner, wp.completedPurchases);
        }

        // Flag abnormally high sale vs reserve (potential collusion / price manipulation)
        // This would need listing data passed in — simplified here
        _ = amount; // Used in extended version with listing data
    }

    // ============================================================
    // BEHAVIOR FINGERPRINTING
    // ============================================================
    function _updateBehaviorFingerprint(address wallet) internal {
        BehaviorFingerprint storage fp = fingerprints[wallet];
        WalletProfile storage p        = profiles[wallet];

        // Update average bid timing
        if (p.lastActive > 0 && p.totalBids > 1) {
            uint256 timeSinceLast = block.timestamp - p.lastActive;
            fp.avgBidTiming = (fp.avgBidTiming.mul(p.totalBids - 1).add(timeSinceLast)) / p.totalBids;
        }

        // Recompute pattern hash
        fp.patternHash = keccak256(abi.encodePacked(
            fp.avgBidTiming / 60,  // Normalized to minutes
            fp.preferredCategories,
            p.totalBids / 5,       // Normalized
            wallet
        ));
    }

    // ============================================================
    // AUTO FREEZE
    // ============================================================
    function _triggerAutoFreeze(address wallet, FraudType reason, uint256 evidence) internal {
        profiles[wallet].frozen = true;
        totalAutoFreezes++;

        try platform.freezeWallet(wallet, _fraudTypeString(reason)) {
            emit AutoFreeze(wallet, reason, evidence);
        } catch {
            // Platform freeze failed — log locally
            emit AutoFreeze(wallet, reason, evidence);
        }
    }

    // ============================================================
    // FLAG SYSTEM
    // ============================================================
    function _raiseFraudFlag(
        address  wallet,
        uint256  listingId,
        FraudType fraudType,
        Severity severity,
        string   memory evidence
    ) internal {
        FraudFlag memory flag = FraudFlag({
            wallet:     wallet,
            listingId:  listingId,
            fraudType:  fraudType,
            severity:   severity,
            evidence:   evidence,
            timestamp:  block.timestamp,
            confirmed:  false,
            resolved:   false,
            reviewedBy: address(0)
        });

        walletFlags[wallet].push(flag);
        listingFlags[listingId].push(flag);
        allFlags.push(flag);
        totalFlagsRaised++;
        profiles[wallet].flagCount++;

        emit FraudDetected(wallet, listingId, fraudType, severity);

        // Auto-freeze on critical severity
        if (severity == Severity.Critical) {
            _triggerAutoFreeze(wallet, fraudType, listingId);
        }

        // Freeze listing on high severity
        if (severity == Severity.High || severity == Severity.Critical) {
            try platform.freezeListing(listingId) {} catch {}
        }
    }

    // ============================================================
    // AUTONOMOUS PARAMETER GOVERNANCE
    // ============================================================
    function runAutonomousGovernance() external governorActive {
        (uint256 totalListings, uint256 totalVolume,, uint256 totalDisputes,) =
            platform.getPlatformStats();

        // Tighten minimum reputation as platform matures
        if (totalListings >= 100) {
            _proposeParameterChange(
                "minReputationBid",
                parameters[keccak256("minReputationBid")],
                150,
                "Platform maturity: tightening bid requirements"
            );
        }

        // Reduce velocity limit if dispute rate is high
        if (totalDisputes > 0 && totalListings > 0) {
            uint256 disputeRate = (totalDisputes * 100) / totalListings;
            if (disputeRate > 10) {
                _proposeParameterChange(
                    "maxBidsPerHour",
                    parameters[keccak256("maxBidsPerHour")],
                    10,
                    "High dispute rate: reducing bid velocity limit"
                );
            }
        }

        // Increase min reputation on high volume to attract quality participants
        if (totalVolume > 100 ether) {
            _proposeParameterChange(
                "minReputationList",
                parameters[keccak256("minReputationList")],
                200,
                "High volume platform: raising listing bar"
            );
        }
    }

    function _proposeParameterChange(
        string  memory parameter,
        uint256 current,
        uint256 proposed,
        string  memory justification
    ) internal {
        bytes32 key = keccak256(bytes(parameter));
        if (parameters[key] != proposed) {
            proposalHistory[block.number].push(GovernanceProposal({
                parameter:    parameter,
                currentValue: current,
                proposedValue: proposed,
                justification: justification,
                proposedAt:   block.timestamp,
                executed:     false
            }));

            // Auto-execute within safe bounds
            if (proposed >= 50 && proposed <= 500) {
                parameters[key] = proposed;
                emit ParameterExecuted(parameter, current, proposed);
            } else {
                emit ParameterProposed(parameter, current, proposed, justification);
            }
        }
    }

    // ============================================================
    // PLATFORM INTERFACE — Called by CryptValt before allowing actions
    // ============================================================
    function canBid(address wallet) external view returns (bool allowed, string memory reason) {
        if (!active) return (true, "");
        if (profiles[wallet].frozen) return (false, "Wallet frozen by governor");
        if (profiles[wallet].firstSeen == 0) return (true, "");  // New wallet — allow
        uint256 rep = profiles[wallet].reputation;
        uint256 minRep = parameters[keccak256("minReputationBid")];
        if (rep < minRep) return (false, "Reputation below minimum to bid");
        return (true, "");
    }

    function canList(address wallet) external view returns (bool allowed, string memory reason) {
        if (!active) return (true, "");
        if (profiles[wallet].frozen) return (false, "Wallet frozen by governor");
        if (profiles[wallet].firstSeen == 0) return (true, "");
        uint256 rep = profiles[wallet].reputation;
        uint256 minRep = parameters[keccak256("minReputationList")];
        if (rep < minRep) return (false, "Reputation below minimum to list");
        return (true, "");
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    function getProfile(address wallet) external view returns (WalletProfile memory) {
        return profiles[wallet];
    }

    function getWalletFlags(address wallet) external view returns (FraudFlag[] memory) {
        return walletFlags[wallet];
    }

    function getListingFlags(uint256 listingId) external view returns (FraudFlag[] memory) {
        return listingFlags[listingId];
    }

    function getReputationScore(address wallet) external view returns (uint256) {
        if (profiles[wallet].firstSeen == 0) return INITIAL_REPUTATION;
        return profiles[wallet].reputation;
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

    function getAllFlagsCount() external view returns (uint256) {
        return allFlags.length;
    }

    function getGovernanceStats() external view returns (
        uint256 flags,
        uint256 autoFreezes,
        uint256 collusionRings,
        bool    governorActive_
    ) {
        return (totalFlagsRaised, totalAutoFreezes, totalCollusionRingsDetected, active);
    }

    // ============================================================
    // ADMIN
    // ============================================================
    function verifyWallet(address wallet) external onlyOwner {
        _ensureProfile(wallet);
        profiles[wallet].verified = true;
        _adjustReputation(wallet, REP_VERIFIED, "Wallet verified by admin");
        emit WalletVerified(wallet, msg.sender);
    }

    function manualFreeze(address wallet, string calldata reason) external onlyOwner {
        profiles[wallet].frozen = true;
        platform.freezeWallet(wallet, reason);
    }

    function manualUnfreeze(address wallet) external onlyOwner {
        profiles[wallet].frozen = false;
        platform.unfreezeWallet(wallet);
    }

    function setActive(bool _active) external onlyOwner {
        active = _active;
    }

    function updatePlatform(address _platform) external onlyOwner {
        platform = ICryptValt(_platform);
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function _withinRange(uint256 a, uint256 b, uint256 tolerance) internal pure returns (bool) {
        if (a > b) return a - b <= tolerance;
        return b - a <= tolerance;
    }

    function _fraudTypeString(FraudType ft) internal pure returns (string memory) {
        if (ft == FraudType.WashTrading)     return "Wash trading";
        if (ft == FraudType.SybilAttack)     return "Sybil attack";
        if (ft == FraudType.BidManipulation) return "Bid manipulation";
        if (ft == FraudType.VelocityAbuse)   return "Velocity abuse";
        if (ft == FraudType.CollusionRing)   return "Collusion ring";
        if (ft == FraudType.FrontRunning)    return "Front running";
        if (ft == FraudType.SpamListing)     return "Spam listing";
        return "Identity fraud";
    }

    // SafeMath inline
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        require(c / a == b, "Overflow");
        return c;
    }

    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "Overflow");
        return c;
    }
}