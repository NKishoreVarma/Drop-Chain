// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DropValidator } from "../DropValidator.sol";
import { PackedUserOperation } from "../interfaces/IERC4337.sol";

/**
 * @title TestHarnessAccount
 * @notice UNIT TEST HARNESS ONLY
 * @dev Used exclusively for isolated component testing of DropValidator standalone logic.
 *      NOT to be confused with ModularSmartAccount (which is the real ERC-4337/7579 account).
 */
contract TestHarnessAccount {
    DropValidator public validator;

    constructor(address _validator) {
        validator = DropValidator(_validator);
    }

    function installValidator() external {
        validator.onInstall("");
    }

    function setSessionPolicy(DropValidator.SessionPolicy calldata policy) external {
        validator.setSessionPolicy(policy);
    }

    function revokeSessionPolicy(address sessionKey) external {
        validator.revokeSessionPolicy(sessionKey);
    }

    function testValidateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        return validator.validateUserOp(userOp, userOpHash);
    }
}
