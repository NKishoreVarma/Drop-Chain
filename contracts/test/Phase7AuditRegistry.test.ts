import { expect } from "chai";
import hre from "hardhat";
import { keccak256, toHex, pad } from "viem";

describe("Phase 7 — Cryptographic Audit Trail (DropAuditRegistry)", function () {
  this.timeout(120000);

  let publicClient: any;
  let deployerWallet: any;
  let userWallet: any;
  let dropAuditRegistry: any;

  // Audit package functions
  let computeReceiptIdTS: any;
  let buildAuditReceiptTS: any;

  const dummyMandateHash = pad("0x01", { size: 32 });
  const dummyIntentHash = pad("0x02", { size: 32 });
  const dummyCanonicalTxHash = pad("0x03", { size: 32 });
  const dummySimulationHash = pad("0x04", { size: 32 });
  const dummyEffectDiffHash = pad("0x05", { size: 32 });
  const dummyUserOpHash = pad("0x06", { size: 32 });

  before(async function () {
    publicClient = await hre.viem.getPublicClient();
    const wallets = await hre.viem.getWalletClients();
    deployerWallet = wallets[0];
    userWallet = wallets[1];

    // Load TS audit package dynamically
    const loadAudit = new Function('return import("@drop/audit")');
    const auditMod = await loadAudit();
    computeReceiptIdTS = auditMod.computeReceiptId;
    buildAuditReceiptTS = auditMod.buildAuditReceipt;

    // Deploy DropAuditRegistry
    dropAuditRegistry = await hre.viem.deployContract("DropAuditRegistry");
  });

  describe("PART 1: Deterministic Hashing Cross-Verification", function () {
    it("onchain computeReceiptId strictly matches TypeScript computeReceiptId byte-for-byte", async function () {
      const onchainReceiptId = await dropAuditRegistry.read.computeReceiptId([
        dummyMandateHash,
        dummyIntentHash,
        dummyCanonicalTxHash,
        dummySimulationHash,
        dummyEffectDiffHash,
        dummyUserOpHash,
      ]);

      const tsReceiptId = computeReceiptIdTS({
        mandateHash: dummyMandateHash,
        intentHash: dummyIntentHash,
        canonicalTxHash: dummyCanonicalTxHash,
        simulationHash: dummySimulationHash,
        effectDiffHash: dummyEffectDiffHash,
        userOpHash: dummyUserOpHash,
      });

      expect(onchainReceiptId.toLowerCase()).to.equal(tsReceiptId.toLowerCase());
    });
  });

  describe("PART 2: Immutable Receipt Recording & Retrieval", function () {
    let recordedReceiptId: `0x${string}`;

    it("records a valid APPROVED audit receipt and emits event", async function () {
      const account = userWallet.account.address;
      const sessionKey = deployerWallet.account.address;
      const decisionApproved = 1; // APPROVED
      const reason = "Simulation match: 400 USDC to Supplier A approved";

      const tx = await dropAuditRegistry.write.recordReceipt([
        dummyMandateHash,
        dummyIntentHash,
        dummyCanonicalTxHash,
        dummySimulationHash,
        dummyEffectDiffHash,
        dummyUserOpHash,
        account,
        sessionKey,
        decisionApproved,
        reason,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      recordedReceiptId = await dropAuditRegistry.read.computeReceiptId([
        dummyMandateHash,
        dummyIntentHash,
        dummyCanonicalTxHash,
        dummySimulationHash,
        dummyEffectDiffHash,
        dummyUserOpHash,
      ]);

      const receipt = await dropAuditRegistry.read.getReceipt([recordedReceiptId]);
      expect(receipt.receiptId.toLowerCase()).to.equal(recordedReceiptId.toLowerCase());
      expect(receipt.mandateHash.toLowerCase()).to.equal(dummyMandateHash.toLowerCase());
      expect(receipt.account.toLowerCase()).to.equal(account.toLowerCase());
      expect(receipt.decision).to.equal(decisionApproved);
      expect(receipt.reason).to.equal(reason);
      expect(receipt.timestamp > 0n).to.be.true;
    });

    it("indexes receipt correctly under account and mandate", async function () {
      const mandateReceipts = await dropAuditRegistry.read.getReceiptsByMandate([dummyMandateHash]);
      expect(mandateReceipts.map((r: string) => r.toLowerCase())).to.include(
        recordedReceiptId.toLowerCase()
      );

      const accountReceipts = await dropAuditRegistry.read.getReceiptsByAccount([userWallet.account.address]);
      expect(accountReceipts.map((r: string) => r.toLowerCase())).to.include(
        recordedReceiptId.toLowerCase()
      );

      const total = await dropAuditRegistry.read.totalReceipts();
      expect(total >= 1n).to.be.true;
    });

    it("records a BLOCKED audit receipt with discrepancy reason", async function () {
      const account = userWallet.account.address;
      const sessionKey = deployerWallet.account.address;
      const decisionBlocked = 2; // BLOCKED
      const reason = "Simulation mismatch: unexpected allowance granted to rogue spender";

      const blockedUserOpHash = pad("0x07", { size: 32 });

      const tx = await dropAuditRegistry.write.recordReceipt([
        dummyMandateHash,
        dummyIntentHash,
        dummyCanonicalTxHash,
        dummySimulationHash,
        dummyEffectDiffHash,
        blockedUserOpHash,
        account,
        sessionKey,
        decisionBlocked,
        reason,
      ]);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const blockedReceiptId = await dropAuditRegistry.read.computeReceiptId([
        dummyMandateHash,
        dummyIntentHash,
        dummyCanonicalTxHash,
        dummySimulationHash,
        dummyEffectDiffHash,
        blockedUserOpHash,
      ]);

      const receipt = await dropAuditRegistry.read.getReceipt([blockedReceiptId]);
      expect(receipt.decision).to.equal(decisionBlocked);
      expect(receipt.reason).to.equal(reason);
    });
  });

  describe("PART 3: Security Properties & Invariants", function () {
    it("REJECTS: duplicate receipt recording with same parameters", async function () {
      await expect(
        dropAuditRegistry.write.recordReceipt([
          dummyMandateHash,
          dummyIntentHash,
          dummyCanonicalTxHash,
          dummySimulationHash,
          dummyEffectDiffHash,
          dummyUserOpHash,
          userWallet.account.address,
          deployerWallet.account.address,
          1,
          "duplicate test",
        ])
      ).to.be.rejectedWith("DropAuditRegistry: receipt already exists");
    });

    it("REJECTS: recording with zero account address", async function () {
      await expect(
        dropAuditRegistry.write.recordReceipt([
          dummyMandateHash,
          dummyIntentHash,
          dummyCanonicalTxHash,
          dummySimulationHash,
          dummyEffectDiffHash,
          pad("0x99", { size: 32 }),
          "0x0000000000000000000000000000000000000000",
          deployerWallet.account.address,
          1,
          "zero account test",
        ])
      ).to.be.rejected;
    });

    it("REJECTS: recording with invalid/UNKNOWN decision (0)", async function () {
      await expect(
        dropAuditRegistry.write.recordReceipt([
          dummyMandateHash,
          dummyIntentHash,
          dummyCanonicalTxHash,
          dummySimulationHash,
          dummyEffectDiffHash,
          pad("0x99", { size: 32 }),
          userWallet.account.address,
          deployerWallet.account.address,
          0, // UNKNOWN
          "unknown decision test",
        ])
      ).to.be.rejected;
    });

    it("REJECTS: querying a non-existent receiptId", async function () {
      const nonExistentId = pad("0xff", { size: 32 });
      await expect(
        dropAuditRegistry.read.getReceipt([nonExistentId])
      ).to.be.rejected;
    });
  });
});
