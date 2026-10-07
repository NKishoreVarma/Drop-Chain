// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PackedUserOperation, IEntryPoint, VALIDATION_SUCCESS } from "../interfaces/IERC4337.sol";
import { ModularSmartAccount } from "../core/ModularSmartAccount.sol";

/**
 * @title MockEntryPoint
 * @notice Test EntryPoint implementing ERC-4337 v0.7 execution flow for real integration tests.
 * @dev Exercises the real ModularSmartAccount validation and execution hooks.
 */
contract MockEntryPoint is IEntryPoint {
    mapping(bytes32 => bool) public executedOps;

    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        bool success,
        uint256 actualGasCost
    );

    function getUserOpHash(
        PackedUserOperation calldata userOp
    ) public view override returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData),
                block.chainid,
                address(this)
            )
        );
    }

    function handleOps(
        PackedUserOperation[] calldata ops,
        address payable
    ) external override {
        for (uint256 i = 0; i < ops.length; i++) {
            PackedUserOperation calldata op = ops[i];
            bytes32 opHash = getUserOpHash(op);

            // 1. Validation Phase
            ModularSmartAccount account = ModularSmartAccount(payable(op.sender));
            uint256 validationData = account.validateUserOp(op, opHash, 0);

            // Low 160 bits: 0 means success
            require(uint160(validationData) == 0, "EntryPoint: validation failed");

            // 2. Execution Phase
            (bool success, ) = address(account).call(op.callData);
            require(success, "EntryPoint: execution failed");

            executedOps[opHash] = true;
            emit UserOperationEvent(opHash, op.sender, success, 0);
        }
    }
}
