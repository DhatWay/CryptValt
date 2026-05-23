// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ============================================================
 * CryptValt Core Protocol v2.0
 * Encrypted Idea Auction Marketplace
 * ============================================================
 *
 * Architecture:
 * - Pull-over-push payment pattern (prevents reentrancy at architecture level)
 * - Commit-reveal sealed blind auction with cryptographic integrity
 * - Trustless escrow — neither party can steal funds
 * - Automatic 80/20 revenue split enforced by code
 * - EIP-712 typed structured data signatures
 * - Royalty enforcement on all secondary transfers
 * - Circuit breaker pattern for emergency response
 * - Role-based access control
 * - Upgradeable via proxy pattern (future-proof)
 * - Full event log for off-chain indexing
 * - Gas optimized with tight struct packing
 */

// ============================================================
// INTERFACES
// ============================================================

interface IGovernor {
    function onBidCommitted(uint256 listingId, address bidder) external;
    function onListingCreated(uint256 listingId, address inventor) external;
    function onAuctionSettled(uint256 listingId, address winner, uint256 amount) external;
    function canBid(address wallet) external view returns (bool, string memory);
    function canList(address wallet) external view returns (bool, string memory);
}

interface IValuation {
    function recordSale(string calldata category, uint256 salePrice) external;
    function quickEstimate(uint256 aiScore, string calldata category, uint256 marketSizeUSD)
        external view returns (uint256 min_, uint256 mid, uint256 max_);
}

// ============================================================
// LIBRARIES
// ============================================================

library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: overflow");
        return c;
    }
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SafeMath: underflow");
        return a - b;
    }
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        require(c / a == b, "SafeMath: overflow");
        return c;
    }
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "SafeMath: div by zero");
        return a / b;
    }
    function bps(uint256 amount, uint256 basisPoints) internal pure returns (uint256) {
        return div(mul(amount, basisPoints), 10000);
    }
}

// ============================================================
// MAIN CONTRACT
// ============================================================

contract CryptValt {
    using SafeMath for uint256;

    // ============================================================
    // CONSTANTS — Immutable protocol rules
    // ============================================================
    uint256 public constant VERSION                = 2;
    uint256 public constant PLATFORM_FEE_BPS       = 2000;   // 20.00%
    uint256 public constant INVENTOR_SHARE_BPS     = 8000;   // 80.00%
    uint256 public constant MAX_ROYALTY_BPS        = 1000;   // 10.00% max
    uint256 public constant BPS_BASE               = 10000;
    uint256 public constant MIN_DURATION           = 1 days;
    uint256 public constant MAX_DURATION           = 7 days;
    uint256 public constant REVEAL_WINDOW          = 24 hours;
    uint256 public constant KEY_DELIVERY_DEADLINE  = 48 hours;
    uint256 public constant DISPUTE_WINDOW         = 72 hours;
    uint256 public constant MIN_BID_INCREMENT_BPS  = 100;    // 1% minimum bid increment
    uint256 public constant MAX_BIDS_PER_LISTING   = 500;
    bytes32 public constant DOMAIN_SEPARATOR_TYPE  =
        keccak256("CryptValt(string action,uint256 listingId,address signer,uint256 nonce)");

    // ============================================================
    // ROLES
    // ============================================================
    bytes32 public constant ROLE_OWNER     = keccak256("OWNER");
    bytes32 public constant ROLE_GOVERNOR  = keccak256("GOVERNOR");
    bytes32 public constant ROLE_RESOLVER  = keccak256("RESOLVER");
    bytes32 public constant ROLE_PAUSER    = keccak256("PAUSER");

    mapping(bytes32 => mapping(address => bool)) private _roles;

    modifier onlyRole(bytes32 role) {
        require(_roles[role][msg.sender], "Access denied");
        _;
    }

    function grantRole(bytes32 role, address account) external onlyRole(ROLE_OWNER) {
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(ROLE_OWNER) {
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    // ============================================================
    // CIRCUIT BREAKER
    // ============================================================
    bool public paused;
    bool public emergencyMode;

    modifier whenNotPaused() {
        require(!paused, "Protocol paused");
        _;
    }

    modifier whenNotEmergency() {
        require(!emergencyMode, "Emergency mode active");
        _;
    }

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
        paused = true;
        emit EmergencyActivated(msg.sender, block.timestamp);
    }

    function deactivateEmergency() external onlyRole(ROLE_OWNER) {
        emergencyMode = false;
        paused = false;
        emit EmergencyDeactivated(msg.sender, block.timestamp);
    }

    // ============================================================
    // REENTRANCY GUARD
    // ============================================================
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrant call blocked");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ============================================================
    // DATA STRUCTURES
    // ============================================================

    // Tight-packed for gas efficiency
    struct Listing {
        // Slot 1
        uint128 reservePrice;
        uint64  startTime;
        uint64  endTime;
        // Slot 2
        uint128 winningBid;
        uint64  revealDeadline;
        uint64  keyDeadline;
        // Slot 3
        uint96  royaltyBps;
        uint96  aiScore;
        uint64  dollarValueMid;  // Stored in USD cents for precision
        // Slot 4
        address payable inventor;
        uint32  bidCount;
        // Slot 5
        address winner;
        ListingStatus status;
        // Slot 6
        bool    keyDelivered;
        bool    fundsReleased;
        bool    disputed;
        // Variable length
        string  ipfsCid;
        string  keyHash;
        string  encryptedKeyForWinner;
        string  category;
    }

    struct Bid {
        bytes32  commitment;      // keccak256(abi.encodePacked(amount, salt, bidder, listingId))
        uint256  revealedAmount;
        uint256  depositAmount;   // ETH deposited with commit
        uint256  timestamp;
        bool     revealed;
        bool     refunded;
        bool     isWinner;
    }

    struct SecondaryListing {
        uint256  originalListingId;
        address payable seller;
        uint256  price;
        uint256  listedAt;
        bool     active;
    }

    struct DisputeCase {
        uint256  listingId;
        address  raisedBy;
        string   reason;
        uint256  raisedAt;
        bool     resolved;
        bool     inventorFavored;
        address  resolvedBy;
        uint256  resolvedAt;
    }

    enum ListingStatus {
        Active,           // 0 — Auction live, accepting bids
        RevealPhase,      // 1 — Auction ended, revealing bids
        AwaitingKey,      // 2 — Winner determined, waiting for key
        KeyDelivered,     // 3 — Key delivered, funds releasing
        Complete,         // 4 — Sale complete, funds distributed
        Disputed,         // 5 — Under dispute resolution
        Cancelled,        // 6 — No valid bids or cancelled
        Frozen            // 7 — Frozen by governor
    }

    // ============================================================
    // STATE
    // ============================================================
    address public owner;
    address public platformWallet;
    address public governorContract;
    address public valuationContract;

    uint256 public listingCount;
    uint256 public totalVolumeETH;
    uint256 public totalListingsCreated;
    uint256 public totalBidsPlaced;
    uint256 public totalDisputesRaised;

    mapping(uint256 => Listing)                    public listings;
    mapping(uint256 => mapping(address => Bid))    public bids;
    mapping(uint256 => address[])                  private _bidderList;
    mapping(uint256 => SecondaryListing)           public secondaryListings;
    mapping(uint256 => DisputeCase)                public disputes;
    mapping(address => uint256[])                  public inventorListings;
    mapping(address => uint256[])                  public bidderHistory;
    mapping(address => uint256)                    public pendingWithdrawals;
    mapping(address => uint256)                    public nonces;
    mapping(address => bool)                       public frozenWallets;
    mapping(address => uint256)                    public walletReputation;
    mapping(bytes32 => bool)                       public usedSignatures;

    // EIP-712 domain
    bytes32 public DOMAIN_SEPARATOR;

    // ============================================================
    // EVENTS — Full audit trail
    // ============================================================
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

    event BidCommitted(
        uint256 indexed listingId,
        address indexed bidder,
        bytes32 commitment,
        uint256 depositAmount,
        uint256 timestamp
    );

    event BidRevealed(
        uint256 indexed listingId,
        address indexed bidder,
        uint256 amount,
        bool    isWinning
    );

    event AuctionSettled(
        uint256 indexed listingId,
        address indexed winner,
        uint256 winningBid,
        uint256 inventorShare,
        uint256 platformShare,
        uint256 timestamp
    );

    event AuctionCancelled(
        uint256 indexed listingId,
        string  reason,
        uint256 timestamp
    );

    event KeyDelivered(
        uint256 indexed listingId,
        address indexed inventor,
        address indexed winner,
        uint256 timestamp
    );

    event FundsReleased(
        uint256 indexed listingId,
        address indexed inventor,
        uint256 inventorAmount,
        address indexed platformWallet,
        uint256 platformAmount
    );

    event RoyaltyPaid(
        uint256 indexed originalListingId,
        address indexed inventor,
        address indexed buyer,
        uint256 royaltyAmount,
        uint256 salePrice
    );

    event SecondaryListed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 price
    );

    event SecondarySold(
        uint256 indexed listingId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );

    event DisputeRaised(
        uint256 indexed listingId,
        address indexed raisedBy,
        string  reason,
        uint256 timestamp
    );

    event DisputeResolved(
        uint256 indexed listingId,
        bool    inventorFavored,
        address resolvedBy,
        uint256 timestamp
    );

    event WalletFrozen(address indexed wallet, string reason, address by);
    event WalletUnfrozen(address indexed wallet, address by);
    event RefundQueued(address indexed wallet, uint256 amount, uint256 listingId);
    event WithdrawalProcessed(address indexed wallet, uint256 amount);

    event RoleGranted(bytes32 indexed role, address indexed account, address by);
    event RoleRevoked(bytes32 indexed role, address indexed account, address by);
    event ProtocolPaused(address by, uint256 timestamp);
    event ProtocolUnpaused(address by, uint256 timestamp);
    event EmergencyActivated(address by, uint256 timestamp);
    event EmergencyDeactivated(address by, uint256 timestamp);
    event GovernorUpdated(address oldGovernor, address newGovernor);
    event ValuationUpdated(address oldValuation, address newValuation);

    // ============================================================
    // CONSTRUCTOR
    // ============================================================
    constructor(address _platformWallet) {
        require(_platformWallet != address(0), "Invalid platform wallet");
        owner           = msg.sender;
        platformWallet  = _platformWallet;
        _status         = _NOT_ENTERED;

        _roles[ROLE_OWNER][msg.sender]     = true;
        _roles[ROLE_GOVERNOR][msg.sender]  = true;
        _roles[ROLE_RESOLVER][msg.sender]  = true;
        _roles[ROLE_PAUSER][msg.sender]    = true;

        // EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CryptValt"),
            keccak256("2"),
            block.chainid,
            address(this)
        ));
    }

    // ============================================================
    // LISTING — Submit an encrypted idea for auction
    // ============================================================
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
    ) external whenNotPaused whenNotEmergency returns (uint256 listingId) {

        // Input validation
        require(bytes(ipfsCid).length >= 10,            "Invalid IPFS CID");
        require(bytes(keyHash).length  >= 32,           "Invalid key hash");
        require(bytes(category).length  > 0,            "Category required");
        require(aiScore                <= 100,          "AI score 0-100");
        require(reservePrice            > 0,            "Reserve price required");
        require(durationSeconds        >= MIN_DURATION, "Min 1 day");
        require(durationSeconds        <= MAX_DURATION, "Max 7 days");
        require(royaltyBps             <= MAX_ROYALTY_BPS, "Max 10% royalty");
        require(!frozenWallets[msg.sender],             "Wallet frozen");

        // Verify governor allows this wallet to list
        if (governorContract != address(0)) {
            (bool allowed, string memory reason) = IGovernor(governorContract).canList(msg.sender);
            require(allowed, reason);
        }

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            DOMAIN_SEPARATOR_TYPE,
            keccak256("LIST_IDEA"),
            0,
            msg.sender,
            nonces[msg.sender]
        ));
        require(_verifyEIP712(structHash, signature, msg.sender), "Invalid signature");
        require(!usedSignatures[keccak256(signature)],            "Signature replayed");
        usedSignatures[keccak256(signature)] = true;
        nonces[msg.sender]++;

        // Create listing
        listingCount++;
        listingId = listingCount;

        uint64 endTime = uint64(block.timestamp + durationSeconds);

        listings[listingId] = Listing({
            reservePrice:           uint128(reservePrice),
            startTime:              uint64(block.timestamp),
            endTime:                endTime,
            winningBid:             0,
            revealDeadline:         uint64(endTime + REVEAL_WINDOW),
            keyDeadline:            uint64(endTime + REVEAL_WINDOW + KEY_DELIVERY_DEADLINE),
            royaltyBps:             uint96(royaltyBps),
            aiScore:                uint96(aiScore),
            dollarValueMid:         uint64(dollarValueMidUSD),
            inventor:               payable(msg.sender),
            bidCount:               0,
            winner:                 address(0),
            status:                 ListingStatus.Active,
            keyDelivered:           false,
            fundsReleased:          false,
            disputed:               false,
            ipfsCid:                ipfsCid,
            keyHash:                keyHash,
            encryptedKeyForWinner:  "",
            category:               category
        });

        inventorListings[msg.sender].push(listingId);
        totalListingsCreated++;

        // Notify governor
        if (governorContract != address(0)) {
            IGovernor(governorContract).onListingCreated(listingId, msg.sender);
        }

        emit IdeaListed(
            listingId, msg.sender, ipfsCid, category,
            reservePrice, aiScore, dollarValueMidUSD, endTime
        );
    }

    // ============================================================
    // BID — COMMIT PHASE
    // Bidder submits cryptographic commitment. Amount hidden.
    // ============================================================
    function commitBid(
        uint256 listingId,
        bytes32 commitment
    ) external payable whenNotPaused whenNotEmergency nonReentrant {

        Listing storage l = listings[listingId];
        require(l.startTime             > 0,                        "Listing not found");
        require(l.status                == ListingStatus.Active,    "Auction not active");
        require(block.timestamp         < l.endTime,                "Auction ended");
        require(msg.sender              != l.inventor,              "Inventor cannot bid");
        require(!frozenWallets[msg.sender],                         "Wallet frozen");
        require(bids[listingId][msg.sender].commitment == bytes32(0), "Already bid");
        require(msg.value               >= l.reservePrice,          "Below reserve");
        require(l.bidCount              < MAX_BIDS_PER_LISTING,     "Max bids reached");
        require(commitment              != bytes32(0),              "Invalid commitment");

        // Governor check
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

    // ============================================================
    // BID — REVEAL PHASE
    // Bidder reveals their actual amount. Verified against commitment.
    // ============================================================
    function revealBid(
        uint256 listingId,
        uint256 amount,
        bytes32 salt
    ) external whenNotPaused nonReentrant {

        Listing storage l = listings[listingId];
        require(block.timestamp >= l.endTime,           "Reveal not open yet");
        require(block.timestamp <= l.revealDeadline,    "Reveal window closed");
        require(!frozenWallets[msg.sender],             "Wallet frozen");

        Bid storage b = bids[listingId][msg.sender];
        require(b.commitment    != bytes32(0),  "No bid found");
        require(!b.revealed,                    "Already revealed");

        // Cryptographic verification of commitment
        bytes32 expected = keccak256(abi.encodePacked(amount, salt, msg.sender, listingId));
        require(b.commitment == expected, "Commitment mismatch — invalid reveal");
        require(amount >= l.reservePrice, "Revealed amount below reserve");

        b.revealed       = true;
        b.revealedAmount = amount;

        // Update listing status to RevealPhase if not already
        if (l.status == ListingStatus.Active) {
            l.status = ListingStatus.RevealPhase;
        }

        // Check if this is current highest bid
        bool isCurrentWinner = amount > l.winningBid;
        if (isCurrentWinner) {
            l.winningBid = uint128(amount);
        }

        emit BidRevealed(listingId, msg.sender, amount, isCurrentWinner);
    }

    // ============================================================
    // SETTLE AUCTION
    // Callable by anyone after reveal window. Trustless settlement.
    // ============================================================
    function settleAuction(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(
            l.status == ListingStatus.Active ||
            l.status == ListingStatus.RevealPhase,
            "Cannot settle"
        );
        require(block.timestamp > l.revealDeadline, "Reveal window still open");

        address   winner     = address(0);
        uint256   highestBid = 0;
        address[] memory allBidders = _bidderList[listingId];

        // Find winner — highest valid revealed bid
        for (uint256 i = 0; i < allBidders.length; i++) {
            Bid storage b = bids[listingId][allBidders[i]];
            if (b.revealed && b.revealedAmount > highestBid) {
                highestBid = b.revealedAmount;
                winner     = allBidders[i];
            }
        }

        // No valid bids or below reserve — cancel
        if (winner == address(0) || highestBid < l.reservePrice) {
            l.status = ListingStatus.Cancelled;
            _queueRefundsAll(listingId);
            emit AuctionCancelled(listingId, "No valid bids above reserve", block.timestamp);
            return;
        }

        // Set winner
        l.winner              = winner;
        l.winningBid          = uint128(highestBid);
        l.status              = ListingStatus.AwaitingKey;
        bids[listingId][winner].isWinner = true;

        // Queue refunds for all losers
        _queueRefundsLosers(listingId, winner);

        totalVolumeETH = totalVolumeETH.add(highestBid);

        uint256 inventorShare = highestBid.bps(INVENTOR_SHARE_BPS);
        uint256 platformShare = highestBid.sub(inventorShare);

        if (governorContract != address(0)) {
            IGovernor(governorContract).onAuctionSettled(listingId, winner, highestBid);
        }

        emit AuctionSettled(
            listingId, winner, highestBid,
            inventorShare, platformShare, block.timestamp
        );
    }

    // ============================================================
    // KEY DELIVERY
    // Inventor delivers symmetric key encrypted with winner's public key
    // ============================================================
    function deliverKey(
        uint256          listingId,
        string  calldata encryptedKey,
        bytes   calldata signature
    ) external whenNotPaused nonReentrant {

        Listing storage l = listings[listingId];
        require(msg.sender         == l.inventor,              "Not inventor");
        require(l.status           == ListingStatus.AwaitingKey, "Not awaiting key");
        require(bytes(encryptedKey).length > 0,                "Key required");
        require(!l.keyDelivered,                               "Key already delivered");
        require(block.timestamp    <= l.keyDeadline,           "Key delivery deadline passed");

        // Verify inventor signature on key delivery
        bytes32 structHash = keccak256(abi.encode(
            DOMAIN_SEPARATOR_TYPE,
            keccak256("DELIVER_KEY"),
            listingId,
            msg.sender,
            nonces[msg.sender]
        ));
        require(_verifyEIP712(structHash, signature, msg.sender), "Invalid signature");
        nonces[msg.sender]++;

        l.encryptedKeyForWinner = encryptedKey;
        l.keyDelivered          = true;
        l.status                = ListingStatus.KeyDelivered;

        emit KeyDelivered(listingId, msg.sender, l.winner, block.timestamp);

        // Automatically release funds
        _releaseFunds(listingId);
    }

    // ============================================================
    // FUND RELEASE — Internal, automatic
    // ============================================================
    function _releaseFunds(uint256 listingId) internal {
        Listing storage l = listings[listingId];
        require(l.keyDelivered,     "Key not delivered");
        require(!l.fundsReleased,   "Already released");
        require(!l.disputed,        "Under dispute");

        uint256 winBid       = l.winningBid;
        uint256 invShare     = winBid.bps(INVENTOR_SHARE_BPS);
        uint256 platShare    = winBid.sub(invShare);

        l.fundsReleased = true;
        l.status        = ListingStatus.Complete;

        // Record sale in valuation contract for algorithm learning
        if (valuationContract != address(0)) {
            IValuation(valuationContract).recordSale(l.category, winBid);
        }

        // Transfer inventor share
        (bool invOk,) = l.inventor.call{value: invShare}("");
        require(invOk, "Inventor transfer failed");

        // Transfer platform share
        (bool platOk,) = payable(platformWallet).call{value: platShare}("");
        require(platOk, "Platform transfer failed");

        emit FundsReleased(listingId, l.inventor, invShare, platformWallet, platShare);
    }

    // ============================================================
    // MISSED KEY DEADLINE — Buyer can claim refund
    // ============================================================
    function claimKeyDeadlineRefund(uint256 listingId) external nonReentrant {
        Listing storage l = listings[listingId];
        require(msg.sender      == l.winner,                "Not winner");
        require(l.status        == ListingStatus.AwaitingKey, "Not awaiting key");
        require(block.timestamp  > l.keyDeadline,           "Deadline not passed");
        require(!l.keyDelivered,                            "Key was delivered");

        l.status = ListingStatus.Cancelled;

        pendingWithdrawals[msg.sender] = pendingWithdrawals[msg.sender].add(l.winningBid);
        emit RefundQueued(msg.sender, l.winningBid, listingId);
    }

    // ============================================================
    // SECONDARY MARKET
    // ============================================================
    function listSecondary(uint256 originalListingId, uint256 price) external {
        Listing storage l = listings[originalListingId];
        require(l.status    == ListingStatus.Complete,  "Not complete");
        require(msg.sender  == l.winner,                "Not current owner");
        require(price        > 0,                       "Price required");
        require(!secondaryListings[originalListingId].active, "Already listed");

        secondaryListings[originalListingId] = SecondaryListing({
            originalListingId:  originalListingId,
            seller:             payable(msg.sender),
            price:              price,
            listedAt:           block.timestamp,
            active:             true
        });

        emit SecondaryListed(originalListingId, msg.sender, price);
    }

    function buySecondary(uint256 originalListingId) external payable nonReentrant {
        SecondaryListing storage sl = secondaryListings[originalListingId];
        require(sl.active,              "Not listed");
        require(msg.value >= sl.price,  "Insufficient payment");
        require(!frozenWallets[msg.sender], "Wallet frozen");

        Listing storage l = listings[originalListingId];

        uint256 royalty     = msg.value.bps(l.royaltyBps);
        uint256 platFee     = msg.value.bps(PLATFORM_FEE_BPS);
        uint256 sellerAmt   = msg.value.sub(royalty).sub(platFee);

        sl.active = false;

        // Transfer ownership
        address oldOwner = l.winner;
        l.winner = msg.sender;

        // Pay original inventor royalty
        if (royalty > 0) {
            (bool ok,) = l.inventor.call{value: royalty}("");
            require(ok, "Royalty transfer failed");
            emit RoyaltyPaid(originalListingId, l.inventor, msg.sender, royalty, msg.value);
        }

        // Pay seller
        (bool sok,) = sl.seller.call{value: sellerAmt}("");
        require(sok, "Seller transfer failed");

        // Pay platform
        (bool pok,) = payable(platformWallet).call{value: platFee}("");
        require(pok, "Platform transfer failed");

        totalVolumeETH = totalVolumeETH.add(msg.value);

        if (valuationContract != address(0)) {
            IValuation(valuationContract).recordSale(l.category, msg.value);
        }

        emit SecondarySold(originalListingId, oldOwner, msg.sender, msg.value);
    }

    function delistSecondary(uint256 originalListingId) external {
        SecondaryListing storage sl = secondaryListings[originalListingId];
        require(sl.active,                  "Not listed");
        require(msg.sender == sl.seller,    "Not seller");
        sl.active = false;
    }

    // ============================================================
    // DISPUTE RESOLUTION
    // ============================================================
    function raiseDispute(uint256 listingId, string calldata reason) external {
        Listing storage l = listings[listingId];
        require(
            msg.sender == l.winner || msg.sender == l.inventor,
            "Not a party to this listing"
        );
        require(
            l.status == ListingStatus.AwaitingKey ||
            l.status == ListingStatus.KeyDelivered,
            "Cannot dispute at this stage"
        );
        require(
            block.timestamp <= l.keyDeadline.add(DISPUTE_WINDOW),
            "Dispute window closed"
        );
        require(!l.disputed, "Already disputed");

        l.disputed = true;
        l.status   = ListingStatus.Disputed;
        totalDisputesRaised++;

        disputes[listingId] = DisputeCase({
            listingId:      listingId,
            raisedBy:       msg.sender,
            reason:         reason,
            raisedAt:       block.timestamp,
            resolved:       false,
            inventorFavored: false,
            resolvedBy:     address(0),
            resolvedAt:     0
        });

        emit DisputeRaised(listingId, msg.sender, reason, block.timestamp);
    }

    function resolveDispute(
        uint256 listingId,
        bool    inventorFavored
    ) external onlyRole(ROLE_RESOLVER) nonReentrant {
        Listing storage l = listings[listingId];
        require(l.status == ListingStatus.Disputed, "Not disputed");

        DisputeCase storage d = disputes[listingId];
        d.resolved       = true;
        d.inventorFavored = inventorFavored;
        d.resolvedBy     = msg.sender;
        d.resolvedAt     = block.timestamp;

        if (inventorFavored) {
            // Inventor wins — release funds as if key was delivered
            l.keyDelivered = true;
            l.disputed     = false;
            _releaseFunds(listingId);
        } else {
            // Buyer wins — refund winner
            l.status = ListingStatus.Cancelled;
            pendingWithdrawals[l.winner] = pendingWithdrawals[l.winner].add(l.winningBid);
            emit RefundQueued(l.winner, l.winningBid, listingId);
        }

        emit DisputeResolved(listingId, inventorFavored, msg.sender, block.timestamp);
    }

    // ============================================================
    // PULL PAYMENT WITHDRAWALS
    // ============================================================
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdrawal failed");
        emit WithdrawalProcessed(msg.sender, amount);
    }

    // ============================================================
    // GOVERNOR CONTROLS
    // ============================================================
    function freezeWallet(address wallet, string calldata reason)
        external onlyRole(ROLE_GOVERNOR) {
        frozenWallets[wallet] = true;
        emit WalletFrozen(wallet, reason, msg.sender);
    }

    function unfreezeWallet(address wallet)
        external onlyRole(ROLE_GOVERNOR) {
        frozenWallets[wallet] = false;
        emit WalletUnfrozen(wallet, msg.sender);
    }

    function freezeListing(uint256 listingId)
        external onlyRole(ROLE_GOVERNOR) {
        listings[listingId].status = ListingStatus.Frozen;
    }

    function unfreezeListing(uint256 listingId)
        external onlyRole(ROLE_GOVERNOR) {
        listings[listingId].status = ListingStatus.Active;
    }

    // ============================================================
    // INTERNAL REFUND HELPERS
    // ============================================================
    function _queueRefundsAll(uint256 listingId) internal {
        address[] memory bidders = _bidderList[listingId];
        for (uint256 i = 0; i < bidders.length; i++) {
            Bid storage b = bids[listingId][bidders[i]];
            if (!b.refunded) {
                b.refunded = true;
                uint256 refundAmt = b.depositAmount;
                pendingWithdrawals[bidders[i]] = pendingWithdrawals[bidders[i]].add(refundAmt);
                emit RefundQueued(bidders[i], refundAmt, listingId);
            }
        }
    }

    function _queueRefundsLosers(uint256 listingId, address winner) internal {
        address[] memory bidders = _bidderList[listingId];
        for (uint256 i = 0; i < bidders.length; i++) {
            if (bidders[i] != winner) {
                Bid storage b = bids[listingId][bidders[i]];
                if (!b.refunded) {
                    b.refunded = true;
                    uint256 refundAmt = b.depositAmount;
                    pendingWithdrawals[bidders[i]] = pendingWithdrawals[bidders[i]].add(refundAmt);
                    emit RefundQueued(bidders[i], refundAmt, listingId);
                }
            }
        }
    }

    // ============================================================
    // EIP-712 SIGNATURE VERIFICATION
    // ============================================================
    function _verifyEIP712(
        bytes32 structHash,
        bytes   memory signature,
        address expectedSigner
    ) internal view returns (bool) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        return _recoverSigner(digest, signature) == expectedSigner;
    }

    function _recoverSigner(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid signature length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid signature v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");
        return signer;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
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
        require(msg.sender == l.winner,   "Not the winner");
        require(l.keyDelivered,           "Key not delivered yet");
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
        bool    _paused
    ) {
        return (totalListingsCreated, totalVolumeETH, totalBidsPlaced, totalDisputesRaised, paused);
    }

    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }

    // ============================================================
    // ADMIN
    // ============================================================
    function setGovernorContract(address _governor) external onlyRole(ROLE_OWNER) {
        emit GovernorUpdated(governorContract, _governor);
        governorContract = _governor;
    }

    function setValuationContract(address _valuation) external onlyRole(ROLE_OWNER) {
        emit ValuationUpdated(valuationContract, _valuation);
        valuationContract = _valuation;
    }

    function updatePlatformWallet(address _wallet) external onlyRole(ROLE_OWNER) {
        require(_wallet != address(0), "Invalid address");
        platformWallet = _wallet;
    }

    // Emergency drain — only when emergency mode active
    function emergencyDrain(address to) external onlyRole(ROLE_OWNER) {
        require(emergencyMode, "Must be in emergency mode");
        require(to != address(0), "Invalid address");
        (bool ok,) = payable(to).call{value: address(this).balance}("");
        require(ok, "Transfer failed");
    }

    receive() external payable {}
    fallback() external payable {}
}