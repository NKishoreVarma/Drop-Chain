// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IValidator, EIP1271_SUCCESS, EIP1271_FAILED } from "./interfaces/IValidator.sol";
import { IERC7579Module, MODULE_TYPE_VALIDATOR } from "./interfaces/IERC7579Module.sol";
import { PackedUserOperation, VALIDATION_SUCCESS, VALIDATION_FAILED } from "./interfaces/IERC4337.sol";
import { IERC7579Execution } from "./interfaces/IERC7579Account.sol";
import { DropMandate } from "./DropMandate.sol";

/**
 * @title DropValidator
 * @notice ERC-7579 Validator Module enforcing onchain session policies for AI agents.
 * @dev Enforces:
 *   1. Authorized session-key signatures.
 *   2. Active validity window (validAfter <= timestamp <= validUntil).
 *   3. Whitelisted token address.
 *   4. Whitelisted recipient address.
 *   5. Maximum per-transaction amount.
 *   6. Maximum daily budget.
 *   7. Rejection of unauthorized selectors (e.g. approve, permit, delegatecall).
 *   8. Rejection of non-zero native ETH transfers.
 *   9. Cryptographic binding to human-signed EIP-712 Mandates (DropMandate).
 */
contract DropValidator is IValidator {
    // DropMandate Registry contract
    address public dropMandate;

    // Session Policy Struct
    struct SessionPolicy {
        address sessionKey;     // Authorized agent address
        address token;          // Whitelisted ERC-20 token address
        address recipient;      // Whitelisted recipient address
        uint256 maxAmount;      // Maximum allowed per-transaction amount
        uint256 dailyBudget;    // Maximum cumulative daily spending limit
        uint48 validAfter;      // Start timestamp
        uint48 validUntil;      // Expiration timestamp
        bool enabled;           // Policy activation flag
        bytes32 mandateHash;    // Associated EIP-712 mandate hash (bytes32(0) if legacy)
    }

    // Legacy Session Policy Struct for backwards compatibility with Phase 1-3
    struct LegacySessionPolicy {
        address sessionKey;
        address token;
        address recipient;
        uint256 maxAmount;
        uint256 dailyBudget;
        uint48 validAfter;
        uint48 validUntil;
        bool enabled;
    }

    // Storage: account => sessionKey => Policy
    mapping(address => mapping(address => SessionPolicy)) public sessionPolicies;

    // Storage: account => sessionKey => dayIndex => amountSpent
    mapping(address => mapping(address => mapping(uint256 => uint256))) public dailySpent;

    // Storage: account => initialization status
    mapping(address => bool) public override isInitialized;

    // Standard ERC-20 transfer selector: transfer(address,uint256)
    bytes4 public constant ERC20_TRANSFER_SELECTOR = 0xa9059cbb;

    // Events
    event SessionPolicySet(
        address indexed account,
        address indexed sessionKey,
        address token,
        address recipient,
        uint256 maxAmount,
        uint256 dailyBudget,
        uint48 validAfter,
        uint48 validUntil,
        bytes32 mandateHash
    );
    event SessionPolicyRevoked(address indexed account, address indexed sessionKey);
    event ValidationSuccess(
        address indexed account,
        address indexed sessionKey,
        uint256 amount,
        uint256 totalDailySpent
    );

    // -------------------------------------------------------------
    // ERC-7579 Module Lifecycle
    // -------------------------------------------------------------

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function onInstall(bytes calldata data) external override {
        isInitialized[msg.sender] = true;
        if (data.length > 0) {
            SessionPolicy memory policy = abi.decode(data, (SessionPolicy));
            _setSessionPolicy(msg.sender, policy);
        }
    }

    function onUninstall(bytes calldata) external override {
        isInitialized[msg.sender] = false;
    }

    // -------------------------------------------------------------
    // Mandate Registry Configuration
    // -------------------------------------------------------------

    /**
     * @notice Configures the canonical DropMandate registry contract.
     * @dev One-time initialization.
     */
    function setDropMandate(address _dropMandate) external {
        require(_dropMandate != address(0), "DropValidator: zero dropMandate");
        require(dropMandate == address(0), "DropValidator: already configured");
        dropMandate = _dropMandate;
    }

    // -------------------------------------------------------------
    // Policy Management (Only Smart Account Self-Call)
    // -------------------------------------------------------------

    /**
     * @notice Configures a session policy for an AI agent bound to an EIP-712 Mandate.
     * @dev Must be invoked by the smart account itself (owner-authenticated execution).
     */
    function setSessionPolicy(SessionPolicy calldata policy) external {
        _setSessionPolicy(msg.sender, policy);
    }

    /**
     * @notice Backwards-compatible session policy configuration without mandate binding.
     */
    function setSessionPolicy(LegacySessionPolicy calldata legacyPolicy) external {
        SessionPolicy memory policy = SessionPolicy({
            sessionKey: legacyPolicy.sessionKey,
            token: legacyPolicy.token,
            recipient: legacyPolicy.recipient,
            maxAmount: legacyPolicy.maxAmount,
            dailyBudget: legacyPolicy.dailyBudget,
            validAfter: legacyPolicy.validAfter,
            validUntil: legacyPolicy.validUntil,
            enabled: legacyPolicy.enabled,
            mandateHash: bytes32(0)
        });
        _setSessionPolicy(msg.sender, policy);
    }

    /**
     * @notice Revokes a session policy for an agent.
     */
    function revokeSessionPolicy(address sessionKey) external {
        sessionPolicies[msg.sender][sessionKey].enabled = false;
        emit SessionPolicyRevoked(msg.sender, sessionKey);
    }

    function _setSessionPolicy(address account, SessionPolicy memory policy) internal {
        require(policy.sessionKey != address(0), "DropValidator: zero sessionKey");
        require(policy.token != address(0), "DropValidator: zero token");
        require(policy.validUntil > policy.validAfter, "DropValidator: invalid time window");

        // Enforce EIP-712 Human Mandate Restrictions if mandateHash is provided
        if (policy.mandateHash != bytes32(0)) {
            require(dropMandate != address(0), "DropValidator: dropMandate not configured");
            require(DropMandate(dropMandate).isMandateRegistered(policy.mandateHash), "DropValidator: mandate not registered");
            require(!DropMandate(dropMandate).isRevoked(policy.mandateHash), "DropValidator: mandate revoked");

            DropMandate.Mandate memory m = DropMandate(dropMandate).getMandate(policy.mandateHash);

            require(m.account == account, "DropValidator: mandate account mismatch");
            require(m.sessionKey == policy.sessionKey, "DropValidator: mandate sessionKey mismatch");
            require(m.token == policy.token, "DropValidator: mandate token mismatch");
            require(m.recipient == policy.recipient, "DropValidator: mandate recipient mismatch");
            require(m.actionType == DropMandate(dropMandate).ACTION_TYPE_ERC20_TRANSFER(), "DropValidator: unsupported action type");

            // Effective policy must NEVER be broader than human-signed mandate
            require(policy.maxAmount <= m.maxAmount, "DropValidator: policy maxAmount exceeds mandate");
            require(policy.dailyBudget <= m.dailyBudget, "DropValidator: policy dailyBudget exceeds mandate");
            require(policy.validAfter >= m.validAfter, "DropValidator: policy validAfter before mandate");
            require(policy.validUntil <= m.validUntil, "DropValidator: policy validUntil after mandate");
        }

        sessionPolicies[account][policy.sessionKey] = policy;

        emit SessionPolicySet(
            account,
            policy.sessionKey,
            policy.token,
            policy.recipient,
            policy.maxAmount,
            policy.dailyBudget,
            policy.validAfter,
            policy.validUntil,
            policy.mandateHash
        );
    }

    // -------------------------------------------------------------
    // ERC-7579 Validation
    // -------------------------------------------------------------

    /**
     * @notice Validates a PackedUserOperation against onchain session policy.
     * @param userOp The ERC-4337 v0.7 PackedUserOperation.
     * @param userOpHash Hash of the UserOperation.
     * @return validationData Packed ERC-4337 validation result.
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external override returns (uint256 validationData) {
        // 1. Recover Session Key Signer
        address signer = _recoverSigner(userOpHash, userOp.signature);
        if (signer == address(0)) {
            return VALIDATION_FAILED;
        }

        SessionPolicy storage policy = sessionPolicies[userOp.sender][signer];

        // 2. Check Policy Active & Timestamps
        if (!policy.enabled) {
            return VALIDATION_FAILED;
        }
        if (block.timestamp < policy.validAfter || block.timestamp > policy.validUntil) {
            return VALIDATION_FAILED;
        }

        // 3. Dynamic Mandate Verification (if bound to a mandate)
        if (policy.mandateHash != bytes32(0)) {
            if (dropMandate == address(0)) {
                return VALIDATION_FAILED;
            }
            if (DropMandate(dropMandate).isRevoked(policy.mandateHash)) {
                return VALIDATION_FAILED;
            }
            DropMandate.Mandate memory m = DropMandate(dropMandate).getMandate(policy.mandateHash);
            if (block.timestamp < m.validAfter || block.timestamp > m.validUntil) {
                return VALIDATION_FAILED;
            }
        }

        // 4. Inspect Smart Account Calldata & Extract Transfer Amount
        (bool valid, uint256 amount) = _verifyCallData(userOp.callData, policy);
        if (!valid) {
            return VALIDATION_FAILED;
        }

        // 4. Strict Check: Daily Budget Tracking
        uint256 dayIndex = block.timestamp / 1 days;
        uint256 spentToday = dailySpent[userOp.sender][signer][dayIndex];
        if (spentToday + amount > policy.dailyBudget) {
            return VALIDATION_FAILED;
        }

        dailySpent[userOp.sender][signer][dayIndex] = spentToday + amount;

        emit ValidationSuccess(userOp.sender, signer, amount, dailySpent[userOp.sender][signer][dayIndex]);

        // Return packed validation data: authorizer = 0 (success), validUntil, validAfter
        return _packValidationData(false, policy.validUntil, policy.validAfter);
    }

    /**
     * @dev Inspects the UserOperation calldata to ensure it complies strictly with the session policy.
     */
    function _verifyCallData(
        bytes calldata callData,
        SessionPolicy storage policy
    ) internal view returns (bool, uint256) {
        if (callData.length < 4) {
            return (false, 0);
        }

        // Must call execute(bytes32 mode, bytes calldata executionCalldata)
        if (bytes4(callData[0:4]) != IERC7579Execution.execute.selector) {
            return (false, 0);
        }

        (bytes32 mode, bytes memory executionCalldata) = abi.decode(callData[4:], (bytes32, bytes));

        // Strict Check: callType MUST be single call (0x00). Reject delegatecall/batch.
        if (bytes1(mode[0]) != 0x00) {
            return (false, 0);
        }

        // executionCalldata layout: target (20) + value (32) + callData (>= 68)
        if (executionCalldata.length < 52 + 68) {
            return (false, 0);
        }

        address target;
        uint256 value;
        bytes4 innerSelector;
        address recipient;
        uint256 amount;

        assembly {
            let dataPtr := add(executionCalldata, 32)
            // target at byte 0
            target := shr(96, mload(dataPtr))
            // value at byte 20
            value := mload(add(dataPtr, 20))
            // innerSelector at byte 52 (masked to top 4 bytes)
            innerSelector := and(
                mload(add(dataPtr, 52)),
                0xffffffff00000000000000000000000000000000000000000000000000000000
            )
            // recipient at byte 56 (32 bytes word containing address)
            recipient := mload(add(dataPtr, 56))
            // amount at byte 88 (32 bytes word)
            amount := mload(add(dataPtr, 88))
        }

        // Reject non-zero native value
        if (value != 0) {
            return (false, 0);
        }

        // Target must match whitelisted token
        if (target != policy.token) {
            return (false, 0);
        }

        // Strict Check: Selector MUST be transfer(address,uint256)
        if (innerSelector != ERC20_TRANSFER_SELECTOR) {
            return (false, 0);
        }

        // Check approved recipient
        if (recipient != policy.recipient) {
            return (false, 0);
        }

        // Check max transaction amount
        if (amount > policy.maxAmount) {
            return (false, 0);
        }

        return (true, amount);
    }

    /**
     * @notice ERC-1271 Signature Verification
     */
    function isValidSignatureWithSender(
        address,
        bytes32 hash,
        bytes calldata data
    ) external view override returns (bytes4) {
        address signer = _recoverSigner(hash, data);
        if (signer != address(0) && sessionPolicies[msg.sender][signer].enabled) {
            SessionPolicy storage policy = sessionPolicies[msg.sender][signer];
            if (block.timestamp >= policy.validAfter && block.timestamp <= policy.validUntil) {
                return EIP1271_SUCCESS;
            }
        }
        return EIP1271_FAILED;
    }

    // -------------------------------------------------------------
    // Internal Cryptographic & Parsing Helpers
    // -------------------------------------------------------------

    function _recoverSigner(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 32))
                v := byte(0, calldataload(add(signature.offset, 64)))
            }
            if (v < 27) v += 27;

            // Direct raw hash recovery (used by ERC-4337 standard signers)
            address signer = ecrecover(hash, v, r, s);
            if (signer != address(0)) {
                return signer;
            }

            // Fallback: personal_sign eth signed message hash
            bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
            return ecrecover(ethHash, v, r, s);
        }

        // Support explicit (address sessionKeyHint, bytes 65-byte signature)
        if (signature.length >= 85) {
            (address hint, bytes memory sig) = abi.decode(signature, (address, bytes));
            if (sig.length == 65) {
                bytes32 r;
                bytes32 s;
                uint8 v;
                assembly {
                    r := mload(add(sig, 32))
                    s := mload(add(sig, 64))
                    v := byte(0, mload(add(sig, 96)))
                }
                if (v < 27) v += 27;
                address signer = ecrecover(hash, v, r, s);
                if (signer == hint) return signer;
                bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
                signer = ecrecover(ethHash, v, r, s);
                if (signer == hint) return signer;
            }
        }

        return address(0);
    }

    function _packValidationData(
        bool sigFailed,
        uint48 validUntil,
        uint48 validAfter
    ) internal pure returns (uint256) {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }
}
