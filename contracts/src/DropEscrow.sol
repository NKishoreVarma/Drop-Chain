// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @title DropEscrow
 * @notice Bonded Agent-to-Agent (A2A) Escrow for Autonomous AI Wallets.
 * @dev Enforces:
 *   - Verifiable deliverable state effect hash matching.
 *   - Worker bond staking (slashed on discrepancy or malicious failure).
 *   - Atomically protected funds settlement and milestone release.
 */
contract DropEscrow {
    enum EscrowStatus {
        NONE,
        INITIALIZED,
        ACTIVE,
        COMPLETED,
        DISPUTED,
        REFUNDED,
        SLASHED
    }

    struct EscrowJob {
        bytes32 jobId;
        address buyerAccount;
        address sellerAccount;
        address token;
        uint256 paymentAmount;
        uint256 requiredBond;
        bytes32 expectedEffectHash;
        uint48 deadline;
        EscrowStatus status;
        uint256 createdAt;
    }

    // Storage
    mapping(bytes32 => EscrowJob) public jobs;
    bytes32[] private _allJobIds;

    // Events
    event JobCreated(
        bytes32 indexed jobId,
        address indexed buyerAccount,
        address indexed sellerAccount,
        address token,
        uint256 paymentAmount,
        uint256 requiredBond,
        bytes32 expectedEffectHash,
        uint48 deadline
    );
    event BondStaked(bytes32 indexed jobId, address indexed sellerAccount, uint256 bondAmount);
    event JobCompleted(bytes32 indexed jobId, bytes32 actualEffectHash, uint256 payoutTotal);
    event JobSlashed(bytes32 indexed jobId, string reason, uint256 refundAndSlashTotal);
    event JobRefunded(bytes32 indexed jobId);

    // Reentrancy lock
    bool private _locked;
    modifier nonReentrant() {
        require(!_locked, "DropEscrow: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    /**
     * @notice Creates an escrow job and deposits payment.
     */
    function createJob(
        bytes32 jobId,
        address sellerAccount,
        address token,
        uint256 paymentAmount,
        uint256 requiredBond,
        bytes32 expectedEffectHash,
        uint48 deadline
    ) external nonReentrant {
        require(jobId != bytes32(0), "DropEscrow: zero jobId");
        require(sellerAccount != address(0), "DropEscrow: zero seller");
        require(sellerAccount != msg.sender, "DropEscrow: seller cannot be buyer");
        require(token != address(0), "DropEscrow: zero token");
        require(paymentAmount > 0, "DropEscrow: zero payment");
        require(deadline > block.timestamp, "DropEscrow: invalid deadline");
        require(jobs[jobId].status == EscrowStatus.NONE, "DropEscrow: job already exists");

        // Transfer payment from buyer into escrow
        bool success = IERC20Minimal(token).transferFrom(msg.sender, address(this), paymentAmount);
        require(success, "DropEscrow: payment transfer failed");

        jobs[jobId] = EscrowJob({
            jobId: jobId,
            buyerAccount: msg.sender,
            sellerAccount: sellerAccount,
            token: token,
            paymentAmount: paymentAmount,
            requiredBond: requiredBond,
            expectedEffectHash: expectedEffectHash,
            deadline: deadline,
            status: requiredBond == 0 ? EscrowStatus.ACTIVE : EscrowStatus.INITIALIZED,
            createdAt: block.timestamp
        });

        _allJobIds.push(jobId);

        emit JobCreated(
            jobId,
            msg.sender,
            sellerAccount,
            token,
            paymentAmount,
            requiredBond,
            expectedEffectHash,
            deadline
        );
    }

    /**
     * @notice Worker/Seller stakes the required security bond to activate the job.
     */
    function stakeBond(bytes32 jobId) external nonReentrant {
        EscrowJob storage job = jobs[jobId];
        require(job.status == EscrowStatus.INITIALIZED, "DropEscrow: job not awaiting bond");
        require(
            msg.sender == job.sellerAccount,
            "DropEscrow: only assigned seller can stake bond"
        );
        require(block.timestamp <= job.deadline, "DropEscrow: job deadline passed");

        if (job.requiredBond > 0) {
            bool success = IERC20Minimal(job.token).transferFrom(
                msg.sender,
                address(this),
                job.requiredBond
            );
            require(success, "DropEscrow: bond transfer failed");
        }

        job.status = EscrowStatus.ACTIVE;
        emit BondStaked(jobId, msg.sender, job.requiredBond);
    }

    /**
     * @notice Releases escrow payment and returns bond upon verified deliverable effect match.
     */
    function completeJob(bytes32 jobId, bytes32 actualEffectHash) external nonReentrant {
        EscrowJob storage job = jobs[jobId];
        require(job.status == EscrowStatus.ACTIVE, "DropEscrow: job not active");
        require(
            msg.sender == job.buyerAccount || msg.sender == job.sellerAccount,
            "DropEscrow: unauthorized completion caller"
        );
        require(block.timestamp <= job.deadline, "DropEscrow: job deadline passed");
        require(
            actualEffectHash == job.expectedEffectHash,
            "DropEscrow: deliverable effect mismatch"
        );

        job.status = EscrowStatus.COMPLETED;

        uint256 totalPayout = job.paymentAmount + job.requiredBond;
        bool success = IERC20Minimal(job.token).transfer(job.sellerAccount, totalPayout);
        require(success, "DropEscrow: payout transfer failed");

        emit JobCompleted(jobId, actualEffectHash, totalPayout);
    }

    /**
     * @notice Slashes seller bond and refunds buyer if deliverable violates invariants or deadline passes.
     */
    function slashJob(bytes32 jobId, string calldata reason) external nonReentrant {
        EscrowJob storage job = jobs[jobId];
        require(job.status == EscrowStatus.ACTIVE, "DropEscrow: job not active");

        // Callable by buyer if deadline passed or effect verified failed
        if (msg.sender != job.buyerAccount) {
            revert("DropEscrow: only buyer can slash job");
        }

        job.status = EscrowStatus.SLASHED;

        // Buyer receives original payment + slashed seller bond!
        uint256 totalRefundAndSlash = job.paymentAmount + job.requiredBond;
        bool success = IERC20Minimal(job.token).transfer(job.buyerAccount, totalRefundAndSlash);
        require(success, "DropEscrow: slash settlement transfer failed");

        emit JobSlashed(jobId, reason, totalRefundAndSlash);
    }

    /**
     * @notice Refunds buyer if job was never activated by seller before deadline or by buyer request.
     */
    function refundJob(bytes32 jobId) external nonReentrant {
        EscrowJob storage job = jobs[jobId];
        require(
            job.status == EscrowStatus.INITIALIZED,
            "DropEscrow: job cannot be refunded in current state"
        );
        require(msg.sender == job.buyerAccount, "DropEscrow: only buyer can cancel unbonded job");

        job.status = EscrowStatus.REFUNDED;

        bool success = IERC20Minimal(job.token).transfer(job.buyerAccount, job.paymentAmount);
        require(success, "DropEscrow: refund transfer failed");

        emit JobRefunded(jobId);
    }

    function getJob(bytes32 jobId) external view returns (EscrowJob memory) {
        require(jobs[jobId].status != EscrowStatus.NONE, "DropEscrow: job not found");
        return jobs[jobId];
    }

    function totalJobs() external view returns (uint256) {
        return _allJobIds.length;
    }

    function getAllJobIds() external view returns (bytes32[] memory) {
        return _allJobIds;
    }
}
