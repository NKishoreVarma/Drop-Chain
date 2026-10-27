# DROP Security Specifications & Invariants

> **Tagline:** Agents get money. Prompt injection gets nothing.  
> **Core Principle:** AI proposes. Contracts decide. Simulation verifies.

---

## 1. Onchain Smart Account & Validator Invariants

### A. ERC-7579 Module Lifecycle (`DropValidator.sol`)
1. **Module Type Isolation:** `isModuleType(1)` returns `true` (Validator only). Does not masquerade as an Executor (`type 2`), Fallback (`type 3`), or Hook (`type 4`).
2. **Account Scoping:** Session policies are strictly isolated by account:
   `sessionPolicies[account][sessionKey]`. An account cannot configure or modify another account's policy.
3. **Restricted Administration:** Only the smart account owner (or self-execution) can invoke `setSessionPolicy` or `revokeSessionPolicy`.

### B. Calldata Verification Invariants (`_verifyCallData`)
1. **Target Authenticity:** `target == policy.token`. The account is strictly prohibited from calling arbitrary contracts or unwhitelisted tokens.
2. **Native Value Prohibition:** `value == 0`. Native ETH cannot be drained through the validator.
3. **Execution Mode Enforcement:** `bytes1(mode[0]) == 0x00` (single call). `0xff` (delegatecall) and batch execution modes are rejected.
4. **Selector Whitelist:** `innerSelector == 0xa9059cbb` (`transfer(address,uint256)`).
   - In assembly, the selector word is strictly bitwise masked:
     `innerSelector := and(mload(add(dataPtr, 52)), 0xffffffff00000000000000000000000000000000000000000000000000000000)`
   - Call data with lengths under 120 bytes (selector + 20-byte target + 32-byte value + 4-byte inner selector + 32-byte recipient + 32-byte amount) is rejected.
5. **Recipient Whitelist:** `recipient == policy.recipient`.
6. **Per-Transaction Spending Limit:** `amount <= policy.maxAmount`.
7. **Daily Budget Enforcement:**
   - Day index calculated deterministically: `dayIndex = block.timestamp / 1 days`.
   - Invariant: `spentToday + amount <= policy.dailyBudget`.

---

## 2. Intent & Canonicalization Invariants (`@drop/intent-schema`)

1. **Strict Type Validation:**
   - Floating point amounts (e.g., `400.5`, `"400.5"`) are rejected at schema validation.
   - Negative amounts and scientific notation (`1e18`) are rejected.
   - Malformed or non-checksummed address inputs are rejected.
2. **Deterministic Canonicalization:**
   - Normalizes addresses using EIP-55 checksumming (`getAddress`).
   - Normalizes decimal strings without leading zeros (e.g. `"0400"` $\rightarrow$ `"400"`).
   - Enforces deterministic dictionary key ordering:
     `["account", "amount", "chainId", "kind", "mandateId", "purpose", "recipient", "token", "version"]`
   - Stable Keccak256 hash generation (`intentHash`).

---

## 3. Simulation & Effect Verification Invariants

1. **Fail-Closed Principle:**
   - Any transaction that reverts during EVM simulation is marked `isComplete: false` and results in an immediate `BLOCK` (`INSUFFICIENT_EVIDENCE`).
   - Any corrupted or malformed event log (e.g. missing topics) fails parsing and forces an incomplete manifest.
2. **Multiset Comparison (`@drop/comparator`):**
   - **Order-Independent:** The order in which the EVM emits logs during complex execution does not cause false positives.
   - **Multiplicity-Preserving:** If the intent specifies 1 transfer of 400 USDC, exactly 1 transfer of 400 USDC must occur. Two transfers of 200 USDC or duplicate transfers are flagged as unauthorized side effects.
3. **Zero Tolerance for Unapproved Approvals:**
   - Any simulated event matching `Approval(owner, spender, amount)` not explicitly pre-authorized in `ExpectedEffectManifest` triggers reason code `UNEXPECTED_APPROVAL` and verdict `BLOCK`.
   - `MAX_UINT256` approvals (`2^256 - 1`) are explicitly flagged as `isUnlimited: true`.
