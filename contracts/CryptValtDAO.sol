// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * CryptValt DAO Governance
 *
 * On-chain governance for the CryptValt protocol.
 * CVT holders vote on proposals that shape the platform.
 *
 * Proposal types:
 * - Fee changes (platform fee, royalty caps)
 * - Contract upgrades
 * - Treasury spending
 * - Feature additions
 * - Parameter changes
 * - Emergency actions
 *
 * Voting rules:
 * - Minimum 10,000 CVT to create a proposal
 * - Voting period: 7 days
 * - Quorum: 5% of circulating supply
 * - Pass threshold: 60% yes votes
 * - Timelock: 48 hours before execution
 * - Founders can veto within timelock window
 */

interface ICVTToken {
    function getVotingPower(address user) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function balanceOf(address user) external view returns (uint256);
}

interface IFounderNFT {
    function balanceOf(address user) external view returns (uint256);
}

contract CryptValtDAO {

    // ── Constants ──────────────────────────────────────────
    uint256 public constant PROPOSAL_THRESHOLD  = 10_000 * 10**18; // 10k CVT
    uint256 public constant VOTING_PERIOD       = 7 days;
    uint256 public constant TIMELOCK_PERIOD     = 48 hours;
    uint256 public constant QUORUM_BPS          = 500;   // 5%
    uint256 public constant PASS_THRESHOLD_BPS  = 6000;  // 60%
    uint256 public constant BPS                 = 10000;

    // ── Proposal States ────────────────────────────────────
    enum ProposalState {
        Pending,    // 0 — not yet active
        Active,     // 1 — voting open
        Succeeded,  // 2 — passed, in timelock
        Defeated,   // 3 — failed
        Queued,     // 4 — in timelock queue
        Executed,   // 5 — executed
        Vetoed,     // 6 — vetoed by Founders
        Cancelled   // 7 — cancelled by proposer
    }

    enum ProposalType {
        FeeChange,          // 0
        ContractUpgrade,    // 1
        TreasurySpend,      // 2
        FeatureAddition,    // 3
        ParameterChange,    // 4
        EmergencyAction,    // 5
        General             // 6
    }

    struct Proposal {
        uint256     id;
        address     proposer;
        string      title;
        string      description;
        uint8       proposalType;
        uint256     forVotes;
        uint256     againstVotes;
        uint256     abstainVotes;
        uint256     startTime;
        uint256     endTime;
        uint256     queuedAt;
        uint256     executedAt;
        bool        executed;
        bool        vetoed;
        bool        cancelled;
        bytes       callData;       // Encoded function call if executable
        address     target;         // Contract to call
    }

    struct Receipt {
        bool    hasVoted;
        uint8   support;    // 0=against, 1=for, 2=abstain
        uint256 votes;
    }

    // ── State ──────────────────────────────────────────────
    address public owner;
    ICVTToken  public cvtToken;
    IFounderNFT public founderNFT;
    address public treasury;
    address public cryptvalt;

    uint256 public proposalCount;
    uint256 public totalVotesCast;

    mapping(uint256 => Proposal)                    public proposals;
    mapping(uint256 => mapping(address => Receipt)) public receipts;
    mapping(address => uint256[])                   public proposerHistory;
    mapping(address => uint256)                     public delegatedTo;
    mapping(address => uint256)                     public delegatedPower;

    bool public paused;

    // ── Events ─────────────────────────────────────────────
    event ProposalCreated(uint256 indexed id, address indexed proposer, string title, uint8 proposalType, uint256 endTime);
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 votes);
    event ProposalQueued(uint256 indexed id, uint256 executeAfter);
    event ProposalExecuted(uint256 indexed id);
    event ProposalVetoed(uint256 indexed id, address vetoer);
    event ProposalCancelled(uint256 indexed id);
    event Delegated(address indexed delegator, address indexed delegatee, uint256 votes);

    modifier onlyOwner()  { require(msg.sender == owner,  "Not owner");  _; }
    modifier notPaused()  { require(!paused,               "Paused");     _; }

    constructor(address _cvtToken, address _founderNFT, address _treasury) {
        owner      = msg.sender;
        cvtToken   = ICVTToken(_cvtToken);
        founderNFT = IFounderNFT(_founderNFT);
        treasury   = _treasury;
    }

    // ── Create Proposal ────────────────────────────────────
    function propose(
        string  calldata title,
        string  calldata description,
        uint8            proposalType,
        address          target,
        bytes   calldata callData
    ) external notPaused returns (uint256) {
        uint256 power = getVotingPower(msg.sender);
        require(power >= PROPOSAL_THRESHOLD, "Insufficient CVT to propose");
        require(bytes(title).length > 0,       "Title required");
        require(bytes(description).length > 0, "Description required");
        require(proposalType <= uint8(ProposalType.General), "Invalid type");

        proposalCount++;
        uint256 id = proposalCount;

        proposals[id] = Proposal({
            id:           id,
            proposer:     msg.sender,
            title:        title,
            description:  description,
            proposalType: proposalType,
            forVotes:     0,
            againstVotes: 0,
            abstainVotes: 0,
            startTime:    block.timestamp,
            endTime:      block.timestamp + VOTING_PERIOD,
            queuedAt:     0,
            executedAt:   0,
            executed:     false,
            vetoed:       false,
            cancelled:    false,
            callData:     callData,
            target:       target
        });

        proposerHistory[msg.sender].push(id);

        emit ProposalCreated(id, msg.sender, title, proposalType, block.timestamp + VOTING_PERIOD);
        return id;
    }

    // ── Vote ───────────────────────────────────────────────
    function castVote(uint256 proposalId, uint8 support) external notPaused {
        require(support <= 2, "Invalid support: 0=against, 1=for, 2=abstain");
        Proposal storage p = proposals[proposalId];
        require(getState(proposalId) == uint8(ProposalState.Active), "Not active");
        require(!receipts[proposalId][msg.sender].hasVoted,           "Already voted");

        uint256 votes = getVotingPower(msg.sender);
        require(votes > 0, "No voting power");

        receipts[proposalId][msg.sender] = Receipt({ hasVoted: true, support: support, votes: votes });
        totalVotesCast++;

        if      (support == 1) p.forVotes     += votes;
        else if (support == 0) p.againstVotes += votes;
        else                   p.abstainVotes += votes;

        emit VoteCast(proposalId, msg.sender, support, votes);
    }

    // ── Queue ──────────────────────────────────────────────
    function queue(uint256 proposalId) external {
        require(getState(proposalId) == uint8(ProposalState.Succeeded), "Not succeeded");
        proposals[proposalId].queuedAt = block.timestamp;
        emit ProposalQueued(proposalId, block.timestamp + TIMELOCK_PERIOD);
    }

    // ── Execute ────────────────────────────────────────────
    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(getState(proposalId) == uint8(ProposalState.Queued), "Not queued");
        require(block.timestamp >= p.queuedAt + TIMELOCK_PERIOD,      "Timelock active");

        p.executed    = true;
        p.executedAt  = block.timestamp;

        // Execute on-chain call if target is set
        if (p.target != address(0) && p.callData.length > 0) {
            (bool success,) = p.target.call(p.callData);
            require(success, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    // ── Veto (Founders only) ───────────────────────────────
    function veto(uint256 proposalId) external {
        require(founderNFT.balanceOf(msg.sender) > 0, "Not a Founder");
        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.vetoed && !p.cancelled, "Already finalized");
        require(
            getState(proposalId) == uint8(ProposalState.Active) ||
            getState(proposalId) == uint8(ProposalState.Succeeded) ||
            getState(proposalId) == uint8(ProposalState.Queued),
            "Cannot veto"
        );

        p.vetoed = true;
        emit ProposalVetoed(proposalId, msg.sender);
    }

    // ── Cancel ─────────────────────────────────────────────
    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer || msg.sender == owner, "Not proposer");
        require(!p.executed && !p.vetoed, "Already finalized");
        p.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    // ── Delegate Votes ─────────────────────────────────────
    function delegate(address to) external {
        uint256 power = cvtToken.getVotingPower(msg.sender);
        address current = address(uint160(delegatedTo[msg.sender]));
        if (current != address(0)) delegatedPower[current] -= power;
        delegatedTo[msg.sender] = uint256(uint160(to));
        if (to != address(0)) delegatedPower[to] += power;
        emit Delegated(msg.sender, to, power);
    }

    // ── Voting Power ───────────────────────────────────────
    function getVotingPower(address user) public view returns (uint256) {
        uint256 own      = cvtToken.getVotingPower(user);
        uint256 delegated = delegatedPower[user];
        // Founder bonus: 3x voting power
        uint256 founderBonus = founderNFT.balanceOf(user) > 0 ? own * 2 : 0;
        return own + delegated + founderBonus;
    }

    // ── Proposal State ─────────────────────────────────────
    function getState(uint256 proposalId) public view returns (uint8) {
        Proposal storage p = proposals[proposalId];
        if (p.cancelled)                                              return uint8(ProposalState.Cancelled);
        if (p.vetoed)                                                 return uint8(ProposalState.Vetoed);
        if (p.executed)                                               return uint8(ProposalState.Executed);
        if (block.timestamp < p.startTime)                            return uint8(ProposalState.Pending);
        if (block.timestamp <= p.endTime)                             return uint8(ProposalState.Active);

        // Check quorum and threshold
        uint256 totalSupply = cvtToken.totalSupply();
        uint256 totalVotes  = p.forVotes + p.againstVotes + p.abstainVotes;
        uint256 quorum      = (totalSupply * QUORUM_BPS) / BPS;

        if (totalVotes < quorum)                                      return uint8(ProposalState.Defeated);
        if (p.forVotes * BPS < (p.forVotes + p.againstVotes) * PASS_THRESHOLD_BPS)
                                                                      return uint8(ProposalState.Defeated);
        if (p.queuedAt > 0)                                           return uint8(ProposalState.Queued);
        return uint8(ProposalState.Succeeded);
    }

    function getStateName(uint256 proposalId) external view returns (string memory) {
        uint8 s = getState(proposalId);
        if (s == 0) return "Pending";
        if (s == 1) return "Active";
        if (s == 2) return "Succeeded";
        if (s == 3) return "Defeated";
        if (s == 4) return "Queued";
        if (s == 5) return "Executed";
        if (s == 6) return "Vetoed";
        return "Cancelled";
    }

    // ── View ───────────────────────────────────────────────
    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    function getReceipt(uint256 proposalId, address voter) external view returns (Receipt memory) {
        return receipts[proposalId][voter];
    }

    function getProposerHistory(address proposer) external view returns (uint256[] memory) {
        return proposerHistory[proposer];
    }

    function getDAOStats() external view returns (
        uint256 totalProposals, uint256 totalVotes, bool isPaused
    ) {
        return (proposalCount, totalVotesCast, paused);
    }

    // ── Admin ──────────────────────────────────────────────
    function setCVTToken(address t)  external onlyOwner { cvtToken    = ICVTToken(t); }
    function setFounderNFT(address f) external onlyOwner { founderNFT  = IFounderNFT(f); }
    function setCryptValt(address c) external onlyOwner { cryptvalt   = c; }
    function setPaused(bool p)       external onlyOwner { paused      = p; }
}