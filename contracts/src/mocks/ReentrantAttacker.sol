// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC7579Module } from "../interfaces/IERC7579Module.sol";

interface ISmartAccount {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata) external payable returns (bytes[] memory);
}

/**
 * @title ReentrantAttacker
 * @notice Test fixture to test reentrancy detection in DropEffectGuard.
 */
contract ReentrantAttacker is IERC7579Module {
    address public smartAccount;
    bytes public reentrantExecutionCalldata;
    bool public attackTriggered;

    function onInstall(bytes calldata) external override {}
    function onUninstall(bytes calldata) external override {}
    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == 2; // MODULE_TYPE_EXECUTOR
    }
    function isInitialized(address) external pure override returns (bool) {
        return true;
    }

    function configure(address _smartAccount, bytes calldata _calldata) external {
        smartAccount = _smartAccount;
        reentrantExecutionCalldata = _calldata;
    }

    /**
     * @notice Target function invoked by smart account.
     * @dev Attempts to re-enter smartAccount via executeFromExecutor.
     */
    function exploit() external returns (bool) {
        attackTriggered = true;
        ISmartAccount(smartAccount).executeFromExecutor(bytes32(0), reentrantExecutionCalldata);
        return true;
    }

    fallback() external payable {
        if (!attackTriggered && smartAccount != address(0)) {
            attackTriggered = true;
            ISmartAccount(smartAccount).executeFromExecutor(bytes32(0), reentrantExecutionCalldata);
        }
    }

    receive() external payable {}
}
