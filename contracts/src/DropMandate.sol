// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOwnableAccount {
    function owner() external view returns (address);
}

/**
 * @title DropMandate
 * @notice Cryptographically enforceable EIP-712 Human Mandates for autonomous AI agents.
 * @dev Enforces:
 *   1. EIP-712 typed signature verification binding authorization to account, authorizer,
 *      agent sessionKey, chainId, token, recipient, actionType, amounts, time window, and nonce.
 *   2. Authorizer MUST be the verified owner of the smart account (IOwnableAccount.owner()).
 *   3. Strict replay protection per authorizer via nonces and unique mandate digests.
 *   4. Instant onchain revocation by authorizer or account.
 */
contract DropMandate {
    // Mandate Structure (Strict EIP-712 fields)
    struct Mandate {
        address account;        // ModularSmartAccount address
        address authorizer;     // Human owner address (must equal account.owner())
        address sessionKey;     // Authorized agent address
        uint256 chainId;        // EVM chain ID to prevent cross-chain replay
        address token;          // Whitelisted ERC-20 token address
        address recipient;      // Whitelisted recipient counterparty
        bytes32 actionType;     // Permitted action: keccak256("ERC20_TRANSFER")
        uint256 maxAmount;      // Maximum per-transaction amount (integer base units)
        uint256 dailyBudget;    // Maximum cumulative daily spending budget
        uint48 validAfter;      // Start timestamp (unix seconds)
        uint48 validUntil;      // Expiration timestamp (unix seconds)
        uint256 nonce;          // Monotonically unique nonce per authorizer
        bytes32 policyHash;     // Cryptographic hash of auxiliary policy metadata
        bytes32 purposeHash;    // Cryptographic hash of human-approved purpose
    }

    // EIP-712 Constants
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant MANDATE_TYPEHASH =
        keccak256(
            "Mandate(address account,address authorizer,address sessionKey,uint256 chainId,address token,address recipient,bytes32 actionType,uint256 maxAmount,uint256 dailyBudget,uint48 validAfter,uint48 validUntil,uint256 nonce,bytes32 policyHash,bytes32 purposeHash)"
        );

    bytes32 public constant ACTION_TYPE_ERC20_TRANSFER = keccak256("ERC20_TRANSFER");

    // EIP-712 Domain Metadata
    string public constant NAME = "DropMandate";
    string public constant VERSION = "1";

    // Storage: mandateHash => Mandate
    mapping(bytes32 => Mandate) public mandates;

    // Storage: mandateHash => isRegistered
    mapping(bytes32 => bool) public isMandateRegistered;

    // Storage: mandateHash => isRevoked
    mapping(bytes32 => bool) public isRevoked;

    // Storage: authorizer => nonce => isUsed
    mapping(address => mapping(uint256 => bool)) public isNonceUsed;

    // Events
    event MandateRegistered(
        bytes32 indexed mandateHash,
        address indexed account,
        address indexed authorizer,
        address sessionKey,
        address token,
        address recipient,
        uint256 maxAmount,
        uint256 dailyBudget,
        uint48 validAfter,
        uint48 validUntil,
        uint256 nonce
    );

    event MandateRevoked(bytes32 indexed mandateHash, address indexed account, address indexed caller);
    event NonceRevoked(address indexed authorizer, uint256 indexed nonce);

    // -------------------------------------------------------------
    // EIP-712 Hashing Utilities
    // -------------------------------------------------------------

    /**
     * @notice Computes the EIP-712 Domain Separator for DropMandate.
     */
    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes(NAME)),
                    keccak256(bytes(VERSION)),
                    block.chainid,
                    address(this)
                )
            );
    }

    /**
     * @notice Computes the EIP-712 struct hash of a Mandate.
     */
    function hashMandate(Mandate calldata mandate) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    MANDATE_TYPEHASH,
                    mandate.account,
                    mandate.authorizer,
                    mandate.sessionKey,
                    mandate.chainId,
                    mandate.token,
                    mandate.recipient,
                    mandate.actionType,
                    mandate.maxAmount,
                    mandate.dailyBudget,
                    mandate.validAfter,
                    mandate.validUntil,
                    mandate.nonce,
                    mandate.policyHash,
                    mandate.purposeHash
                )
            );
    }

    /**
     * @notice Computes the final EIP-712 digest to be signed by the authorizer.
     */
    function getDigest(Mandate calldata mandate) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), hashMandate(mandate)));
    }

    // -------------------------------------------------------------
    // Mandate Registration & Verification
    // -------------------------------------------------------------

    /**
     * @notice Registers an EIP-712 human-signed mandate onchain.
     * @param mandate The full typed mandate.
     * @param signature Cryptographic 65-byte ECDSA signature from the account owner.
     * @return mandateHash The authoritative 32-byte identifier for the registered mandate.
     */
    function registerMandate(
        Mandate calldata mandate,
        bytes calldata signature
    ) external returns (bytes32 mandateHash) {
        // 1. Basic Invariant Checks
        require(mandate.account != address(0), "DropMandate: zero account");
        require(mandate.authorizer != address(0), "DropMandate: zero authorizer");
        require(mandate.sessionKey != address(0), "DropMandate: zero sessionKey");
        require(mandate.token != address(0), "DropMandate: zero token");
        require(mandate.recipient != address(0), "DropMandate: zero recipient");
        require(mandate.maxAmount > 0, "DropMandate: zero maxAmount");
        require(mandate.dailyBudget >= mandate.maxAmount, "DropMandate: dailyBudget < maxAmount");
        require(mandate.validUntil > mandate.validAfter, "DropMandate: invalid time window");
        require(block.timestamp <= mandate.validUntil, "DropMandate: mandate already expired");
        require(mandate.chainId == block.chainid, "DropMandate: chainId mismatch");
        require(mandate.actionType == ACTION_TYPE_ERC20_TRANSFER, "DropMandate: unsupported action type");

        // 2. Replay Protection: Nonce check
        require(!isNonceUsed[mandate.authorizer][mandate.nonce], "DropMandate: nonce already used or revoked");

        // 3. Authenticate Account Ownership
        address accountOwner;
        try IOwnableAccount(mandate.account).owner() returns (address _owner) {
            accountOwner = _owner;
        } catch {
            revert("DropMandate: account does not implement owner()");
        }
        require(mandate.authorizer == accountOwner, "DropMandate: authorizer is not account owner");

        // 4. Verify EIP-712 Cryptographic Signature
        mandateHash = getDigest(mandate);
        require(!isMandateRegistered[mandateHash], "DropMandate: mandate already registered");

        address recovered = _recoverSigner(mandateHash, signature);
        require(recovered == mandate.authorizer, "DropMandate: invalid authorizer signature");

        // 5. Store Mandate & Mark Nonce Used
        isNonceUsed[mandate.authorizer][mandate.nonce] = true;
        mandates[mandateHash] = mandate;
        isMandateRegistered[mandateHash] = true;

        emit MandateRegistered(
            mandateHash,
            mandate.account,
            mandate.authorizer,
            mandate.sessionKey,
            mandate.token,
            mandate.recipient,
            mandate.maxAmount,
            mandate.dailyBudget,
            mandate.validAfter,
            mandate.validUntil,
            mandate.nonce
        );

        return mandateHash;
    }

    /**
     * @notice Pure verification of an EIP-712 mandate signature without state modification.
     */
    function verifySignature(
        Mandate calldata mandate,
        bytes calldata signature
    ) external view returns (bool) {
        bytes32 digest = getDigest(mandate);
        address recovered = _recoverSigner(digest, signature);
        return recovered == mandate.authorizer;
    }

    // -------------------------------------------------------------
    // Revocation & State Queries
    // -------------------------------------------------------------

    /**
     * @notice Revokes a previously registered mandate.
     * @dev Callable only by the mandate authorizer (owner) or the smart account itself.
     */
    function revokeMandate(bytes32 mandateHash) external {
        require(isMandateRegistered[mandateHash], "DropMandate: mandate not registered");
        Mandate memory m = mandates[mandateHash];
        require(
            msg.sender == m.authorizer || msg.sender == m.account,
            "DropMandate: unauthorized revocation caller"
        );
        require(!isRevoked[mandateHash], "DropMandate: already revoked");

        isRevoked[mandateHash] = true;
        emit MandateRevoked(mandateHash, m.account, msg.sender);
    }

    /**
     * @notice Proactively cancels an unused nonce to prevent future mandate registration.
     */
    function revokeNonce(uint256 nonce) external {
        require(!isNonceUsed[msg.sender][nonce], "DropMandate: nonce already used or revoked");
        isNonceUsed[msg.sender][nonce] = true;
        emit NonceRevoked(msg.sender, nonce);
    }

    /**
     * @notice Fetches the full registered Mandate.
     */
    function getMandate(bytes32 mandateHash) external view returns (Mandate memory) {
        require(isMandateRegistered[mandateHash], "DropMandate: mandate not registered");
        return mandates[mandateHash];
    }

    /**
     * @notice Checks whether a mandate is active, registered, within its valid time window, and not revoked.
     */
    function isMandateValid(bytes32 mandateHash) external view returns (bool) {
        if (!isMandateRegistered[mandateHash] || isRevoked[mandateHash]) {
            return false;
        }
        Mandate memory m = mandates[mandateHash];
        if (block.timestamp < m.validAfter || block.timestamp > m.validUntil) {
            return false;
        }
        return true;
    }

    // -------------------------------------------------------------
    // Cryptographic Helpers
    // -------------------------------------------------------------

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        // EIP-2 replay / malleability check
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D57617F029ACF7947A3E8539770ADD2) {
            return address(0);
        }

        if (v != 27 && v != 28) {
            return address(0);
        }

        return ecrecover(digest, v, r, s);
    }
}
