// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC7579Module
 * @notice Standard interface for ERC-7579 modules.
 * @dev See https://eips.ethereum.org/EIPS/eip-7579
 */
interface IERC7579Module {
    error AlreadyInitialized(address smartAccount);
    error NotInitialized(address smartAccount);

    /**
     * @notice Called when the module is installed on a smart account.
     * @param data Initialization data for the module.
     */
    function onInstall(bytes calldata data) external;

    /**
     * @notice Called when the module is uninstalled from a smart account.
     * @param data De-initialization data for the module.
     */
    function onUninstall(bytes calldata data) external;

    /**
     * @notice Checks whether this module supports a given ERC-7579 module type.
     * @param moduleTypeId Identifier of the module type (1 = Validator, 2 = Executor, 3 = Fallback, 4 = Hook).
     */
    function isModuleType(uint256 moduleTypeId) external view returns (bool);

    /**
     * @notice Checks if the module has been initialized for the given smart account.
     * @param smartAccount The address of the smart account.
     */
    function isInitialized(address smartAccount) external view returns (bool);
}

// ERC-7579 Module Types
uint256 constant MODULE_TYPE_VALIDATOR = 1;
uint256 constant MODULE_TYPE_EXECUTOR = 2;
uint256 constant MODULE_TYPE_FALLBACK = 3;
uint256 constant MODULE_TYPE_HOOK = 4;
