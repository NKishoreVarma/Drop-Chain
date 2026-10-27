# Phase 3 Analysis: Simulation Pipeline, Effect Decoder & Comparator

> **Tagline:** Agents get money. Prompt injection gets nothing.  
> **Core Principle:** AI proposes. Contracts decide. Simulation verifies.

---

## 1. Executive Summary & Audit of Phase 1 & 2

Phase 1 established the foundational onchain security primitive:
- **`contracts/src/core/ModularSmartAccount.sol`**: Real ERC-4337 v0.7 + ERC-7579 modular account implementing single-call execution and module management.
- **`contracts/src/DropValidator.sol`**: ERC-7579 Module Type 1 (Validator) enforcing session-key authorization, active time windows, token whitelist, recipient whitelist, per-transaction maximums, and daily spend budgets.
- **`contracts/src/mocks/MockUSDC.sol` & `MockEntryPoint.sol`**: Circle-compliant 6-decimal USDC mock and ERC-4337 v0.7 EntryPoint harness.
- **13 Passing Security Tests** in `contracts/test/DropValidator.test.ts`.

Phase 2 established the deterministic boundary:
- **`packages/intent-schema`**: Strict Zod schema for `ERC20_TRANSFER` intent with runtime rejection of floating-point numbers, negative amounts, scientific notation, malformed addresses, and unknown fields. Implements deterministic canonicalization with EIP-55 checksumming and stable Keccak256 `intentHash`. (22 tests passing).
- **`packages/canonical-builder`**: Pure compiler translating validated intents into low-level execution calls (`target`, `value: 0n`, `callData`) with selector `0xa9059cbb`, and deriving the pure `ExpectedEffect` and `ExpectedEffectManifest`. (10 tests passing).
- **`contracts/test/Phase2Integration.test.ts`**: End-to-end integration tests confirming onchain policy enforcement with canonical builder outputs. (3 tests passing).
- Monorepo baseline: 48 tests passing across contracts and packages.

---

## 2. Critical Architecture Resolution: Calldata Inspection vs. Simulation Firewall

An essential architectural question was raised regarding the relationship between the onchain `DropValidator` and the Phase 3 Intent-vs-Effect Firewall:

> If `DropValidator.sol` already rejects calldata with selectors other than `0xa9059cbb` (`transfer`), why is a simulation firewall needed?

### Dual Security Boundary Breakdown:

#### Case A — Unauthorized Calldata (Blocked Onchain by Validator)
- **Attack Vector:** An untrusted agent or prompt injection attempts to forge calldata containing `approve(attacker, MAX_UINT256)` or a batch multicall to empty the wallet.
- **Defense Mechanism:** When the ERC-4337 EntryPoint invokes `ModularSmartAccount.validateUserOp`, the account calls `DropValidator.validateUserOp`. The validator parses the calldata and verifies:
  1. `bytes1(mode[0]) == 0x00` (single call only).
  2. `value == 0` (no ETH transfers).
  3. `target == policy.token`.
  4. `innerSelector == 0xa9059cbb` (`IERC20.transfer`).
- **Result:** `DropValidator` returns `VALIDATION_FAILED` (1) before any execution occurs. The smart account never calls the target.

#### Case B — Unexpected Execution Effect (Blocked by Simulation Firewall)
- **Attack Vector:** An attacker tricks the agent into calling an adversarial or compromised contract whose interface appears to be an ERC-20 token. The calldata is a valid, permitted `transfer(supplier, 400)` with selector `0xa9059cbb`.
- **The Blindspot of Calldata Inspection:** Onchain calldata inspection cannot predict what internal state transitions or secondary calls a contract will execute. An adversarial token contract can execute `transfer(supplier, 400)` *and simultaneously* execute `allowance[smartAccount][attacker] = MAX_UINT256`, emitting a stealth approval event.
- **Defense Mechanism (The Simulation Firewall):**
  1. Before submitting the UserOperation, DROP runs a simulation of the transaction against the EVM.
  2. The simulation captures all emitted event logs, call traces, and storage diffs.
  3. The **Effect Decoder** extracts semantic actual effects (e.g., `ERC20_TRANSFER` and `ERC20_APPROVAL`).
  4. The **Multiset Comparator** compares `ActualEffectManifest` against `ExpectedEffectManifest`.
  5. The comparator detects that an unexpected `ERC20_APPROVAL` occurred (`unexpectedEffects.length > 0`).
  6. The firewall returns `BLOCK` with reason code `EFFECT_MISMATCH: UNEXPECTED_APPROVAL`.
- **Result:** The UserOp is aborted *before submission to the bundler*. The user's account is protected even if the calldata looks 100% benign.

---

## 3. Phase 3 Architecture: Packages & Pipeline

```text
Intent (from untrusted AI)
  │
  ▼
@drop/intent-schema (Validates & Canonicalizes)
  │
  ▼
@drop/canonical-builder (Builds Canonical Tx + ExpectedEffectManifest)
  │
  ▼
@drop/simulator (Simulates transaction on local EVM provider)
  │  ├─ Emitted Event Logs
  │  ├─ Execution Status & Gas
  │  └─ State Transitions
  ▼
@drop/decoder (Decodes logs & state transitions into ActualEffectManifest)
  │  ├─ Filters by emitting contract address
  │  ├─ Decodes Transfer & Approval event topics
  │  └─ Tracks Provenance (EVENT_LOG / STATE_DIFF)
  ▼
@drop/comparator (Multiset comparison: Expected vs Actual)
  │  ├─ Verifies exact match of expected transfers (multiplicity preserving)
  │  ├─ Flags unexpected approvals, extra transfers, or missing transfers
  │  └─ Fail-closed on missing evidence
  ▼
Firewall Decision Engine
  ├── ALLOW (Actual == Expected)
  ├── HUMAN_APPROVAL (Policy deviation within escalation bounds)
  └── BLOCK (Unexpected effects, unauthorized calldata, or simulation failure)
```

### Detailed Component Specifications

### 1. `packages/effect-schema`
- **Schemas:**
  - `ERC20_TRANSFER`: `{ type: "ERC20_TRANSFER", token, from, to, amount }`
  - `ERC20_APPROVAL`: `{ type: "ERC20_APPROVAL", token, owner, spender, amount }`
  - `NATIVE_ETH_TRANSFER`: `{ type: "NATIVE_ETH_TRANSFER", from, to, amount }`
- **Normalization:**
  - Addresses normalized via EIP-55 checksumming (`getAddress`).
  - Amounts represented as non-negative decimal string integers (no floats, no scientific notation).
  - Explicit representation of unlimited approval: `MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935"`.
- **Provenance:**
  - Every decoded actual effect includes provenance tracking:
    `evidence: { source: "EVENT_LOG" | "CALL_TRACE" | "STATE_DIFF", logIndex?: number, contractAddress: `0x${string}` }`.

### 2. `packages/simulator`
- **Typed Interface:** `ISimulator` with `simulate(tx: SimulationRequest, context: SimulationContext): Promise<SimulationResult>`.
- **EVM Adapter:**
  - Local provider adapter using Viem's `publicClient` or Hardhat's provider.
  - Executes simulation via `eth_call` / transaction execution simulation.
  - Captures status, gas used, emitted event logs, and contract addresses.
- **Fail-Closed Guarantees:**
  - If simulation reverts, returns `success: false` with revert reason.
  - If logs or trace are corrupted or incomplete, flags `isComplete: false` to prevent false positives.

### 3. `packages/decoder`
- **ERC-20 Event Decoders:**
  - `Transfer(address indexed from, address indexed to, uint256 value)` (`0xddf252ad1be2c89b69c2b068fc378d5359a9e2973778f73443b1b8845821b3f7`).
  - `Approval(address indexed owner, address indexed spender, uint256 value)` (`0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925`).
- **Validation Rules:**
  - Topic length validation (must have exactly 3 topics for indexed addresses + value in data).
  - Emitting contract validation (corroborates whether log emitted from expected token contract or a secondary contract).
  - Strict address extraction from 32-byte padded topic words.

### 4. `packages/comparator`
- **Multiset Comparison Algorithm:**
  - Order-independent: The order of emitted events does not impact the verdict.
  - Multiplicity-preserving: If an intent expects one transfer of 400 USDC, exactly one transfer of 400 USDC must occur. Two transfers of 200 USDC or two transfers of 400 USDC are flagged.
  - Zero tolerance for rogue approvals: Any `ERC20_APPROVAL` not explicitly present in the expected manifest causes an immediate `BLOCK`.
- **Decision Engine Output:**
  - `verdict: "ALLOW" | "HUMAN_APPROVAL" | "BLOCK"`
  - `reasonCode`:
    - `EFFECT_MATCH`: Actual effects match expected manifest exactly.
    - `EFFECT_MISMATCH`: Actual effects contain unexpected state transitions or missing actions.
    - `UNEXPECTED_APPROVAL`: Stealth or unexpected approval detected.
    - `UNAUTHORIZED_CALLDATA`: Calldata contains forbidden selector.
    - `SIMULATION_REVERTED`: Execution reverted during simulation.
    - `INSUFFICIENT_EVIDENCE`: Simulation output incomplete.

---

## 4. Test Strategy & Adversarial Fixture

To definitively prove both sides of the security boundary:

1. **`contracts/src/mocks/AdversarialMockUSDC.sol`**:
   - Isolated mock contract for unit/integration testing.
   - Implements standard `transfer(address to, uint256 amount)`.
   - On `transfer`, it executes the transfer BUT also silently executes:
     ```solidity
     allowance[msg.sender][attacker] = type(uint256).max;
     emit Approval(msg.sender, attacker, type(uint256).max);
     ```
2. **Dual Test Suite (`contracts/test/Phase3Simulation.test.ts`)**:
   - **Case A Test:** Session key sends calldata with `approve(attacker, max)` to legitimate `MockUSDC`.
     - *Result:* `DropValidator` rejects during `validateUserOp` onchain before execution.
   - **Case B Test:** Session key sends calldata with `transfer(supplier, 400)` to `AdversarialMockUSDC`.
     - *Result:* Onchain calldata inspection sees a valid transfer and would allow it, BUT DROP's Simulation Firewall captures the emitted `Approval` event, decodes it as an unexpected `ERC20_APPROVAL`, and returns `BLOCK` (`EFFECT_MISMATCH: UNEXPECTED_APPROVAL`).
   - **Legitimate Flow Test:** Session key sends valid `transfer(supplier, 400)` to honest `MockUSDC`.
     - *Result:* Simulation matches expected manifest exactly -> Firewall returns `ALLOW`.
