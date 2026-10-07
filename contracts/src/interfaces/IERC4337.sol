// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PackedUserOperation
 * @notice ERC-4337 v0.7 PackedUserOperation struct.
 * @dev See https://eips.ethereum.org/EIPS/eip-4337
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/**
 * @title IEntryPoint
 * @notice Minimal ERC-4337 EntryPoint v0.7 interface for account interaction.
 */
interface IEntryPoint {
    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable beneficiary
    ) external;

    function getUserOpHash(
        PackedUserOperation calldata userOp
    ) external view returns (bytes32);
}

// ERC-4337 Validation return values
uint256 constant VALIDATION_SUCCESS = 0;
uint256 constant VALIDATION_FAILED = 1;
