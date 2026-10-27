# DROP Architecture & Trust Model

> **Tagline:** Agents get money. Prompt injection gets nothing.  
> **Core Principle:** AI proposes. Contracts decide. Simulation verifies.

---

## 1. Overview & Pipeline

DROP is an AI-agent wallet security system that enforces a strict deterministic and cryptographic boundary between what an AI agent proposes and what actually executes onchain.

```text
Intent (from untrusted AI / FLOW)
  │
  ▼
Intent Schema (@drop/intent-schema)
  │
  ▼
Canonicalization (@drop/intent-schema/canonicalize)
  │
  ▼
Canonical Transaction Builder (@drop/canonical-builder)
  │
  ▼
Expected Effect Manifest (@drop/canonical-builder/effect)
  │
  ▼
Phase 3 Simulation Engine (@drop/simulator)
  │
  ▼
Actual Effect Manifest (@drop/decoder)
  │
  ▼
Multiset Effect Comparator (@drop/comparator)
  │
  ▼
Firewall Decision Engine (ALLOW / HUMAN_APPROVAL / BLOCK)
  │
  ▼
ERC-4337 / ERC-7579 Smart Account (ModularSmartAccount + DropValidator)
  │
  ▼
Blockchain Execution (Base Sepolia / Receipt)
```

---

## 2. The Critical Trust Boundary

> [!IMPORTANT]
> **FLOW / AI may propose intent, but deterministic code converts intent into a canonical transaction. The AI does not receive authorization authority.**

Even if the AI reasoning model (FLOW Brain), the middleware server, or external agent tools are compromised via prompt injection or malicious calldata poisoning:

1. **AI Output is Constrained:** The AI is restricted to emitting strict, structured JSON conforming to `erc20TransferIntentSchema`. It cannot output raw calldata, arbitrary function selectors, or multi-call batches.
2. **Deterministic Translation:** Pure, deterministic code compiles the validated intent into the canonical transaction (`@drop/canonical-builder`). No LLM is involved in calldata creation.
3. **Simulation Diffing (Phase 3):** The transaction's actual simulated state transitions must strictly stay within the Expected Effect Manifest derived from the intent. Any stealth approval (`approve(attacker, max)`) or hidden call causes an immediate `BLOCK`.
4. **Onchain Enforcement (Phase 1):** The onchain `DropValidator` (ERC-7579 Module Type 1) enforces that the session key only calls the whitelisted token with selector `0xa9059cbb`, to the approved recipient, within per-transaction and daily spending limits.

---

## 3. Package Responsibilities

### `@drop/intent-schema`
- **Schema Validation (`src/schema.ts`):** Enforces strict Zod schema for `ERC20_TRANSFER`. Rejects floating-point values, negative numbers, malformed addresses, scientific notation, unknown kinds, and unexpected extra fields.
- **Deterministic Canonicalization (`src/canonicalize.ts`):** Normalizes address checksums (EIP-55), canonicalizes decimal amount representations, enforces deterministic JSON key ordering, and computes stable Keccak256 hashes (`intentHash`).

### `@drop/canonical-builder`
- **Transaction Compilation (`src/builder.ts`):** Converts validated intent into canonical low-level transaction parameters (`target`, `value: 0n`, `callData`) and ERC-7579 execution calldata (`mode: bytes32(0)`, `executionCalldata: concat([target, pad(0, 32), callData])`).
- **Expected Effect Generator (`src/effect.ts`):** Purely derives the Expected Effect (`{ type: "ERC20_TRANSFER", token, from, to, amount }`) and Expected Effect Manifest bound to `intentHash`.

### `@drop/effect-schema`
- **Strict Semantic Effect Schemas (`src/schema.ts`):** Versioned schemas for `ERC20_TRANSFER`, `ERC20_APPROVAL`, and `NATIVE_ETH_TRANSFER`.
- **Normalization Helpers (`src/normalize.ts`):** Formats integer string amounts without floats or scientific notation, handles address validation, and exposes explicit constants for unlimited approvals (`MAX_UINT256_STRING`).
- **Provenance Tracking (`src/types.ts`):** Records evidence provenance (`source: "EVENT_LOG" | "CALL_TRACE" | "STATE_DIFF"`).

### `@drop/simulator`
- **Simulation Interface (`src/types.ts`):** Defines `ISimulator` interface with `simulate(request, context)`.
- **Local EVM Provider Adapter (`src/simulator.ts`):** Dry-runs transactions against local Hardhat/Anvil/Viem providers, extracting emitted event logs, status, and gas consumed.
- **Fail-Closed Guarantees:** Any revert or incomplete trace sets `isComplete: false` to prevent false positive approvals.

### `@drop/decoder`
- **ERC-20 Event Decoders (`src/events.ts`):** Decodes `Transfer` (`0xddf252ad...`) and `Approval` (`0x8c5be1e5...`) event topics. Validates topic length and address byte alignment.
- **Manifest Extraction (`src/decoder.ts`):** Translates raw simulation logs into an `ActualEffectManifest`.

### `@drop/comparator`
- **Multiset Effect Comparator (`src/comparator.ts`):** Performs order-independent, multiplicity-preserving multiset comparison between `ExpectedEffectManifest` and `ActualEffectManifest`. Detects unexpected approvals, extra transfers, or missing transfers.
- **Firewall Decision Engine (`src/engine.ts`):** Evaluates diff results to issue definitive verdicts (`ALLOW`, `HUMAN_APPROVAL`, `BLOCK`) with machine-readable reason codes (`EFFECT_MATCH`, `UNEXPECTED_APPROVAL`, `UNEXPECTED_EFFECTS`, `MISSING_EXPECTED_EFFECTS`, `INSUFFICIENT_EVIDENCE`).

### `contracts`
- **`ModularSmartAccount.sol`:** Real ERC-4337 v0.7 & ERC-7579 modular smart account. Delegates UserOperation validation to installed validator modules.
- **`DropValidator.sol`:** Onchain ERC-7579 validator module enforcing agent session policies, parameter bounds, recipient whitelists, and daily spend budgets.
- **`AdversarialMockUSDC.sol`:** Isolated test fixture proving Case B (stealth approval detection during standard transfer).
