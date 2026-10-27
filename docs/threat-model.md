# DROP Threat Model & Security Boundaries

> **Tagline:** Agents get money. Prompt injection gets nothing.  
> **Core Principle:** AI proposes. Contracts decide. Simulation verifies.

---

## 1. System Overview & Trust Assumptions

DROP provides a multi-layer defense-in-depth security perimeter for autonomous AI agents controlling blockchain wallets. 

### Untrusted Actors
1. **The AI Agent / LLM (FLOW Brain):**
   - Untrusted. Susceptible to direct and indirect prompt injection, tool hijacking, hallucination, and social engineering.
   - Output capability is restricted to emitting structured JSON intents conforming to `erc20TransferIntentSchema`. The AI never touches private keys and never crafts raw calldata.
2. **Agent Middleware & Execution Tools:**
   - Untrusted. Can be compromised or MITM'd.
3. **External Contracts & Counterparties:**
   - Untrusted. Tokens, DEXes, or recipients can exhibit adversarial or modified bytecode (e.g., hidden approvals, fees, or proxy upgrades).

### Trusted / Authoritative Primitives
1. **User (Root Authority):**
   - Authorizes session policies and installs/uninstalls modules on the smart account.
2. **Modular Smart Account (`ModularSmartAccount.sol`):**
   - ERC-4337 v0.7 + ERC-7579 modular account. Enforces execution mode validation and delegates userOp authorization to installed validators.
3. **Onchain Validator (`DropValidator.sol`):**
   - Cryptographic and policy checkpoint enforcing session key validity, whitelisted tokens, approved recipients, per-tx amount limits, and daily spend budgets.
4. **Simulation Firewall (`@drop/simulator`, `@drop/decoder`, `@drop/comparator`):**
   - Verifies actual simulated execution effects against pure expected effects derived from the human/AI intent.

---

## 2. Attack Vectors & Defense Matrix

| Attack Vector | Attacker Objective | Defense Layer | Outcome |
| :--- | :--- | :--- | :--- |
| **Direct Prompt Injection** | Convince agent to approve unlimited tokens to attacker | `DropValidator.sol` (Case A) + `canonical-builder` | ❌ **BLOCKED ONCHAIN**: Selector `0x095ea7b3` (`approve`) is rejected during `validateUserOp`. |
| **Stealth Token Side Effects** | Deploy adversarial token that silently grants allowance during `transfer` | Simulation Firewall (Case B: `@drop/comparator`) | ❌ **BLOCKED BEFORE SUBMISSION**: Actual effect diff reveals unexpected `ERC20_APPROVAL`. |
| **Budget Drain** | Agent tricked into sending 10,000 USDC exceeding policy | `DropValidator.sol` | ❌ **BLOCKED ONCHAIN**: Rejects amounts exceeding `maxAmount` (400 USDC) or `dailyBudget`. |
| **Rogue Recipient** | Agent tricked into redirecting supplier payment to attacker | `DropValidator.sol` | ❌ **BLOCKED ONCHAIN**: Recipient mismatch triggers `VALIDATION_FAILED`. |
| **Delegatecall Hijack** | Attacker crafts calldata with execution mode `0xff` to take over account | `DropValidator.sol` | ❌ **BLOCKED ONCHAIN**: Requires `bytes1(mode[0]) == 0x00`. Rejects `0xff`. |
| **Native ETH Drain** | Attacker specifies non-zero ETH value to drain native balance | `DropValidator.sol` | ❌ **BLOCKED ONCHAIN**: Enforces `value == 0`. |
| **Expired Session Abuse** | Replay or late execution using revoked or expired agent key | `DropValidator.sol` | ❌ **BLOCKED ONCHAIN**: Enforces `validAfter <= timestamp <= validUntil` and `enabled == true`. |

---

## 3. The Dual Security Boundary

### Case A: Unauthorized Calldata
Even if an attacker bypasses the offchain pipeline and submits raw calldata directly to the EntryPoint:
- `DropValidator.sol` inspects the calldata in `validateUserOp` before execution.
- It unpacks the execution data and enforces `innerSelector == 0xa9059cbb`.
- Calldata calling `approve`, `transferFrom`, `permit`, or arbitrary targets is rejected onchain with `VALIDATION_FAILED`.

### Case B: Unexpected Execution Effect (The Firewall's True Value)
Calldata inspection alone cannot determine what happens inside an untrusted contract. If an adversarial contract exposes a valid `transfer` interface but contains malicious state manipulation:
- The Simulation Firewall dry-runs the transaction on a local EVM node before signing/bundling.
- Emitted logs are decoded into an `ActualEffectManifest`.
- The Multiset Comparator checks that actual effects match the `ExpectedEffectManifest` exactly.
- If any unauthorized `ERC20_APPROVAL` or unexpected transfer is detected, the transaction is immediately `BLOCKED`.
