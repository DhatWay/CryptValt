// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CryptValt Governing Algorithm
 * 
 * Autonomous on-chain governance layer.
 * Watches all platform activity and makes autonomous decisions.
 * No human intervention required.
 * 
 * Responsibilities:
 * - Fraud detection and automatic response
 * - Bid pattern analysis
 * - Wallet reputation scoring
 * - Anomaly detection
 * - Platform parameter adjustment
 * - Dispute resolution logic
 * - Fee adjustment based on volume
 */

interface ICryptValt {
    function flagListing(uint256 listingId, string calldata reason, uint8 severity) external;
    function freezeWallet(address wallet, string calldata reason) external;
    function unfreezeWallet(address wallet) external;
    function freezePlatform() external;
    function getListing(uint256 listingId) external view returns (
        uint256 id,
        address inventor,
        string memory ipfsCid,
        string memory keyHash,
        uint256 aiScore,
        uint256 dollarValueMid,
        uint256 reservePrice,
        uint256 royaltyBps,
        uint256 startTime,
        uint256 endTime,
        uint256 revealDeadline,
        uint8 status,
        address winner,
        uint256 winningBid,
        string memory encryptedKeyForWinner,
        bool keyDelivered,
        bool fundsReleased,
        uint256 bidCount
    );
    function getBidders(uint256 listingId) external view returns (address[] memory);
    function getPlatformStats() external view returns (
        uint256 totalListings,
        uint256 totalVolume,
        uint256 listingCount,
        bool frozen
    );
}

contract CryptValtGovernor {

    // ============================================================
    // STATE
    // ============================================================
    address public owner;
    ICryptValt public platform;

    // Wallet reputation scores (0-100, starts at 50)
    mapping(address => uint256) public reputationScore;
    mapping(address => uint256) public totalBids;
    mapping(address => uint256) public successfulPurchases;
    mapping(address => uint256) public disputesRaised;
    mapping(address => uint256) public disputesLost;
    mapping(address => bool) public verifiedWallets;
    mapping(address => uint256) public lastActivity;

    // Sybil detection
    mapping(address => address[]) public linkedWallets;
    mapping(bytes32 => bool) public usedBehaviorPatterns;

    // Bid analysis
    mapping(uint256 => BidAnalysis) public bidAnalyses;

    // Platform parameters (governed autonomously)
    uint256 public minReservePrice = 0.001 ether;
    uint256 public maxListingsPerWallet = 50;
    uint256 public suspicionThreshold = 3;    // Flags before auto-freeze
    uint256 public minReputationToBid = 20;

    // Anomaly tracking
    uint256 public totalAnomalies;
    uint256 public totalFreezes;
    AnomalyLog[] public anomalyLog;

    struct BidAnalysis {
        uint256 listingId;
        uint256 bidCount;
        uint256 uniqueBidders;
        bool sybilSuspected;
        bool washTradingSuspected;
        bool snipingDetected;
        uint256 analyzedAt;
    }

    struct AnomalyLog {
        uint256 timestamp;
        address wallet;
        uint256 listingId;
        string anomalyType;
        uint8 severity;
        string action;
    }

    struct WalletProfile {
        address wallet;
        uint256 reputation;
        uint256 bids;
        uint256 purchases;
        uint256 listings;
        uint256 disputes;
        bool frozen;
        bool verified;
        uint256 firstSeen;
        uint256 lastSeen;
    }

    // ============================================================
    // EVENTS
    // ============================================================
    event AnomalyDetected(address indexed wallet, uint256 indexed listingId, string anomalyType, uint8 severity);
    event ReputationUpdated(address indexed wallet, uint256 oldScore, uint256 newScore);
    event ParameterAdjusted(string parameter, uint256 oldValue, uint256 newValue);
    event SybilSuspected(address indexed wallet, address indexed linkedWallet);
    event WashTradingSuspected(uint256 indexed listingId);
    event GovernanceAction(string action, address indexed target, string reason);

    // ============================================================
    // MODIFIERS
    // ============================================================
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPlatformOrOwner() {
        require(msg.sender == address(platform) || msg.sender == owner, "Unauthorized");
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================
    constructor(address _platform) {
        owner = msg.sender;
        platform = ICryptValt(_platform);
    }

    // ============================================================
    // WALLET REPUTATION ENGINE
    // ============================================================
    function initWallet(address wallet) external {
        if (reputationScore[wallet] == 0) {
            reputationScore[wallet] = 50; // Neutral start
            lastActivity[wallet] = block.timestamp;
        }
    }

    function recordBid(address wallet, uint256 listingId) external onlyPlatformOrOwner {
        if (reputationScore[wallet] == 0) reputationScore[wallet] = 50;
        totalBids[wallet]++;
        lastActivity[wallet] = block.timestamp;
        _analyzeBidBehavior(wallet, listingId);
    }

    function recordSuccessfulPurchase(address wallet) external onlyPlatformOrOwner {
        successfulPurchases[wallet]++;
        _adjustReputation(wallet, 5, true); // +5 for completing a purchase
        lastActivity[wallet] = block.timestamp;
    }

    function recordDisputeRaised(address wallet) external onlyPlatformOrOwner {
        disputesRaised[wallet]++;
        _adjustReputation(wallet, 3, false); // -3 for raising dispute
    }

    function recordDisputeLost(address wallet) external onlyPlatformOrOwner {
        disputesLost[wallet]++;
        _adjustReputation(wallet, 10, false); // -10 for losing dispute
    }

    function verifyWallet(address wallet) external onlyOwner {
        verifiedWallets[wallet] = true;
        _adjustReputation(wallet, 15, true); // +15 for verification
    }

    // ============================================================
    // ANOMALY DETECTION ENGINE
    // ============================================================
    function analyzeListing(uint256 listingId) external returns (BidAnalysis memory) {
        address[] memory bidderList = platform.getBidders(listingId);
        uint256 bidCount = bidderList.length;

        bool sybilSuspected = false;
        bool washTrading = false;
        bool sniping = false;

        // Check for sybil attacks — same behavioral patterns
        for (uint256 i = 0; i < bidderList.length; i++) {
            for (uint256 j = i + 1; j < bidderList.length; j++) {
                if (_areLikelyLinked(bidderList[i], bidderList[j])) {
                    sybilSuspected = true;
                    emit SybilSuspected(bidderList[i], bidderList[j]);
                    _logAnomaly(bidderList[i], listingId, "SYBIL_SUSPECTED", 2, "FLAGGED");
                }
            }
        }

        // Check for wash trading — inventor bidding on own idea
        for (uint256 i = 0; i < bidderList.length; i++) {
            (uint256 id, address inventor,,,,,,,,,,,,,,,, ) = platform.getListing(listingId);
            if (bidderList[i] == inventor) {
                washTrading = true;
                platform.flagListing(listingId, "Inventor bidding on own listing", 2);
                emit WashTradingSuspected(listingId);
                _logAnomaly(inventor, listingId, "WASH_TRADING", 3, "FROZEN");
                platform.freezeWallet(inventor, "Wash trading detected");
            }
        }

        BidAnalysis memory analysis = BidAnalysis({
            listingId: listingId,
            bidCount: bidCount,
            uniqueBidders: bidCount,
            sybilSuspected: sybilSuspected,
            washTradingSuspected: washTrading,
            snipingDetected: sniping,
            analyzedAt: block.timestamp
        });

        bidAnalyses[listingId] = analysis;
        return analysis;
    }

    function _analyzeBidBehavior(address wallet, uint256 listingId) internal {
        // Check reputation threshold
        if (reputationScore[wallet] < minReputationToBid) {
            _logAnomaly(wallet, listingId, "LOW_REPUTATION_BID", 1, "FLAGGED");
            platform.flagListing(listingId, "Low reputation bidder", 1);
        }

        // Check rapid bidding — more than 10 bids in last hour
        if (totalBids[wallet] > 10 && block.timestamp - lastActivity[wallet] < 1 hours) {
            _logAnomaly(wallet, listingId, "RAPID_BIDDING", 2, "FLAGGED");
            _adjustReputation(wallet, 5, false);
        }
    }

    function _areLikelyLinked(address a, address b) internal view returns (bool) {
        // Check if wallets have identical bid timing patterns
        // In production this would use more sophisticated on-chain analysis
        if (lastActivity[a] == lastActivity[b] && lastActivity[a] != 0) return true;
        if (totalBids[a] == totalBids[b] && totalBids[a] > 5) return true;
        return false;
    }

    // ============================================================
    // REPUTATION ADJUSTMENT
    // ============================================================
    function _adjustReputation(address wallet, uint256 delta, bool increase) internal {
        uint256 oldScore = reputationScore[wallet];
        if (increase) {
            reputationScore[wallet] = min(100, oldScore + delta);
        } else {
            reputationScore[wallet] = oldScore > delta ? oldScore - delta : 0;
        }
        emit ReputationUpdated(wallet, oldScore, reputationScore[wallet]);

        // Auto-freeze on critically low reputation
        if (reputationScore[wallet] <= 10) {
            platform.freezeWallet(wallet, "Reputation critically low");
            _logAnomaly(wallet, 0, "CRITICAL_REPUTATION", 3, "AUTO_FROZEN");
        }
    }

    // ============================================================
    // ANOMALY LOGGING
    // ============================================================
    function _logAnomaly(
        address wallet,
        uint256 listingId,
        string memory anomalyType,
        uint8 severity,
        string memory action
    ) internal {
        anomalyLog.push(AnomalyLog({
            timestamp: block.timestamp,
            wallet: wallet,
            listingId: listingId,
            anomalyType: anomalyType,
            severity: severity,
            action: action
        }));
        totalAnomalies++;
        emit AnomalyDetected(wallet, listingId, anomalyType, severity);
    }

    // ============================================================
    // AUTONOMOUS PARAMETER GOVERNANCE
    // ============================================================
    function adjustParameters() external {
        (uint256 totalListings, uint256 totalVolume,,) = platform.getPlatformStats();

        // Adjust minimum reputation threshold based on platform maturity
        if (totalListings > 100 && minReputationToBid < 30) {
            uint256 old = minReputationToBid;
            minReputationToBid = 30;
            emit ParameterAdjusted("minReputationToBid", old, 30);
        }

        // Adjust suspicion threshold based on anomaly rate
        if (totalAnomalies > 0 && totalListings > 0) {
            uint256 anomalyRate = (totalAnomalies * 100) / totalListings;
            if (anomalyRate > 20 && suspicionThreshold > 2) {
                uint256 old = suspicionThreshold;
                suspicionThreshold = 2;
                emit ParameterAdjusted("suspicionThreshold", old, 2);
            }
        }
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    function getWalletProfile(address wallet) external view returns (WalletProfile memory) {
        return WalletProfile({
            wallet: wallet,
            reputation: reputationScore[wallet],
            bids: totalBids[wallet],
            purchases: successfulPurchases[wallet],
            listings: 0,
            disputes: disputesRaised[wallet],
            frozen: false,
            verified: verifiedWallets[wallet],
            firstSeen: 0,
            lastSeen: lastActivity[wallet]
        });
    }

    function getAnomalyLog(uint256 start, uint256 count) external view returns (AnomalyLog[] memory) {
        uint256 end = min(start + count, anomalyLog.length);
        AnomalyLog[] memory result = new AnomalyLog[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = anomalyLog[i];
        }
        return result;
    }

    function canBid(address wallet) external view returns (bool, string memory) {
        if (reputationScore[wallet] < minReputationToBid) {
            return (false, "Reputation too low");
        }
        return (true, "");
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function updatePlatform(address newPlatform) external onlyOwner {
        platform = ICryptValt(newPlatform);
    }
}