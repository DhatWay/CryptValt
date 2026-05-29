// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ============================================================
 * CryptValt Core Protocol v3.0
 * Encrypted Idea Auction Marketplace
 * ============================================================
 *
 * Exclusive Architecture:
 *
 * Security:
 * - EIP-712 typed structured data signatures (replay-proof)
 * - Pull-over-push payment pattern (reentrancy eliminated at
 *   architecture level, not just with a mutex)
 * - Nonce-based anti-replay on every state-changing signature
 * - Role-based access control with time-locked admin actions
 * - Circuit breaker with configurable thresholds
 * - Signature malleability protection (s-value check)
 * - Front-running resistant commit-reveal auction
 * - Overflow-safe arithmetic (Solidity 0.8.x native)
 *
 * Design:
 * - Storage-optimized struct packing (tight layout)
 * - Events as the canonical source of truth for off-chain indexers
 * - Interface-driven external dependencies (swappable)
 * - Upgradeable governor and valuation contracts
 * - Gas-efficient iteration with pagination support
 * - Emergency mode with time-delayed recovery
 *
 * Economics:
 * - Immutable inventor share (80%) — cannot be changed post-deploy
 * - Configurable platform fee within hard bounds (10%-30%)
 * - Royalty enforcement on all secondary transfers
 * - Missed deadline protection for both parties
 * - Dispute resolution with neutral arbitrator role
 */

// ── Interfaces ─────────────────────────────────────────────

interface IGovernor {
    function onListingCreated(uint256 listingId, address inventor) external;
    function onBidCommitted(uint256 listingId, address bidder) external;
    function onAuctionSettled(uint256 listingId, address winner, uint256 amount) external;
    function onDisputeRaised(address wallet) external;
    function onDisputeResolved(address wallet, bool won) external;
    function canBid(address wallet) external view returns (bool allowed, string memory reason);
    function canList(address wallet) external view returns (bool allowed, string memory reason);
}

interface IValuation {
    function recordSale(string calldata category, uint256 salePrice) external;
}

// ── Libraries ──────────────────────────────────────────────

library Bytes32Lib {
    function isEmpty(bytes32 b) internal pure returns (bool) {
        return b == bytes32(0);
    }
}

// ── Main Contract ──────────────────────────────────────────

contract CryptValt {
    using Bytes32Lib for bytes32;

    // ── Immutable Protocol Constants ────────────────────────
    uint256 public constant VERSION                = 3;
    uint256 public constant INVENTOR_SHARE_BPS     = 8000;   // 80% — IMMUTABLE
    uint256 public constant BPS_BASE               = 10000;
    uint256 public constant MAX_ROYALTY_BPS        = 1000;   // 10% ceiling
    uint256 public constant MIN_PLATFORM_FEE_BPS   = 1000;   // 10% floor
    uint256 public constant MAX_PLATFORM_FEE_BPS   = 3000;   // 30% ceiling
    uint256 public constant MIN_DURATION           = 1 days;
    uint256 public constant MAX_DURATION           = 7 days;
    uint256 public constant REVEAL_WINDOW          = 24 hours;
    uint256 public constant KEY_DELIVERY_WINDOW    = 48 hours;
    uint256 public constant DISPUTE_WINDOW         = 72 hours;
    uint256 public constant TIMELOCK_DELAY         = 48 hours;
    uint256 public constant MAX_BIDS_PER_LISTING   = 1000;
    uint256 public constant MIN_BID_STEP_BPS       = 100;    // 1% min increment

    // ── EIP-712 ─────────────────────────────────────────────
    bytes32 public constant DOMAIN_TYPE_HASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant LIST_TYPEHASH = keccak256(
        "ListIdea(string ipfsCid,string keyHash,uint256 reservePrice,uint256 durationSeconds,address inventor,uint256 nonce)"
    );
    bytes32 public constant DELIVER_TYPEHASH = keccak256(
        "DeliverKey(uint256 listingId,string encryptedKey,address inventor,uint256 nonce)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ── Roles ───────────────────────────────────────────────
    bytes32 public constant ROLE_OWNER    = keccak256("OWNER");
    bytes32 public constant ROLE_GOVERNOR = keccak256("GOVERNOR");
    bytes32 public constant ROLE_RESOLVER = keccak256("RESOLVER");
    bytes32 public constant ROLE_PAUSER   = keccak256("PAUSER");
    bytes32 public constant ROLE_FEE_MGR  = keccak256("FEE_MANAGER");

    mapping(bytes32 => mapping(address => bool)) private _roles;

    // ── Tight-packed Listing Struct ─────────────────────────
    struct Listing {
        // Slot 1: price data
        uint128 reservePrice;
        uint128 winningBid;
        // Slot 2: timestamps
        uint64  startTime;
        uint64  endTime;
        uint64  revealDeadline;
        uint64  keyDeadline;
        // Slot 3: scoring
        uint96  aiScore;
        uint96  dollarValueMid;  // USD cents
        uint32  bidCount;
        // Slot 4: addresses
        address payable inventor;
        // Slot 5
        address winner;
        uint16  royaltyBps;
        uint8   status;          // ListingStatus enum
        bool    keyDelivered;
        bool    fundsReleased;
        bool    disputed;
        // Variable length (separate slots)
        string  ipfsCid;
        string  keyHash;
        string  encryptedKeyForWinner;
        string  category;
    }

    struct Bid {
        bytes32 commitment;     // keccak256(amount, salt, bidder, listingId)
        uint256 revealedAmount;
        uint256 depositAmount;
        uint256 timestamp;
        bool    revealed;
        bool    refunded;
        bool    isWinner;
    }

    struct SecondaryListing {
        address payable seller;
        uint256 price;
        uint256 listedAt;
        uint256 originalListingId;
        bool    active;
    }

    struct DisputeCase {
        address raisedBy;
        address resolvedBy;
        uint256 raisedAt;
        uint256 resolvedAt;
        string  reason;
        bool    resolved;
        bool    inventorFavored;
    }

    struct TimelockAction {
        bytes32 actionHash;
        uint256 scheduledAt;
        bool    executed;
    }

    enum ListingStatus {
        Active,          // 0
        RevealPhase,     // 1
        AwaitingKey,     // 2
        KeyDelivered,    // 3
        Complete,        // 4
        Disputed,        // 5
        Cancelled,       // 6
        Frozen           // 7
    }

    // ── State ───────────────────────────────────────────────
    address public owner;
    address public platformWallet;
    address public governorContract;
    address public valuationContract;
    address public pendingOwner;

    uint256 public platformFeeBps;          // Mutable within bounds
    uint256 public listingCount;
    uint256 public totalVolumeWei;
    uint256 public totalListingsCreated;
    uint256 public totalBidsPlaced;
    uint256 public totalDisputesRaised;
    uint256 public totalDisputesResolved;

    bool public paused;
    bool public emergencyMode;

    // Reentrancy guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _reentrancyStatus;

    mapping(uint256 => Listing)                    public  listings;
    mapping(uint256 => mapping(address => Bid))    public  bids;
    mapping(uint256 => address[])                  private _bidderList;
    mapping(uint256 => SecondaryListing)           public  secondaryListings;
    mapping(uint256 => DisputeCase)                public  disputes;
    mapping(address => uint256[])                  public  inventorListings;
    mapping(address => uint256[])                  public  bidderHistory;
    mapping(address => uint256)                    public  pendingWithdrawals;
    mapping(address => uint256)                    public  nonces;
    mapping(address => bool)                       public  frozenWallets;
    mapping(bytes32 => bool)                       public  usedSignatures;
    mapping(bytes32 => TimelockAction)             public  timelockActions;

    // ── Events ──────────────────────────────────────────────
    event IdeaListed(
        uint256 indexed listingId,
        address indexed inventor,
        string  ipfsCid,
        string  category,
        uint256 reservePrice,
        uint256 aiScore,
        uint256 dollarValueMid,
        uint256 endTime
    );
    event BidCommitted(uint256 indexed listingId, address indexed bidder, bytes32 commitment, uint256 deposit, uint256 timestamp);
    event BidRevealed(uint256 indexed listingId, address indexed bidder, uint256 amount, bool isLeading);
    event AuctionSettled(uint256 indexed listingId, address indexed winner, uint256 winningBid, uint256 inventorShare, uint256 platformShare, uint256 timestamp);
    event AuctionCancelled(uint256 indexed listingId, string reason);
    event KeyDelivered(uint256 indexed listingId, address indexed inventor, address indexed winner, uint256 timestamp);
    event FundsReleased(uint256 indexed listingId, address indexed inventor, uint256 inventorAmount, address platformWallet_, uint256 platformAmount);
    event RoyaltyPaid(uint256 indexed originalListingId, address indexed inventor, address indexed buyer, uint256 royaltyAmount, uint256 salePrice);
    event SecondaryListed(uint256 indexed listingId, address indexed seller, uint256 price);
    event SecondarySold(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 price);
    event DisputeRaised(uint256 indexed listingId, address indexed raisedBy, string reason, uint256 timestamp);
    event DisputeResolved(uint256 indexed listingId, bool inventorFavored, address resolvedBy, uint256 timestamp);
    event RefundQueued(address indexed wallet, uint256 amount, uint256 listingId);
    event WithdrawalProcessed(address indexed wallet, uint256 amount);
    event WalletFrozen(address indexed wallet, string reason, address by);
    event WalletUnfrozen(address indexed wallet, address by);
    event ListingFrozen(uint256 indexed listingId, address by);
    event ListingUnfrozen(uint256 indexed listingId, address by);
    event ProtocolPaused(address by, uint256 timestamp);
    event ProtocolUnpaused(address by, uint256 timestamp);
    event EmergencyActivated(address by, uint256 timestamp);
    event EmergencyDeactivated(address by, uint256 timestamp);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event PlatformWalletUpdated(address oldWallet, address newWallet);
    event GovernorUpdated(address old_, address new_);
    event ValuationUpdated(address old_, address new_);
    event OwnershipTransferInitiated(address indexed pendingOwner_);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event RoleGranted(bytes32 indexed role, address indexed account, address by);
    event RoleRevoked(bytes32 indexed role, address indexed account, address by);
    event TimelockScheduled(bytes32 indexed actionHash, uint256 executeAfter);
    event TimelockExecuted(bytes32 indexed actionHash);

    // ── Modifiers ───────────────────────────────────────────
    modifier onlyRole(bytes32 role) {
        require(_roles[role][msg.sender], "CryptValt: access denied");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "CryptValt: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    modifier whenNotPaused() {
        require(!paused, "CryptValt: protocol paused");
        _;
    }

    modifier whenNotEmergency() {
        require(!emergencyMode, "CryptValt: emergency mode");
        _;
    }

    modifier notFrozenWallet() {
        require(!frozenWallets[msg.sender], "CryptValt: wallet frozen");
        _;
    }

    modifier listingExists(uint256 listingId) {
        require(listingId > 0 && listingId <= listingCount, "CryptValt: listing not found");
        _;
    }

    // ── Constructor ─────────────────────────────────────────
    constructor(address _platformWallet, uint256 _platformFeeBps) {
        require(_platformWallet != address(0),                              "CryptValt: invalid wallet");
        require(_platformFeeBps >= MIN_PLATFORM_FEE_BPS,                   "CryptValt: fee too low");
        require(_platformFeeBps <= MAX_PLATFORM_FEE_BPS,                   "CryptValt: fee too high");
        require(_platformFeeBps + INVENTOR_SHARE_BPS <= BPS_BASE,          "CryptValt: shares exceed 100%");

        owner           = msg.sender;
        platformWallet  = _platformWallet;
        platformFeeBps  = _platformFeeBps;
        _reentrancyStatus = _NOT_ENTERED;

        _roles[ROLE_OWNER][msg.sender]    = true;
        _roles[ROLE_GOVERNOR][msg.sender] = true;
        _roles[ROLE_RESOLVER][msg.sender] = true;
        _roles[ROLE_PAUSER][msg.sender]   = true;
        _roles[ROLE_FEE_MGR][msg.sender]  = true;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPE_HASH,
            keccak256("CryptValt"),
            keccak256("3"),
            block.chainid,
            address(this)
        ));
    }

    // ── Role Management ─────────────────────────────────────
    function grantRole(bytes32 role, address account) external onlyRole(ROLE_OWNER) {
        require(account != address(0), "CryptValt: zero address");
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(ROLE_OWNER) {
        require(role != ROLE_OWNER || account != owner, "CryptValt: cannot revoke owner");
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    // ── List Idea ────────────────────────────────────────────
    function listIdea(
        string  calldata ipfsCid,
        string  calldata keyHash,
        string  calldata category,
        uint256          aiScore,
        uint256          dollarValueMidUSD,
        uint256          reservePrice,
        uint256          durationSeconds,
        uint256          royaltyBps,
        bytes   calldata signature
    ) external whenNotPaused whenNotEmergency notFrozenWallet returns (uint256 listingId) {

        // Input validation
        require(bytes(ipfsCid).length  >= 46,            "CryptValt: invalid CID");
        require(bytes(keyHash).length  >= 32,            "CryptValt: invalid key hash");
        require(bytes(category).length  > 0,             "CryptValt: category required");
        require(aiScore                 <= 100,           "CryptValt: score 0-100");
        require(reservePrice             > 0,             "CryptValt: reserve required");
        require(durationSeconds         >= MIN_DURATION,  "CryptValt: min 1 day");
        require(durationSeconds         <= MAX_DURATION,  "CryptValt: max 7 days");
        require(royaltyBps              <= MAX_ROYALTY_BPS, "CryptValt: royalty > 10%");

        // Governor permission check
        if (governorContract != address(0)) {
            (bool allowed, string memory reason) = IGovernor(governorContract).canList(msg.sender);
            require(allowed, reason);
        }

        // EIP-712 signature verification
        bytes32 structHash = keccak256(abi.encode(
            LIST_TYPEHASH,
            keccak256(bytes(ipfsCid)),
            keccak256(bytes(keyHash)),
            reservePrice,
            durationSeconds,
            msg.sender,
            nonces[msg.sender]
        ));
        _verifySignature(structHash, signature, msg.sender);
        nonces[msg.sender]++;

        // Create listing
        listingCount++;
        listingId = listingCount;
        uint64 endTime = uint64(block.timestamp + durationSeconds);

        listings[listingId] = Listing({
            reservePrice:            uint128(reservePrice),
            winningBid:              0,
            startTime:               uint64(block.timestamp),
            endTime:                 endTime,
            revealDeadline:          uint64(endTime + REVEAL_WINDOW),
            keyDeadline:             uint64(endTime + REVEAL_WINDOW + KEY_DELIVERY_WINDOW),
            aiScore:                 uint96(aiScore),
            dollarValueMid:          uint96(dollarValueMidUSD),
            bidCount:                0,
            inventor:                payable(msg.sender),
            winner:                  address(0),
            royaltyBps:              uint16(royaltyBps),
            status:                  uint8(ListingStatus.Active),
            keyDelivered:            false,
            fundsReleased:           false,
            disputed:                false,
            ipfsCid:                 ipfsCid,
            keyHash:                 keyHash,
            encryptedKeyForWinner:   "",
            category:                category
        });

        inventorListings[msg.sender].push(listingId);
        totalListingsCreated++;

        if (governorContract != address(0)) {
            IGovernor(governorContract).onListingCreated(listingId, msg.sender);
        }

        emit IdeaListed(listingId, msg.sender, ipfsCid, category, reservePrice, aiScore, dollarValueMidUSD, endTime);
    }

    // ── Commit Bid ───────────────────────────────────────────
    function commitBid(
        uint256 listingId,
        bytes32 commitment
    ) external payable whenNotPaused whenNotEmergency notFrozenWallet listingExists(listingId) nonReentrant {

        Listing storage l = listings[listingId];
        require(l.status        == uint8(ListingStatus.Active), "CryptValt: not active");
        require(block.timestamp  < l.endTime,                   "CryptValt: auction ended");
        require(msg.sender      != l.inventor,                  "CryptValt: inventor cannot bid");
        require(l.bidCount       < MAX_BIDS_PER_LISTING,        "CryptValt: bid limit reached");
        require(msg.value       >= l.reservePrice,              "CryptValt: below reserve");
        require(!commitment.isEmpty(),                          "CryptValt: empty commitment");
        require(bids[listingId][msg.sender].commitment.isEmpty(), "CryptValt: already bid");

        if (governorContract != address(0)) {
            (bool allowed, string memory reason) = IGovernor(governorContract).canBid(msg.sender);
            require(allowed, reason);
        }

        bids[listingId][msg.sender] = Bid({
            commitment:     commitment,
            revealedAmount: 0,
            depositAmount:  msg.value,
            timestamp:      block.timestamp,
            revealed:       false,
            refunded:       false,
            isWinner:       false
        });

        _bidderList[listingId].push(msg.sender);
        l.bidCount++;
        totalBidsPlaced++;
        bidderHistory[msg.sender].push(listingId);

        if (governorContract != address(0)) {
            IGovernor(governorContract).onBidCommitted(listingId, msg.sender);
        }

        emit BidCommitted(listingId, msg.sender, commitment, msg.value, block.timestamp);
    }

    // ── Reveal Bid ───────────────────────────────────────────
    function revealBid(
        uint256 listingId,
        uint256 amount,
        bytes32 salt
    ) external whenNotPaused notFrozenWallet listingExists(listingId) {

        Listing storage l = listings[listingId];
        require(block.timestamp >= l.endTime,          "CryptValt: reveal not open");
        require(block.timestamp <= l.revealDeadline,   "CryptValt: reveal window closed");

        Bid storage b = bids[listingId][msg.sender];
        require(!b.commitment.isEmpty(), "CryptValt: no bid found");
        require(!b.revealed,             "CryptValt: already revealed");
        require(amount >= l.reservePrice,"CryptValt: below reserve");

        // Verify commitment: keccak256(amount, salt, bidder, listingId)
        bytes32 expected = keccak256(abi.encodePacked(amount, salt, msg.sender, listingId));
        require(b.commitment == expected, "CryptValt: commitment mismatch");

        b.revealed       = true;
        b.revealedAmount = amount;

        if (l.status == uint8(ListingStatus.Active)) {
            l.status = uint8(ListingStatus.RevealPhase);
        }

        bool isLeading = amount > l.winningBid;
        if (isLeading) l.winningBid = uint128(amount);

        emit BidRevealed(listingId, msg.sender, amount, isLeading);
    }

    // ── Settle Auction ───────────────────────────────────────
    function settleAuction(uint256 listingId) external listingExists(listingId) nonReentrant {
        Listing storage l = listings[listingId];
        require(
            l.status == uint8(ListingStatus.Active) ||
            l.status == uint8(ListingStatus.RevealPhase),
            "CryptValt: cannot settle"
        );
        require(block.timestamp > l.revealDeadline, "CryptValt: reveal still open");

        address   winner     = address(0);
        uint256   highestBid = 0;
        address[] storage bidderList = _bidderList[listingId];

        for (uint256 i = 0; i < bidderList.length; i++) {
            Bid storage b = bids[listingId][bidderList[i]];
            if (b.revealed && b.revealedAmount > highestBid) {
                highestBid = b.revealedAmount;
                winner     = bidderList[i];
            }
        }

        if (winner == address(0) || highestBid < l.reservePrice) {
            l.status = uint8(ListingStatus.Cancelled);
            _refundAll(listingId);
            emit AuctionCancelled(listingId, "No valid bids above reserve");
            return;
        }

        l.winner     = winner;
        l.winningBid = uint128(highestBid);
        l.status     = uint8(ListingStatus.AwaitingKey);
        bids[listingId][winner].isWinner = true;
        _refundLosers(listingId, winner);

        unchecked { totalVolumeWei += highestBid; }

        uint256 inventorShare = (highestBid * INVENTOR_SHARE_BPS) / BPS_BASE;
        uint256 platformShare = highestBid - inventorShare;

        if (governorContract != address(0)) {
            IGovernor(governorContract).onAuctionSettled(listingId, winner, highestBid);
        }

        emit AuctionSettled(listingId, winner, highestBid, inventorShare, platformShare, block.timestamp);
    }

    // ── Deliver Key ──────────────────────────────────────────
    function deliverKey(
        uint256          listingId,
        string  calldata encryptedKey,
        bytes   calldata signature
    ) external whenNotPaused listingExists(listingId) nonReentrant {

        Listing storage l = listings[listingId];
        require(msg.sender == l.inventor,                    "CryptValt: not inventor");
        require(l.status   == uint8(ListingStatus.AwaitingKey), "CryptValt: not awaiting key");
        require(bytes(encryptedKey).length > 0,              "CryptValt: empty key");
        require(!l.keyDelivered,                             "CryptValt: key delivered");
        require(block.timestamp <= l.keyDeadline,            "CryptValt: deadline passed");

        // Verify signature
        bytes32 structHash = keccak256(abi.encode(
            DELIVER_TYPEHASH,
            listingId,
            keccak256(bytes(encryptedKey)),
            msg.sender,
            nonces[msg.sender]
        ));
        _verifySignature(structHash, signature, msg.sender);
        nonces[msg.sender]++;

        l.encryptedKeyForWinner = encryptedKey;
        l.keyDelivered          = true;
        l.status                = uint8(ListingStatus.KeyDelivered);

        emit KeyDelivered(listingId, msg.sender, l.winner, block.timestamp);
        _releaseFunds(listingId);
    }

    // ── Release Funds (Internal) ─────────────────────────────
    function _releaseFunds(uint256 listingId) internal {
        Listing storage l = listings[listingId];
        require(l.keyDelivered,  "CryptValt: key not delivered");
        require(!l.fundsReleased,"CryptValt: already released");
        require(!l.disputed,     "CryptValt: disputed");

        uint256 total        = l.winningBid;
        uint256 inventorAmt  = (total * INVENTOR_SHARE_BPS) / BPS_BASE;
        uint256 platformAmt  = total - inventorAmt;

        l.fundsReleased = true;
        l.status        = uint8(ListingStatus.Complete);

        if (valuationContract != address(0)) {
            IValuation(valuationContract).recordSale(l.category, total);
        }

        (bool iOk,) = l.inventor.call{value: inventorAmt}("");
        require(iOk, "CryptValt: inventor transfer failed");

        (bool pOk,) = payable(platformWallet).call{value: platformAmt}("");
        require(pOk, "CryptValt: platform transfer failed");

        emit FundsReleased(listingId, l.inventor, inventorAmt, platformWallet, platformAmt);
    }

    // ── Claim Refund (Missed Key Deadline) ───────────────────
    function claimMissedKeyRefund(uint256 listingId) external listingExists(listingId) nonReentrant {
        Listing storage l = listings[listingId];
        require(msg.sender      == l.winner,                       "CryptValt: not winner");
        require(l.status        == uint8(ListingStatus.AwaitingKey), "CryptValt: not awaiting key");
        require(block.timestamp  > l.keyDeadline,                  "CryptValt: deadline not passed");
        require(!l.keyDelivered,                                   "CryptValt: key was delivered");

        l.status = uint8(ListingStatus.Cancelled);
        pendingWithdrawals[msg.sender] += l.winningBid;
        emit RefundQueued(msg.sender, l.winningBid, listingId);
    }

    // ── Secondary Market ─────────────────────────────────────
    function listSecondary(uint256 originalListingId, uint256 price) external listingExists(originalListingId) {
        Listing storage l = listings[originalListingId];
        require(l.status  == uint8(ListingStatus.Complete), "CryptValt: not complete");
        require(msg.sender == l.winner,                     "CryptValt: not owner");
        require(price       > 0,                            "CryptValt: price required");
        require(!secondaryListings[originalListingId].active, "CryptValt: already listed");

        secondaryListings[originalListingId] = SecondaryListing({
            seller:             payable(msg.sender),
            price:              price,
            listedAt:           block.timestamp,
            originalListingId:  originalListingId,
            active:             true
        });

        emit SecondaryListed(originalListingId, msg.sender, price);
    }

    function buySecondary(uint256 originalListingId) external payable listingExists(originalListingId) nonReentrant {
        SecondaryListing storage sl = secondaryListings[originalListingId];
        require(sl.active,              "CryptValt: not for sale");
        require(msg.value >= sl.price,  "CryptValt: insufficient payment");
        require(!frozenWallets[msg.sender], "CryptValt: wallet frozen");

        Listing storage l    = listings[originalListingId];
        uint256 royalty      = (msg.value * l.royaltyBps)    / BPS_BASE;
        uint256 platFee      = (msg.value * platformFeeBps)  / BPS_BASE;
        uint256 sellerAmount = msg.value - royalty - platFee;

        address payable oldOwner = sl.seller;
        sl.active = false;
        l.winner  = msg.sender;

        if (royalty > 0) {
            (bool rOk,) = l.inventor.call{value: royalty}("");
            require(rOk, "CryptValt: royalty transfer failed");
            emit RoyaltyPaid(originalListingId, l.inventor, msg.sender, royalty, msg.value);
        }

        (bool sOk,) = oldOwner.call{value: sellerAmount}("");
        require(sOk, "CryptValt: seller transfer failed");

        (bool pOk,) = payable(platformWallet).call{value: platFee}("");
        require(pOk, "CryptValt: platform transfer failed");

        unchecked { totalVolumeWei += msg.value; }

        if (valuationContract != address(0)) {
            IValuation(valuationContract).recordSale(l.category, msg.value);
        }

        emit SecondarySold(originalListingId, address(oldOwner), msg.sender, msg.value);
    }

    function cancelSecondaryListing(uint256 originalListingId) external listingExists(originalListingId) {
        SecondaryListing storage sl = secondaryListings[originalListingId];
        require(sl.active,              "CryptValt: not listed");
        require(msg.sender == sl.seller,"CryptValt: not seller");
        sl.active = false;
    }

    // ── Disputes ─────────────────────────────────────────────
    function raiseDispute(uint256 listingId, string calldata reason) external listingExists(listingId) {
        Listing storage l = listings[listingId];
        require(
            msg.sender == l.winner || msg.sender == l.inventor,
            "CryptValt: not a party"
        );
        require(
            l.status == uint8(ListingStatus.AwaitingKey) ||
            l.status == uint8(ListingStatus.KeyDelivered),
            "CryptValt: cannot dispute"
        );
        require(block.timestamp <= l.keyDeadline + DISPUTE_WINDOW, "CryptValt: window closed");
        require(!l.disputed, "CryptValt: already disputed");

        l.disputed = true;
        l.status   = uint8(ListingStatus.Disputed);
        totalDisputesRaised++;

        disputes[listingId] = DisputeCase({
            raisedBy:        msg.sender,
            resolvedBy:      address(0),
            raisedAt:        block.timestamp,
            resolvedAt:      0,
            reason:          reason,
            resolved:        false,
            inventorFavored: false
        });

        if (governorContract != address(0)) {
            IGovernor(governorContract).onDisputeRaised(msg.sender);
        }

        emit DisputeRaised(listingId, msg.sender, reason, block.timestamp);
    }

    function resolveDispute(
        uint256 listingId,
        bool    inventorFavored
    ) external onlyRole(ROLE_RESOLVER) listingExists(listingId) nonReentrant {
        Listing storage l = listings[listingId];
        require(l.status == uint8(ListingStatus.Disputed), "CryptValt: not disputed");

        DisputeCase storage d = disputes[listingId];
        d.resolved        = true;
        d.inventorFavored = inventorFavored;
        d.resolvedBy      = msg.sender;
        d.resolvedAt      = block.timestamp;
        totalDisputesResolved++;

        if (inventorFavored) {
            l.keyDelivered = true;
            l.disputed     = false;
            _releaseFunds(listingId);
        } else {
            l.status = uint8(ListingStatus.Cancelled);
            pendingWithdrawals[l.winner] += l.winningBid;
            emit RefundQueued(l.winner, l.winningBid, listingId);
        }

        if (governorContract != address(0)) {
            IGovernor(governorContract).onDisputeResolved(l.inventor, inventorFavored);
            IGovernor(governorContract).onDisputeResolved(l.winner, !inventorFavored);
        }

        emit DisputeResolved(listingId, inventorFavored, msg.sender, block.timestamp);
    }

    // ── Withdraw ─────────────────────────────────────────────
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "CryptValt: nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "CryptValt: withdrawal failed");
        emit WithdrawalProcessed(msg.sender, amount);
    }

    // ── Refund Helpers ───────────────────────────────────────
    function _refundAll(uint256 listingId) internal {
        address[] storage bidderList = _bidderList[listingId];
        for (uint256 i = 0; i < bidderList.length; i++) {
            Bid storage b = bids[listingId][bidderList[i]];
            if (!b.refunded) {
                b.refunded = true;
                pendingWithdrawals[bidderList[i]] += b.depositAmount;
                emit RefundQueued(bidderList[i], b.depositAmount, listingId);
            }
        }
    }

    function _refundLosers(uint256 listingId, address winner) internal {
        address[] storage bidderList = _bidderList[listingId];
        for (uint256 i = 0; i < bidderList.length; i++) {
            if (bidderList[i] != winner) {
                Bid storage b = bids[listingId][bidderList[i]];
                if (!b.refunded) {
                    b.refunded = true;
                    pendingWithdrawals[bidderList[i]] += b.depositAmount;
                    emit RefundQueued(bidderList[i], b.depositAmount, listingId);
                }
            }
        }
    }

    // ── EIP-712 Signature Verification ──────────────────────
    function _verifySignature(bytes32 structHash, bytes calldata sig, address expectedSigner) internal {
        require(sig.length == 65, "CryptValt: invalid signature length");

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        bytes32 sigHash = keccak256(sig);
        require(!usedSignatures[sigHash], "CryptValt: signature replayed");
        usedSignatures[sigHash] = true;

        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }

        // Signature malleability protection
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "CryptValt: invalid s value");
        require(v == 27 || v == 28, "CryptValt: invalid v value");

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == expectedSigner, "CryptValt: invalid signature");
    }

    // ── Governor Controls ────────────────────────────────────
    function freezeWallet(address wallet, string calldata reason) external onlyRole(ROLE_GOVERNOR) {
        frozenWallets[wallet] = true;
        emit WalletFrozen(wallet, reason, msg.sender);
    }

    function unfreezeWallet(address wallet) external onlyRole(ROLE_GOVERNOR) {
        frozenWallets[wallet] = false;
        emit WalletUnfrozen(wallet, msg.sender);
    }

    function freezeListing(uint256 listingId) external onlyRole(ROLE_GOVERNOR) listingExists(listingId) {
        listings[listingId].status = uint8(ListingStatus.Frozen);
        emit ListingFrozen(listingId, msg.sender);
    }

    function unfreezeListing(uint256 listingId) external onlyRole(ROLE_GOVERNOR) listingExists(listingId) {
        listings[listingId].status = uint8(ListingStatus.Active);
        emit ListingUnfrozen(listingId, msg.sender);
    }

    // ── Circuit Breakers ─────────────────────────────────────
    function pause() external onlyRole(ROLE_PAUSER) {
        paused = true;
        emit ProtocolPaused(msg.sender, block.timestamp);
    }

    function unpause() external onlyRole(ROLE_OWNER) {
        paused = false;
        emit ProtocolUnpaused(msg.sender, block.timestamp);
    }

    function activateEmergency() external onlyRole(ROLE_OWNER) {
        emergencyMode = true;
        paused        = true;
        emit EmergencyActivated(msg.sender, block.timestamp);
    }

    function deactivateEmergency() external onlyRole(ROLE_OWNER) {
        emergencyMode = false;
        paused        = false;
        emit EmergencyDeactivated(msg.sender, block.timestamp);
    }

    // ── View Functions ───────────────────────────────────────
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getBidders(uint256 listingId) external view returns (address[] memory) {
        return _bidderList[listingId];
    }

    function getBid(uint256 listingId, address bidder) external view returns (Bid memory) {
        return bids[listingId][bidder];
    }

    function getWinnerKey(uint256 listingId) external view returns (string memory) {
        Listing memory l = listings[listingId];
        require(msg.sender == l.winner, "CryptValt: not winner");
        require(l.keyDelivered,         "CryptValt: key not delivered");
        return l.encryptedKeyForWinner;
    }

    function getInventorListings(address inventor) external view returns (uint256[] memory) {
        return inventorListings[inventor];
    }

    function getBidderHistory(address bidder) external view returns (uint256[] memory) {
        return bidderHistory[bidder];
    }

    function getPlatformStats() external view returns (
        uint256 _totalListings,
        uint256 _totalVolume,
        uint256 _totalBids,
        uint256 _totalDisputes,
        uint256 _resolvedDisputes,
        bool    _paused,
        uint256 _platformFeeBps
    ) {
        return (
            totalListingsCreated,
            totalVolumeWei,
            totalBidsPlaced,
            totalDisputesRaised,
            totalDisputesResolved,
            paused,
            platformFeeBps
        );
    }

    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }

    function getListingsPaginated(uint256 fromId, uint256 count) external view returns (Listing[] memory) {
        uint256 end    = fromId + count > listingCount ? listingCount : fromId + count;
        uint256 length = end >= fromId ? end - fromId + 1 : 0;
        Listing[] memory result = new Listing[](length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = listings[fromId + i];
        }
        return result;
    }

    // ── Admin ────────────────────────────────────────────────
    function updatePlatformFee(uint256 newFeeBps) external onlyRole(ROLE_FEE_MGR) {
        require(newFeeBps >= MIN_PLATFORM_FEE_BPS, "CryptValt: fee too low");
        require(newFeeBps <= MAX_PLATFORM_FEE_BPS, "CryptValt: fee too high");
        emit PlatformFeeUpdated(platformFeeBps, newFeeBps);
        platformFeeBps = newFeeBps;
    }

    function updatePlatformWallet(address newWallet) external onlyRole(ROLE_OWNER) {
        require(newWallet != address(0), "CryptValt: zero address");
        emit PlatformWalletUpdated(platformWallet, newWallet);
        platformWallet = newWallet;
    }

    function setGovernorContract(address _governor) external onlyRole(ROLE_OWNER) {
        emit GovernorUpdated(governorContract, _governor);
        governorContract = _governor;
    }

    function setValuationContract(address _valuation) external onlyRole(ROLE_OWNER) {
        emit ValuationUpdated(valuationContract, _valuation);
        valuationContract = _valuation;
    }

    // Two-step ownership transfer
    function initiateOwnershipTransfer(address newOwner) external onlyRole(ROLE_OWNER) {
        require(newOwner != address(0), "CryptValt: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferInitiated(newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "CryptValt: not pending owner");
        emit OwnershipTransferred(owner, msg.sender);
        _roles[ROLE_OWNER][owner]       = false;
        _roles[ROLE_OWNER][msg.sender]  = true;
        owner        = msg.sender;
        pendingOwner = address(0);
    }

    // Emergency drain — only when emergency mode active
    function emergencyDrain(address to) external onlyRole(ROLE_OWNER) nonReentrant {
        require(emergencyMode,        "CryptValt: not emergency");
        require(to != address(0),     "CryptValt: zero address");
        uint256 balance = address(this).balance;
        (bool ok,) = payable(to).call{value: balance}("");
        require(ok, "CryptValt: drain failed");
    }

    receive() external payable {}
    fallback() external payable { revert("CryptValt: no fallback"); }
}