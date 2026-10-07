// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC7579Account, IERC7579Execution, Execution } from "../interfaces/IERC7579Account.sol";
import { IERC7579Module, MODULE_TYPE_VALIDATOR, MODULE_TYPE_EXECUTOR } from "../interfaces/IERC7579Module.sol";
import { IValidator } from "../interfaces/IValidator.sol";
import { PackedUserOperation, IEntryPoint, VALIDATION_SUCCESS, VALIDATION_FAILED } from "../interfaces/IERC4337.sol";

/**
 * @title ModularSmartAccount
 * @notice REAL ERC-4337 / ERC-7579 MODULAR SMART ACCOUNT
 * @dev Implements:
 *   - ERC-4337 v0.7 validation & execution via EntryPoint
 *   - ERC-7579 module management and execution interfaces
 *   - Secure delegation to installed ERC-7579 validator modules (such as DropValidator)
 *   - Strict call/execution isolation
 */
contract ModularSmartAccount is IERC7579Account {
    // Account Owner (Root authority for installing/uninstalling modules)
    address public owner;

    // Canonical EntryPoint (ERC-4337 v0.7)
    address public immutable entryPoint;

    // Module Registry: moduleTypeId => moduleAddress => installed
    mapping(uint256 => mapping(address => bool)) private _installedModules;

    // Default primary validator for UserOperation authentication
    address public defaultValidator;

    // Execution Mode Constants
    bytes32 public constant EXEC_MODE_SINGLE_CALL = bytes32(0);

    // Modifiers
    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "MSA: only EntryPoint");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == entryPoint || msg.sender == address(this) || msg.sender == owner,
            "MSA: unauthorized execution caller"
        );
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "MSA: only owner");
        _;
    }

    constructor(address _entryPoint, address _owner) {
        require(_entryPoint != address(0), "MSA: zero EntryPoint");
        require(_owner != address(0), "MSA: zero owner");
        entryPoint = _entryPoint;
        owner = _owner;
    }

    // -------------------------------------------------------------
    // ERC-7579 Module Management
    // -------------------------------------------------------------

    function installModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata initData
    ) external override {
        require(msg.sender == owner || msg.sender == address(this), "MSA: unauthorized install");
        require(module != address(0), "MSA: zero module");
        require(!_installedModules[moduleTypeId][module], "MSA: module already installed");

        _installedModules[moduleTypeId][module] = true;

        if (moduleTypeId == MODULE_TYPE_VALIDATOR && defaultValidator == address(0)) {
            defaultValidator = module;
        }

        IERC7579Module(module).onInstall(initData);
        emit ModuleInstalled(moduleTypeId, module);
    }

    function uninstallModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata deInitData
    ) external override {
        require(msg.sender == owner || msg.sender == address(this), "MSA: unauthorized uninstall");
        require(_installedModules[moduleTypeId][module], "MSA: module not installed");

        _installedModules[moduleTypeId][module] = false;

        if (defaultValidator == module) {
            defaultValidator = address(0);
        }

        IERC7579Module(module).onUninstall(deInitData);
        emit ModuleUninstalled(moduleTypeId, module);
    }

    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata
    ) external view override returns (bool) {
        return _installedModules[moduleTypeId][module];
    }

    function supportsModule(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR || moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function supportsExecutionMode(bytes32 mode) external pure override returns (bool) {
        // Supports standard single call (callType == 0x00)
        return bytes1(mode[0]) == 0x00;
    }

    function accountId() external pure override returns (string memory) {
        return "drop.modular.account.v1";
    }

    // -------------------------------------------------------------
    // ERC-4337 v0.7 Validation
    // -------------------------------------------------------------

    /**
     * @notice ERC-4337 EntryPoint validation hook.
     * @dev Routes validation directly to the installed ERC-7579 validator.
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        require(defaultValidator != address(0), "MSA: no validator configured");

        // Delegate validation to the active validator module
        validationData = IValidator(defaultValidator).validateUserOp(userOp, userOpHash);

        // Pre-fund EntryPoint gas deposit if requested
        if (missingAccountFunds > 0) {
            (bool success, ) = payable(entryPoint).call{ value: missingAccountFunds }("");
            require(success, "MSA: failed to pay gas deposit");
        }

        return validationData;
    }

    // -------------------------------------------------------------
    // ERC-7579 Execution
    // -------------------------------------------------------------

    /**
     * @notice Executes a transaction on behalf of the account.
     * @dev Callable by EntryPoint (post-validation), owner, or account itself.
     */
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable override onlyAuthorized {
        // Strict: Only single call (callType == 0x00) supported
        require(bytes1(mode[0]) == 0x00, "MSA: unsupported execution mode");
        require(executionCalldata.length >= 52, "MSA: invalid execution data");

        address target;
        uint256 value;
        assembly {
            // target at offset 0 (20 bytes)
            target := shr(96, calldataload(executionCalldata.offset))
            // value at offset 20 (32 bytes)
            value := calldataload(add(executionCalldata.offset, 20))
        }

        bytes calldata callData = executionCalldata[52:];

        (bool success, bytes memory result) = target.call{ value: value }(callData);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function executeFromExecutor(
        bytes32 mode,
        bytes calldata executionCalldata
    ) external payable override returns (bytes[] memory returnData) {
        require(_installedModules[MODULE_TYPE_EXECUTOR][msg.sender], "MSA: caller not executor module");
        require(bytes1(mode[0]) == 0x00, "MSA: unsupported execution mode");

        address target;
        uint256 value;
        assembly {
            target := shr(96, calldataload(executionCalldata.offset))
            value := calldataload(add(executionCalldata.offset, 20))
        }
        bytes calldata callData = executionCalldata[52:];

        (bool success, bytes memory result) = target.call{ value: value }(callData);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }

        returnData = new bytes[](1);
        returnData[0] = result;
        return returnData;
    }

    /**
     * @notice Fallback to accept native ETH deposits.
     */
    receive() external payable {}
}
