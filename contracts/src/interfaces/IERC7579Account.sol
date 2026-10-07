// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PackedUserOperation } from "./IERC4337.sol";

/**
 * @title Execution
 * @notice Standard execution struct for batched or singular execution.
 */
struct Execution {
    address target;
    uint256 value;
    bytes callData;
}

/**
 * @title IERC7579Execution
 * @notice Standard execution interface for ERC-7579 modular smart accounts.
 */
interface IERC7579Execution {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;

    function executeFromExecutor(
        bytes32 mode,
        bytes calldata executionCalldata
    ) external payable returns (bytes[] memory returnData);
}

/**
 * @title IERC7579Account
 * @notice Core interface for ERC-7579 modular smart accounts.
 */
interface IERC7579Account is IERC7579Execution {
    event ModuleInstalled(uint256 moduleTypeId, address module);
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext) external view returns (bool);
    function supportsExecutionMode(bytes32 mode) external view returns (bool);
    function supportsModule(uint256 moduleTypeId) external view returns (bool);
    function accountId() external view returns (string memory);
}
