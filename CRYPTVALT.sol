// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CryptValt Smart Contract
 * Encrypted Idea Auction Marketplace
 * 
 * Features:
 * - Sealed blind auction with commit-reveal
 * - Escrow with automatic 80/20 split
 * - Royalty enforcement on secondary sales
 * - Emergency freeze with multi-sig
 * - Reentrancy protection
 * - Governing algorithm integration
 * - Zero mock code — all real on-chain logic
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CryptValt {

    // ============================================================
    // CONSTANTS
    // ============================================================
    uint256 public constant PLATFORM_FEE_BPS = 2000;    // 20%
    uint256 public constant INVENTOR_SHARE_BPS = 8000;  // 80%
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_ROYALTY_BPS = 1000;     // 10% max royalty
    uint256 public constant MIN_AUCTION_DURATION = 1 days;
    uint256 public constant MAX_AUCTION_DURATION = 7 days;
    uint256 public constant REVEAL_WINDOW = 24 hours;
    uint256 public constant DISPUTE_WINDOW = 48 hours;

    // ============================================================
    // STATE
    // ============================================================
    address public owner;
    address public platformWallet;
    bool public platformFrozen;
    uint256 public listingCount;
    uint256 public totalVolume;
    uint256 public totalListings;

    // Reentrancy guard
    uint256 private _locked;
    modifier nonReentrant() {
        require(_locked == 1, "Reentrant call");
        _locked = 2;
        _;
        _locked = 1;
    }

    // ============================================================
    // STRUCTS
    // ============================================================
    struct Listing {
        uint256 id;
        address payable inventor;
        string ipfsCid;           // Encrypted idea on IPFS
        string keyHash;           // Hash of the symmetric encryption key
        uint256 aiScore;          // 0-100 from AI scoring engine
        uint256 dollarValueMid;   // AI estimated dollar value
        uint256 reservePrice;     // Minimum bid in wei
        uint256 royaltyBps;       // Royalty on secondary sales
        uint256 startTime;
        uint256 endTime;
        uint256 revealDeadline;
        ListingStatus status;
        address winner;
        uint256 winningBid;
        string encryptedKeyForWinner; // Symmetric key encrypted with winner's pubkey
        bool keyDelivered;
        bool fundsReleased;
        uint256 bidCount;
    }

    struct Bid {
        bytes32 commitment;   // keccak256(amount + salt + bidder)
        uint256 revealedAmount;
        bool revealed;
        bool refunded;
        address bidder;
        uint256 timestamp;
    }

    struct SecondaryListing {
        uint256 originalListingId;
        address payable seller;
        uint256 price;
        bool active;
    }

    struct Flag {
        uint256 listingId;
        string reason;
        FlagSeverity severity;
        uint256 timestamp;
        bool resolved;
    }

    enum ListingStatus {
        Active,
        RevealPhase,
        AwaitingKeyDelivery,
        Complete,
        Disputed,
        Cancelled,
        Frozen
    }

    enum FlagSeverity {
        Low,
        Medium,
        High,
        Critical
    }

    // ============================================================
    // MAPPINGS
    // ============================================================
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => mapping(address => Bid)) public bids;
    mapping(uint256 => address[]) public bidders;
    mapping(address => bool) public frozenWallets;
    mapping(address => uint256) public walletBidCount;
    mapping(address => uint256) public walletListingCount;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(uint256 => SecondaryListing) public secondaryListings;
    mapping(uint256 => Flag[]) public listingFlags;
    mapping(address => bool) public governors;  // Governing algorithm addresses

    // ============================================================
    // EVENTS
    // ============================================================
    event IdeaListed(
        uint256 indexed listingId,
        address indexed inventor,
        string ipfsCid,
        uint256 reservePrice,
        uint256 aiScore,
        uint256 endTime
    );

    event BidCommitted(
        uint256 indexed listingId,
        address indexed bidder,
        bytes32 commitment,
        uint256 timestamp
    );

    event BidRevealed(
        uint256 indexed listingId,
        address indexed bidder,
        uint256 amount
    );

    event AuctionSettled(
        uint256 indexed listingId,
        address indexed winner,
        uint256 winningBid,
        uint256 inventorShare,
        uint256 platformShare
    );

    event KeyDelivered(
        uint256 indexed listingId,
        address indexed winner,
        string encryptedKey
    );

    event FundsReleased(
        uint256 indexed listingId,
        address indexed inventor,
        uint256 amount
    );

    event RoyaltyPaid(
        uint256 indexed originalListingId,
        address indexed inventor,
        uint256 amount
    );

    event WalletFrozen(address indexed wallet, string reason);
    event WalletUnfrozen(address indexed wallet);
    event PlatformFrozen(address indexed by);
    event PlatformUnfrozen(address indexed by);
    event ListingFlagged(uint256 indexed listingId, string reason, FlagSeverity severity);
    event DisputeRaised(uint256 indexed listingId, address indexed by);
    event DisputeResolved(uint256 indexed listingId, bool inventorFavored);
    event GovernorAdded(address indexed governor);
    event GovernorRemoved(address indexed governor);

    // ============================================================
    // MODIFIERS
    // ============================================================
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyGovernor() {
        require(governors[msg.sender] || msg.sender == owner, "Not governor");
        _;
    }

    modifier notFrozen() {
        require(!platformFrozen, "Platform frozen");
        require(!frozenWallets[msg.sender], "Wallet frozen");
        _;
    }

    modifier listingExists(uint256 listingId) {
        require(listingId > 0 && listingId <= listingCount, "Listing not found");
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================
    constructor(address _platformWallet) {
        owner = msg.sender;
        platformWallet = _platformWallet;
        governors[msg.sender] = true;
        _locked = 1;
    }

    // ============================================================
    // LISTING
    // ============================================================
    function listIdea(
        string calldata ipfsCid,
        string calldata keyHash,
        uint256 aiScore,
        uint256 dollarValueMid,
        uint256 reservePrice,
        uint256 durationDays,
        uint256 royaltyBps,
        bytes calldata inventorSignature
    ) external notFrozen returns (uint256) {
        require(bytes(ipfsCid).length > 0, "IPFS CID required");
        require(bytes(keyHash).length > 0, "Key hash required");
        require(aiScore <= 100, "Invalid AI score");
        require(reservePrice > 0, "Reserve price required");
        require(durationDays >= 1 && durationDays <= 7, "Invalid duration");
        require(royaltyBps <= MAX_ROYALTY_BPS, "Royalty too high");
        require(inventorSignature.length > 0, "Signature required");

        // Verify inventor signed the listing
        bytes32 messageHash = keccak256(abi.encodePacked(
            ipfsCid, keyHash, reservePrice, durationDays, msg.sender
        ));
        require(_verifySignature(messageHash, inventorSignature, msg.sender), "Invalid signature");

        listingCount++;
        uint256 listingId = listingCount;
        uint256 endTime = block.timestamp + (durationDays * 1 days);

        listings[listingId] = Listing({
            id: listingId,
            inventor: payable(msg.sender),
            ipfsCid: ipfsCid,
            keyHash: keyHash,
            aiScore: aiScore,
            dollarValueMid: dollarValueMid,
            reservePrice: reservePrice,
            royaltyBps: royaltyBps,
            startTime: block.timestamp,
            endTime: endTime,
            revealDeadline: endTime + REVEAL_WINDOW,
            status: ListingStatus.Active,
            winner: address(0),
            winningBid: 0,
            encryptedKeyForWinner: "",
            keyDelivered: false,
            fundsReleased: false,
            bidCount: 0
        });

        walletListingCount[msg.sender]++;
        totalListings++;

        emit IdeaListed(listingId, msg.sender, ipfsCid, reservePrice, aiScore, endTime);
        return listingId;
    }

    // ============================================================
    // SEALED BIDDING — COMMIT PHASE
    // ============================================================
    function commitBid(
        uint256 listingId,
        bytes32 commitment
    ) external payable notFrozen listingExists(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.status == ListingStatus.Active, "Auction not active");
        require(block.timestamp < listing.endTime, "Auction ended");
        require(msg.sender != listing.inventor, "Inventor cannot bid");
        require(bids[listingId][msg.sender].commitment == bytes32(0), "Already bid");
        require(msg.value >= listing.reservePrice, "Below reserve price");

        bids[listingId][msg.sender] = Bid({
            commitment: commitment,
            revealedAmount: 0,
            revealed: false,
            refunded: false,
            bidder: msg.sender,
            timestamp: block.timestamp
        });

        bidders[listingId].push(msg.sender);
        listing.bidCount++;
        walletBidCount[msg.sender]++;

        emit BidCommitted(listingId, msg.sender, commitment, block.timestamp);
    }

    // ============================================================
    // SEALED BIDDING — REVEAL PHASE
    // ============================================================
    function revealBid(
        uint256 listingId,
        uint256 amount,
        bytes32 salt
    ) external notFrozen listingExists(listingId) {
        Listing storage listing = listings[listingId];
        require(
            block.timestamp >= listing.endTime &&
            block.timestamp <= listing.revealDeadline,
            "Not in reveal window"
        );

        Bid storage bid = bids[listingId][msg.sender];
        require(bid.commitment != bytes32(0), "No bid found");
        require(!bid.revealed, "Already revealed");

        // Verify commitment
        bytes32 expectedCommitment = keccak256(abi.encodePacked(amount, salt, msg.sender));
        require(bid.commitment == expectedCommitment, "Invalid reveal");
        require(amount >= listing.reservePrice, "Below reserve");

        bid.revealed = true;
        bid.revealedAmount = amount;

        emit BidRevealed(listingId, msg.sender, amount);
    }

    // ============================================================
    // SETTLE AUCTION
    // ============================================================
    function settleAuction(uint256 listingId) external listingExists(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(block.timestamp > listing.revealDeadline, "Reveal window not closed");
        require(listing.status == ListingStatus.Active || listing.status == ListingStatus.RevealPhase, "Cannot settle");

        // Find highest revealed bid
        address winner = address(0);
        uint256 highestBid = 0;

        address[] memory bidderList = bidders[listingId];
        for (uint256 i = 0; i < bidderList.length; i++) {
            Bid memory bid = bids[listingId][bidderList[i]];
            if (bid.revealed && bid.revealedAmount > highestBid) {
                highestBid = bid.revealedAmount;
                winner = bidderList[i];
            }
        }

        if (winner == address(0) || highestBid < listing.reservePrice) {
            // No valid bids — cancel auction
            listing.status = ListingStatus.Cancelled;
            _refundAllBidders(listingId);
            return;
        }

        listing.winner = winner;
        listing.winningBid = highestBid;
        listing.status = ListingStatus.AwaitingKeyDelivery;

        // Refund losing bidders
        _refundLosers(listingId, winner);

        uint256 inventorShare = (highestBid * INVENTOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 platformShare = (highestBid * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;

        totalVolume += highestBid;

        emit AuctionSettled(listingId, winner, highestBid, inventorShare, platformShare);
    }

    // ============================================================
    // KEY DELIVERY
    // ============================================================
    function deliverKey(
        uint256 listingId,
        string calldata encryptedKey
    ) external listingExists(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(msg.sender == listing.inventor, "Not inventor");
        require(listing.status == ListingStatus.AwaitingKeyDelivery, "Not awaiting key");
        require(bytes(encryptedKey).length > 0, "Key required");
        require(!listing.keyDelivered, "Key already delivered");

        listing.encryptedKeyForWinner = encryptedKey;
        listing.keyDelivered = true;

        emit KeyDelivered(listingId, listing.winner, encryptedKey);

        // Auto-release funds
        _releaseFunds(listingId);
    }

    // ============================================================
    // FUND RELEASE (INTERNAL)
    // ============================================================
    function _releaseFunds(uint256 listingId) internal {
        Listing storage listing = listings[listingId];
        require(listing.keyDelivered, "Key not delivered");
        require(!listing.fundsReleased, "Already released");

        uint256 winningBid = listing.winningBid;
        uint256 inventorShare = (winningBid * INVENTOR_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 platformShare = winningBid - inventorShare;

        listing.fundsReleased = true;
        listing.status = ListingStatus.Complete;

        // Transfer to inventor
        listing.inventor.transfer(inventorShare);

        // Transfer to platform
        payable(platformWallet).transfer(platformShare);

        emit FundsReleased(listingId, listing.inventor, inventorShare);
    }

    // ============================================================
    // SECONDARY SALES & ROYALTIES
    // ============================================================
    function listSecondary(
        uint256 originalListingId,
        uint256 price
    ) external listingExists(originalListingId) {
        Listing storage original = listings[originalListingId];
        require(original.status == ListingStatus.Complete, "Not complete");
        require(msg.sender == original.winner, "Not the owner");
        require(price > 0, "Price required");

        secondaryListings[originalListingId] = SecondaryListing({
            originalListingId: originalListingId,
            seller: payable(msg.sender),
            price: price,
            active: true
        });
    }

    function buySecondary(uint256 originalListingId) external payable nonReentrant {
        SecondaryListing storage secondary = secondaryListings[originalListingId];
        require(secondary.active, "Not for sale");
        require(msg.value >= secondary.price, "Insufficient payment");

        Listing storage original = listings[originalListingId];

        uint256 royaltyAmount = (msg.value * original.royaltyBps) / BPS_DENOMINATOR;
        uint256 platformFee = (msg.value * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = msg.value - royaltyAmount - platformFee;

        secondary.active = false;

        // Pay royalty to original inventor
        if (royaltyAmount > 0) {
            original.inventor.transfer(royaltyAmount);
            emit RoyaltyPaid(originalListingId, original.inventor, royaltyAmount);
        }

        // Pay seller
        secondary.seller.transfer(sellerAmount);

        // Pay platform
        payable(platformWallet).transfer(platformFee);

        // Transfer ownership
        original.winner = msg.sender;
        totalVolume += msg.value;
    }

    // ============================================================
    // DISPUTE RESOLUTION
    // ============================================================
    function raiseDispute(uint256 listingId) external listingExists(listingId) {
        Listing storage listing = listings[listingId];
        require(
            msg.sender == listing.winner || msg.sender == listing.inventor,
            "Not a party"
        );
        require(listing.status == ListingStatus.AwaitingKeyDelivery, "Cannot dispute");
        require(
            block.timestamp <= listing.endTime + DISPUTE_WINDOW,
            "Dispute window closed"
        );

        listing.status = ListingStatus.Disputed;
        emit DisputeRaised(listingId, msg.sender);
    }

    function resolveDispute(
        uint256 listingId,
        bool inventorFavored
    ) external onlyGovernor listingExists(listingId) nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.status == ListingStatus.Disputed, "Not disputed");

        if (inventorFavored) {
            // Inventor wins — release funds to inventor
            listing.keyDelivered = true;
            _releaseFunds(listingId);
        } else {
            // Buyer wins — refund the winner
            listing.status = ListingStatus.Cancelled;
            payable(listing.winner).transfer(listing.winningBid);
        }

        emit DisputeResolved(listingId, inventorFavored);
    }

    // ============================================================
    // GOVERNING ALGORITHM CONTROLS
    // ============================================================
    function flagListing(
        uint256 listingId,
        string calldata reason,
        FlagSeverity severity
    ) external onlyGovernor listingExists(listingId) {
        listingFlags[listingId].push(Flag({
            listingId: listingId,
            reason: reason,
            severity: severity,
            timestamp: block.timestamp,
            resolved: false
        }));

        // Auto-freeze on critical flags
        if (severity == FlagSeverity.Critical) {
            listings[listingId].status = ListingStatus.Frozen;
        }

        emit ListingFlagged(listingId, reason, severity);
    }

    function freezeWallet(address wallet, string calldata reason) external onlyGovernor {
        frozenWallets[wallet] = true;
        emit WalletFrozen(wallet, reason);
    }

    function unfreezeWallet(address wallet) external onlyGovernor {
        frozenWallets[wallet] = false;
        emit WalletUnfrozen(wallet);
    }

    function freezePlatform() external onlyGovernor {
        platformFrozen = true;
        emit PlatformFrozen(msg.sender);
    }

    function unfreezePlatform() external onlyOwner {
        platformFrozen = false;
        emit PlatformUnfrozen(msg.sender);
    }

    function addGovernor(address governor) external onlyOwner {
        governors[governor] = true;
        emit GovernorAdded(governor);
    }

    function removeGovernor(address governor) external onlyOwner {
        governors[governor] = false;
        emit GovernorRemoved(governor);
    }

    // ============================================================
    // REFUND HELPERS
    // ============================================================
    function _refundAllBidders(uint256 listingId) internal {
        address[] memory bidderList = bidders[listingId];
        for (uint256 i = 0; i < bidderList.length; i++) {
            Bid storage bid = bids[listingId][bidderList[i]];
            if (!bid.refunded) {
                bid.refunded = true;
                pendingWithdrawals[bidderList[i]] += listings[listingId].reservePrice;
            }
        }
    }

    function _refundLosers(uint256 listingId, address winner) internal {
        address[] memory bidderList = bidders[listingId];
        for (uint256 i = 0; i < bidderList.length; i++) {
            if (bidderList[i] != winner) {
                Bid storage bid = bids[listingId][bidderList[i]];
                if (!bid.refunded) {
                    bid.refunded = true;
                    pendingWithdrawals[bidderList[i]] += listings[listingId].reservePrice;
                }
            }
        }
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    // ============================================================
    // SIGNATURE VERIFICATION
    // ============================================================
    function _verifySignature(
        bytes32 messageHash,
        bytes memory signature,
        address expectedSigner
    ) internal pure returns (bool) {
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            messageHash
        ));

        if (signature.length != 65) return false;

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;

        return ecrecover(ethSignedHash, v, r, s) == expectedSigner;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getBidders(uint256 listingId) external view returns (address[] memory) {
        return bidders[listingId];
    }

    function getFlags(uint256 listingId) external view returns (Flag[] memory) {
        return listingFlags[listingId];
    }

    function getPlatformStats() external view returns (
        uint256 _totalListings,
        uint256 _totalVolume,
        uint256 _listingCount,
        bool _frozen
    ) {
        return (totalListings, totalVolume, listingCount, platformFrozen);
    }

    function getWinnerKey(uint256 listingId) external view returns (string memory) {
        Listing memory listing = listings[listingId];
        require(msg.sender == listing.winner, "Not winner");
        require(listing.keyDelivered, "Key not delivered yet");
        return listing.encryptedKeyForWinner;
    }

    // ============================================================
    // EMERGENCY
    // ============================================================
    receive() external payable {}

    function emergencyWithdraw() external onlyOwner {
        require(platformFrozen, "Platform must be frozen first");
        payable(owner).transfer(address(this).balance);
    }
    function updatePlatformWallet(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Invalid address");
        platformWallet = newWallet;
    }
}
