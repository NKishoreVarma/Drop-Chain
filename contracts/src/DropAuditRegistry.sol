// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DropAuditRegistry
 * @notice Immutable Onchain Cryptographic Audit Trail for AI-Agent Financial Actions.
 * @dev Anchors cryptographic receipts linking:
 *   - Human Mandate (EIP-712)
 *   - Agent Intent (Prompt/Calldata)
 *   - Canonical Transaction Manifest
 *   - Simulation Result
 *   - Effect Diff & Decision
 *   - UserOperation / Transaction Hash
 */
contract DropAuditRegistry {
    enum Decision {
        UNKNOWN,
        APPROVED,
        BLOCKED
    }

    struct AuditReceipt {
        bytes32 receiptId;
        bytes32 mandateHash;
        bytes32 intentHash;
        bytes32 canonicalTxHash;
        bytes32 simulationHash;
        bytes32 effectDiffHash;
        bytes32 userOpHash;
        address account;
        address sessionKey;
        uint256 timestamp;
        Decision decision;
        string reason;
    }

    // Storage
    mapping(bytes32 => AuditReceipt) public receipts;
    mapping(bytes32 => bytes32[]) private _mandateReceipts;
    mapping(address => bytes32[]) private _accountReceipts;
    bytes32[] private _allReceiptIds;

    // Events
    event AuditReceiptRecorded(
        bytes32 indexed receiptId,
        bytes32 indexed mandateHash,
        address indexed account,
        Decision decision,
        bytes32 userOpHash
    );

    /**
     * @notice Computes deterministic receiptId from constituent cryptographic hashes.
     */
    function computeReceiptId(
        bytes32 mandateHash,
        bytes32 intentHash,
        bytes32 canonicalTxHash,
        bytes32 simulationHash,
        bytes32 effectDiffHash,
        bytes32 userOpHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                mandateHash,
                intentHash,
                canonicalTxHash,
                simulationHash,
                effectDiffHash,
                userOpHash
            )
        );
    }

    /**
     * @notice Records an immutable audit receipt onchain.
     */
    function recordReceipt(
        bytes32 mandateHash,
        bytes32 intentHash,
        bytes32 canonicalTxHash,
        bytes32 simulationHash,
        bytes32 effectDiffHash,
        bytes32 userOpHash,
        address account,
        address sessionKey,
        Decision decision,
        string calldata reason
    ) external returns (bytes32 receiptId) {
        require(account != address(0), "DropAuditRegistry: zero account");
        require(decision != Decision.UNKNOWN, "DropAuditRegistry: invalid decision");

        receiptId = computeReceiptId(
            mandateHash,
            intentHash,
            canonicalTxHash,
            simulationHash,
            effectDiffHash,
            userOpHash
        );

        require(receipts[receiptId].timestamp == 0, "DropAuditRegistry: receipt already exists");

        AuditReceipt memory r = AuditReceipt({
            receiptId: receiptId,
            mandateHash: mandateHash,
            intentHash: intentHash,
            canonicalTxHash: canonicalTxHash,
            simulationHash: simulationHash,
            effectDiffHash: effectDiffHash,
            userOpHash: userOpHash,
            account: account,
            sessionKey: sessionKey,
            timestamp: block.timestamp,
            decision: decision,
            reason: reason
        });

        receipts[receiptId] = r;
        _mandateReceipts[mandateHash].push(receiptId);
        _accountReceipts[account].push(receiptId);
        _allReceiptIds.push(receiptId);

        emit AuditReceiptRecorded(
            receiptId,
            mandateHash,
            account,
            decision,
            userOpHash
        );
    }

    function getReceipt(bytes32 receiptId) external view returns (AuditReceipt memory) {
        require(receipts[receiptId].timestamp != 0, "DropAuditRegistry: receipt not found");
        return receipts[receiptId];
    }

    function getReceiptsByMandate(bytes32 mandateHash) external view returns (bytes32[] memory) {
        return _mandateReceipts[mandateHash];
    }

    function getReceiptsByAccount(address account) external view returns (bytes32[] memory) {
        return _accountReceipts[account];
    }

    function totalReceipts() external view returns (uint256) {
        return _allReceiptIds.length;
    }

    function getAllReceiptIds() external view returns (bytes32[] memory) {
        return _allReceiptIds;
    }
}
