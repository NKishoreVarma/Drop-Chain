// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC7579Module } from "./IERC7579Module.sol";
import { PackedUserOperation } from "./IERC4337.sol";

/**
 * @title IValidator
 * @notice ERC-7579 Validator Module interface (Module Type 1).
 * @dev See https://eips.ethereum.org/EIPS/eip-7579
 */
interface IValidator is IERC7579Module {
    /**
     * @notice Validates an ERC-4337 UserOperation on behalf of the smart account.
     * @param userOp The ERC-4337 v0.7 PackedUserOperation struct.
     * @param userOpHash The hash of the UserOperation calculated by EntryPoint.
     * @return validationData Packed validation data (0 for success, 1 for failure, or packed authorizer/validUntil/validAfter).
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256 validationData);

    /**
     * @notice ERC-1271 signature validation with sender.
     * @param sender Address of the entity querying validation.
     * @param hash Hash of the data signed.
     * @param data Signature data.
     * @return magicValue EIP-1271 magic value (0x1626ba7e for valid).
     */
    function isValidSignatureWithSender(
        address sender,
        bytes32 hash,
        bytes calldata data
    ) external view returns (bytes4 magicValue);
}

bytes4 constant EIP1271_SUCCESS = 0x1626ba7e;
bytes4 constant EIP1271_FAILED = 0xffffffff;
