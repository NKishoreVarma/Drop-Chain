// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC7579Module } from "./IERC7579Module.sol";

/**
 * @title IHook
 * @notice ERC-7579 Hook Module Interface.
 * @dev Hooks execute pre-check and post-check validation around smart account executions.
 */
interface IHook is IERC7579Module {
    /**
     * @notice Pre-check hook executed before execution on the smart account.
     * @param msgSender The original caller of the smart account execution function.
     * @param msgValue The native ETH value passed to the execution function.
     * @param msgData The calldata passed to the smart account execution function.
     * @return hookData Contextual data returned to be passed to postCheck.
     */
    function preCheck(
        address msgSender,
        uint256 msgValue,
        bytes calldata msgData
    ) external returns (bytes memory hookData);

    /**
     * @notice Post-check hook executed after execution on the smart account.
     * @param hookData Contextual data returned by preCheck.
     */
    function postCheck(bytes calldata hookData) external;
}
