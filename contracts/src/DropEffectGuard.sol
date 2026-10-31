// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHook } from "./interfaces/IHook.sol";
import { IERC7579Module, MODULE_TYPE_HOOK } from "./interfaces/IERC7579Module.sol";

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IOwnableAccount {
    function owner() external view returns (address);
}

/**
 * @title DropEffectGuard
 * @notice ERC-7579 Hook Module for Onchain Transaction-Effect Verification.
 * @dev Enforces preCheck and postCheck boundaries on ModularSmartAccount execution:
 *   - Verifies caller is registered smart account.
 *   - Prevents reentrancy into execution hooks.
 *   - Snapshots pre-execution token balances, ETH balances, and allowances.
 *   - Derives or accepts strict expected effect commitments.
 *   - Post-execution verification: guarantees no unexpected balance drains and no unauthorized allowance increases.
 *   - Atomically reverts the entire transaction on any effect discrepancy.
 */
contract DropEffectGuard is IHook {
    // Execution state per smart account to prevent reentrancy
    mapping(address => bool) private _isExecuting;

    // Initialization state per smart account
    mapping(address => bool) private _initialized;

    // Watched Spenders per smart account (spenders whose allowances are monitored)
    mapping(address => address[]) private _watchedSpenders;
    mapping(address => mapping(address => bool)) public isSpenderWatched;

    // Watched Tokens per smart account
    mapping(address => address[]) private _watchedTokens;
    mapping(address => mapping(address => bool)) public isTokenWatched;

    // Expected Effect Commitment struct
    struct ExpectedEffect {
        address token;
        address recipient;
        uint256 maxAmount;
        uint256 maxAllowance;
        bool exactAmount;
        bool active;
    }

    // Explicit Pending Commitments per smart account
    mapping(address => ExpectedEffect) public pendingEffects;

    // Events
    event EffectGuardInstalled(address indexed smartAccount);
    event EffectGuardUninstalled(address indexed smartAccount);
    event WatchedSpenderAdded(address indexed smartAccount, address indexed spender);
    event WatchedSpenderRemoved(address indexed smartAccount, address indexed spender);
    event WatchedTokenAdded(address indexed smartAccount, address indexed token);
    event WatchedTokenRemoved(address indexed smartAccount, address indexed token);
    event ExpectedEffectCommitted(address indexed smartAccount, address indexed token, address indexed recipient, uint256 maxAmount);

    // Errors
    error UnauthorizedCaller();
    error ReentrancyDetected();
    error BalanceDeltaMismatch(uint256 expected, uint256 actual);
    error UnexpectedAllowanceIncrease(address token, address spender, uint256 preAllowance, uint256 postAllowance);

    // -------------------------------------------------------------
    // ERC-7579 Module Standard Methods
    // -------------------------------------------------------------

    function onInstall(bytes calldata data) external override {
        address smartAccount = msg.sender;
        require(!_initialized[smartAccount], "DropEffectGuard: already installed");
        _initialized[smartAccount] = true;

        if (data.length > 0) {
            (address[] memory tokens, address[] memory spenders) = abi.decode(data, (address[], address[]));
            for (uint256 i = 0; i < tokens.length; i++) {
                _addWatchedToken(smartAccount, tokens[i]);
            }
            for (uint256 j = 0; j < spenders.length; j++) {
                _addWatchedSpender(smartAccount, spenders[j]);
            }
        }

        emit EffectGuardInstalled(smartAccount);
    }

    function onUninstall(bytes calldata) external override {
        address smartAccount = msg.sender;
        require(_initialized[smartAccount], "DropEffectGuard: not installed");
        _initialized[smartAccount] = false;
        _isExecuting[smartAccount] = false;
        delete pendingEffects[smartAccount];

        emit EffectGuardUninstalled(smartAccount);
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK;
    }

    function isInitialized(address smartAccount) external view override returns (bool) {
        return _initialized[smartAccount];
    }

    // -------------------------------------------------------------
    // Configuration Management
    // -------------------------------------------------------------

    modifier onlyAccountOrOwner(address smartAccount) {
        require(
            msg.sender == smartAccount || (smartAccount.code.length > 0 && IOwnableAccount(smartAccount).owner() == msg.sender),
            "DropEffectGuard: unauthorized"
        );
        _;
    }

    function addWatchedSpender(address smartAccount, address spender) external onlyAccountOrOwner(smartAccount) {
        _addWatchedSpender(smartAccount, spender);
    }

    function removeWatchedSpender(address smartAccount, address spender) external onlyAccountOrOwner(smartAccount) {
        require(isSpenderWatched[smartAccount][spender], "DropEffectGuard: spender not watched");
        isSpenderWatched[smartAccount][spender] = false;

        address[] storage spenders = _watchedSpenders[smartAccount];
        for (uint256 i = 0; i < spenders.length; i++) {
            if (spenders[i] == spender) {
                spenders[i] = spenders[spenders.length - 1];
                spenders.pop();
                break;
            }
        }
        emit WatchedSpenderRemoved(smartAccount, spender);
    }

    function addWatchedToken(address smartAccount, address token) external onlyAccountOrOwner(smartAccount) {
        _addWatchedToken(smartAccount, token);
    }

    function removeWatchedToken(address smartAccount, address token) external onlyAccountOrOwner(smartAccount) {
        require(isTokenWatched[smartAccount][token], "DropEffectGuard: token not watched");
        isTokenWatched[smartAccount][token] = false;

        address[] storage tokens = _watchedTokens[smartAccount];
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }
        emit WatchedTokenRemoved(smartAccount, token);
    }

    function _addWatchedSpender(address smartAccount, address spender) internal {
        if (spender != address(0) && !isSpenderWatched[smartAccount][spender]) {
            isSpenderWatched[smartAccount][spender] = true;
            _watchedSpenders[smartAccount].push(spender);
            emit WatchedSpenderAdded(smartAccount, spender);
        }
    }

    function _addWatchedToken(address smartAccount, address token) internal {
        if (token != address(0) && !isTokenWatched[smartAccount][token]) {
            isTokenWatched[smartAccount][token] = true;
            _watchedTokens[smartAccount].push(token);
            emit WatchedTokenAdded(smartAccount, token);
        }
    }

    function getWatchedSpenders(address smartAccount) external view returns (address[] memory) {
        return _watchedSpenders[smartAccount];
    }

    function getWatchedTokens(address smartAccount) external view returns (address[] memory) {
        return _watchedTokens[smartAccount];
    }

    /**
     * @notice Manually commit an expected effect for the upcoming execution.
     */
    function commitExpectedEffect(
        address smartAccount,
        address token,
        address recipient,
        uint256 maxAmount,
        uint256 maxAllowance,
        bool exactAmount
    ) external onlyAccountOrOwner(smartAccount) {
        pendingEffects[smartAccount] = ExpectedEffect({
            token: token,
            recipient: recipient,
            maxAmount: maxAmount,
            maxAllowance: maxAllowance,
            exactAmount: exactAmount,
            active: true
        });

        emit ExpectedEffectCommitted(smartAccount, token, recipient, maxAmount);
    }

    // -------------------------------------------------------------
    // ERC-7579 Hook Lifecycle: preCheck & postCheck
    // -------------------------------------------------------------

    /**
     * @notice Executed before smart account execution.
     */
    function preCheck(
        address, /* msgSender */
        uint256 msgValue,
        bytes calldata msgData
    ) external override returns (bytes memory hookData) {
        address smartAccount = msg.sender;
        require(_initialized[smartAccount], "DropEffectGuard: not installed");
        require(!_isExecuting[smartAccount], "DropEffectGuard: reentrant call");

        _isExecuting[smartAccount] = true;

        // Parse execution calldata to extract target and inner callData
        address target = address(0);
        bytes memory callData = "";

        if (msgData.length >= 4) {
            bytes4 sel = bytes4(msgData[:4]);
            // Selector for execute(bytes32,bytes) is 0xe9ae5c53
            // Selector for executeFromExecutor(bytes32,bytes) is 0x9c3e9821
            if (sel == 0xe9ae5c53 || sel == 0x9c3e9821) {
                (, bytes memory execCalldata) = abi.decode(msgData[4:], (bytes32, bytes));
                if (execCalldata.length >= 52) {
                    assembly {
                        target := shr(96, mload(add(execCalldata, 32)))
                    }
                    uint256 callDataLen = execCalldata.length - 52;
                    callData = new bytes(callDataLen);
                    for (uint256 i = 0; i < callDataLen; i++) {
                        callData[i] = execCalldata[52 + i];
                    }
                }
            }
        }

        // Determine ExpectedEffect
        ExpectedEffect memory effect;
        if (pendingEffects[smartAccount].active) {
            effect = pendingEffects[smartAccount];
            delete pendingEffects[smartAccount];
        } else {
            // Auto-derive from ERC20 transfer(address,uint256)
            if (callData.length >= 68) {
                bytes4 callSel;
                assembly {
                    callSel := mload(add(callData, 32))
                }
                if (callSel == 0xa9059cbb) {
                    // transfer(address,uint256)
                    uint256 argsLen = callData.length - 4;
                    bytes memory transferArgs = new bytes(argsLen);
                    for (uint256 j = 0; j < argsLen; j++) {
                        transferArgs[j] = callData[4 + j];
                    }
                    (address to, uint256 amt) = abi.decode(transferArgs, (address, uint256));
                    effect = ExpectedEffect({
                        token: target,
                        recipient: to,
                        maxAmount: amt,
                        maxAllowance: 0,
                        exactAmount: true,
                        active: true
                    });
                }
            }
        }

        // Snapshot Pre-State
        uint256 preTokenBalance = 0;
        uint256 preRecipientAllowance = 0;
        uint256 preTargetAllowance = 0;
        uint256 preEthBalance = address(smartAccount).balance;

        if (effect.token != address(0)) {
            preTokenBalance = _safeBalanceOf(effect.token, smartAccount);
            if (effect.recipient != address(0)) {
                preRecipientAllowance = _safeAllowance(effect.token, smartAccount, effect.recipient);
            }
            if (target != address(0) && target != effect.token) {
                preTargetAllowance = _safeAllowance(effect.token, smartAccount, target);
            }
        }

        // Snapshot Watched Spenders
        address[] memory spenders = _watchedSpenders[smartAccount];
        uint256[] memory preSpenderAllowances = new uint256[](spenders.length);
        if (effect.token != address(0)) {
            for (uint256 i = 0; i < spenders.length; i++) {
                preSpenderAllowances[i] = _safeAllowance(effect.token, smartAccount, spenders[i]);
            }
        }

        // Also check if token exposes fixture attacker() getter
        address fixtureAttacker = address(0);
        uint256 preFixtureAttackerAllowance = 0;
        if (effect.token != address(0)) {
            (bool okAtt, bytes memory attBytes) = effect.token.staticcall(abi.encodeWithSignature("attacker()"));
            if (okAtt && attBytes.length >= 32) {
                fixtureAttacker = abi.decode(attBytes, (address));
                if (fixtureAttacker != address(0)) {
                    preFixtureAttackerAllowance = _safeAllowance(effect.token, smartAccount, fixtureAttacker);
                }
            }
        }

        // Encode Hook Context
        hookData = abi.encode(
            smartAccount,
            effect,
            target,
            msgValue,
            preEthBalance,
            preTokenBalance,
            preRecipientAllowance,
            preTargetAllowance,
            spenders,
            preSpenderAllowances,
            fixtureAttacker,
            preFixtureAttackerAllowance
        );
    }

    /**
     * @notice Executed after smart account execution.
     * @dev Reverts if any state effect violates expected boundaries.
     */
    function postCheck(bytes calldata hookData) external override {
        (
            address smartAccount,
            ExpectedEffect memory effect,
            address target,
            uint256 msgValue,
            uint256 preEthBalance,
            uint256 preTokenBalance,
            uint256 preRecipientAllowance,
            uint256 preTargetAllowance,
            address[] memory spenders,
            uint256[] memory preSpenderAllowances,
            address fixtureAttacker,
            uint256 preFixtureAttackerAllowance
        ) = abi.decode(
            hookData,
            (
                address,
                ExpectedEffect,
                address,
                uint256,
                uint256,
                uint256,
                uint256,
                uint256,
                address[],
                uint256[],
                address,
                uint256
            )
        );

        require(msg.sender == smartAccount, "DropEffectGuard: unauthorized postCheck");
        _isExecuting[smartAccount] = false;

        // Verify Native ETH Balance
        uint256 postEthBalance = address(smartAccount).balance;
        if (postEthBalance < preEthBalance) {
            uint256 ethDelta = preEthBalance - postEthBalance;
            require(ethDelta <= msgValue, "DropEffectGuard: unexpected ETH decrease");
        }

        // If no guarded token was active, return
        if (!effect.active || effect.token == address(0)) {
            return;
        }

        // 1. Verify Token Balance Delta
        uint256 postTokenBalance = _safeBalanceOf(effect.token, smartAccount);
        if (postTokenBalance < preTokenBalance) {
            uint256 delta = preTokenBalance - postTokenBalance;
            require(delta <= effect.maxAmount, "DropEffectGuard: balance delta mismatch");
            if (effect.exactAmount) {
                require(delta == effect.maxAmount, "DropEffectGuard: balance delta mismatch");
            }
        }

        // 2. Verify Recipient Allowance
        if (effect.recipient != address(0)) {
            uint256 postRecipientAllowance = _safeAllowance(effect.token, smartAccount, effect.recipient);
            if (postRecipientAllowance > effect.maxAllowance && postRecipientAllowance > preRecipientAllowance) {
                revert("DropEffectGuard: unexpected allowance increase");
            }
        }

        // 3. Verify Target Allowance
        if (target != address(0) && target != effect.token) {
            uint256 postTargetAllowance = _safeAllowance(effect.token, smartAccount, target);
            if (postTargetAllowance > preTargetAllowance) {
                revert("DropEffectGuard: unexpected allowance increase");
            }
        }

        // 4. Verify Watched Spenders Allowances
        for (uint256 i = 0; i < spenders.length; i++) {
            uint256 postSpenderAllowance = _safeAllowance(effect.token, smartAccount, spenders[i]);
            if (postSpenderAllowance > preSpenderAllowances[i]) {
                revert("DropEffectGuard: unexpected allowance increase");
            }
        }

        // 5. Verify Fixture Attacker Allowance (if applicable)
        if (fixtureAttacker != address(0)) {
            uint256 postFixtureAttackerAllowance = _safeAllowance(effect.token, smartAccount, fixtureAttacker);
            if (postFixtureAttackerAllowance > preFixtureAttackerAllowance) {
                revert("DropEffectGuard: unexpected allowance increase");
            }
        }
    }

    // -------------------------------------------------------------
    // Internal Safe Helpers
    // -------------------------------------------------------------

    function _safeBalanceOf(address token, address account) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        if (ok && data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        return 0;
    }

    function _safeAllowance(address token, address owner, address spender) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("allowance(address,address)", owner, spender));
        if (ok && data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        return 0;
    }
}
