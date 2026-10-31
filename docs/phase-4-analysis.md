# DROP — Phase 4 Analysis: EIP-712 Human Mandates & Onchain Enforcement

> **Tagline:** Agents get money. Prompt injection gets nothing.  
> **Core Principle:** AI proposes. Contracts decide. Simulation verifies.

---

## 1. Audit of Existing Smart Account & Policy Architecture

Before designing `DropMandate.sol`, we inspected the active implementation across `ModularSmartAccount.sol`, `DropValidator.sol`, and the `@drop/intent-schema` / `@drop/canonical-builder` packages.

### 1.1 Account Ownership Representation & Authentication
- **Representation:** In [`ModularSmartAccount.sol`](file:///Users/kishorevarma/Desktop/drop%20chain/contracts/src/core/ModularSmartAccount.sol), account ownership is explicitly defined as `address public owner;`, initialized immutably at deployment to the authorized deployer/human address.
- **Authentication:** 
  - Standard execution calls check `modifier onlyAuthorized()`, permitting `entryPoint`, `address(this)`, or `owner`.
  - Module management checks `require(msg.sender == owner || msg.sender == address(this))`.
  - Public getter `owner()` exposes the account owner's address.
- **Mandate Authorizer Rule:** For any mandate purporting to authorize transactions from `mandate.account`, the `mandate.authorizer` MUST equal `ModularSmartAccount(mandate.account).owner()`. The cryptographic signature on the EIP-712 mandate digest must recover strictly to this `authorizer`.

### 1.2 Session Policy Creation & Storage
- In [`DropValidator.sol`](file:///Users/kishorevarma/Desktop/drop%20chain/contracts/src/DropValidator.sol):
  - Policies are stored in `mapping(address => mapping(address => SessionPolicy)) public sessionPolicies;` (account => sessionKey => policy).
  - Configured via `setSessionPolicy(SessionPolicy calldata policy)` executed in the context of the smart account (`msg.sender == account`).
  - Currently policies track: `sessionKey`, `token`, `recipient`, `maxAmount`, `dailyBudget`, `validAfter`, `validUntil`, and `enabled`.

### 1.3 Daily Spending Budget Tracking
- Tracked in `mapping(address => mapping(address => mapping(uint256 => uint256))) public dailySpent;` where `dayIndex = block.timestamp / 1 days`.
- In `validateUserOp`, if `spentToday + amount > policy.dailyBudget`, validation fails closed (`VALIDATION_FAILED`).
- This design is deterministic, sound, and tracks cumulative consumption per agent per calendar day. It will remain the single authoritative budget counter.

### 1.4 Mandate Reference in Intent
- In [`@drop/intent-schema`](file:///Users/kishorevarma/Desktop/drop%20chain/packages/intent-schema):
  - `mandateId` is defined as a strict 32-byte hex string: `^0x[0-9a-fA-F]{64}$`.
  - In Phase 4, `mandateId` in the intent references the canonical EIP-712 `mandateHash`.

---

## 2. EIP-712 Typed Mandate Specification

### 2.1 Domain Separator
```solidity
EIP712Domain(
    string name,
    string version,
    uint256 chainId,
    address verifyingContract
)
```
- `name`: `"DropMandate"`
- `version`: `"1"`
- `chainId`: `block.chainid`
- `verifyingContract`: `address(DropMandate)`

### 2.2 Mandate Type
```solidity
Mandate(
    address account,
    address authorizer,
    address sessionKey,
    uint256 chainId,
    address token,
    address recipient,
    bytes32 actionType,
    uint256 maxAmount,
    uint256 dailyBudget,
    uint48 validAfter,
    uint48 validUntil,
    uint256 nonce,
    bytes32 policyHash,
    bytes32 purposeHash
)
```

- TypeHash:
```solidity
keccak256("Mandate(address account,address authorizer,address sessionKey,uint256 chainId,address token,address recipient,bytes32 actionType,uint256 maxAmount,uint256 dailyBudget,uint48 validAfter,uint48 validUntil,uint256 nonce,bytes32 policyHash,bytes32 purposeHash)")
```

### 2.3 Field Specifications & Invariants
1. `account`: The smart account contract address (`ModularSmartAccount`).
2. `authorizer`: The human owner address (`ModularSmartAccount(account).owner()`).
3. `sessionKey`: The authorized agent address granted operational authority.
4. `chainId`: Target EVM chain ID (rejects cross-chain replay).
5. `token`: Whitelisted ERC-20 token address.
6. `recipient`: Whitelisted recipient counterparty.
7. `actionType`: Fixed to `keccak256("ERC20_TRANSFER")`.
8. `maxAmount`: Upper per-transaction limit (integer base units, e.g. 6 decimals for USDC).
9. `dailyBudget`: Upper cumulative daily spending limit.
10. `validAfter` & `validUntil`: Validity window in unix seconds (`uint48`).
11. `nonce`: Monotonically increasing or unique per-authorizer nonce for replay protection.
12. `policyHash`: Hash of extended policy metadata or parameters.
13. `purposeHash`: Hash of the human-approved mandate purpose (e.g. `keccak256("Supplier Invoicing Q4")`).

---

## 3. Onchain Enforcement & Validator Integration

### 3.1 Security Boundary: Mandate $\ge$ Session Policy
A session policy configured in `DropValidator` cannot exceed the authority granted by the human mandate:
- `policy.token == mandate.token`
- `policy.recipient == mandate.recipient`
- `policy.sessionKey == mandate.sessionKey`
- `policy.maxAmount <= mandate.maxAmount` (cannot spend more per tx)
- `policy.dailyBudget <= mandate.dailyBudget` (cannot exceed daily cap)
- `policy.validAfter >= mandate.validAfter` (cannot become active earlier)
- `policy.validUntil <= mandate.validUntil` (cannot stay active later)
- Mandate must be registered and NOT revoked.

### 3.2 Dynamic Revocation Check in `validateUserOp`
When `validateUserOp` executes during UserOperation verification:
1. `DropValidator` looks up `policy.mandateHash`.
2. Asserts `!dropMandate.isRevoked(policy.mandateHash)`.
3. Asserts `block.timestamp <= mandate.validUntil`.
4. If the human authorizer or account owner called `dropMandate.revokeMandate(mandateHash)`, the validator immediately fails validation with `VALIDATION_FAILED` (authorizer = 1), blocking all future agent executions under that mandate.

---

## 4. Replay Protection & Revocation Architecture

1. **Chain Isolation:** EIP-712 domain separator includes `block.chainid` and contract address.
2. **Account Isolation:** `mandate.account` binds authorization strictly to that smart account.
3. **Nonce Invalidation:** `isNonceUsed[authorizer][nonce]` marked `true` upon mandate registration. Nonces cannot be reused across mandates for that authorizer.
4. **Emergency Revocation:**
   - `revokeMandate(bytes32 mandateHash)`: Marks mandate as permanently revoked.
   - `revokeNonce(uint256 nonce)`: Proactively cancels an unused nonce.
