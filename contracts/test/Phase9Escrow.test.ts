import { expect } from "chai";
import hre from "hardhat";
import { parseUnits, keccak256, toHex, pad } from "viem";

describe("Phase 9 — Bonded Agent-to-Agent Escrow (DropEscrow)", function () {
  this.timeout(120000);

  let publicClient: any;
  let buyerWallet: any;
  let sellerWallet: any;
  let rogueWallet: any;

  let mockUSDC: any;
  let dropEscrow: any;

  const PAYMENT_AMOUNT = parseUnits("500", 6); // 500 USDC
  const BOND_AMOUNT = parseUnits("100", 6); // 100 USDC
  const EXPECTED_EFFECT_HASH = keccak256(toHex("DELIVERABLE_STATE_EFFECT_V1"));
  const ROGUE_EFFECT_HASH = keccak256(toHex("ROGUE_STATE_EFFECT_V1"));

  const jobId1 = pad("0x01", { size: 32 });
  const jobId2 = pad("0x02", { size: 32 });
  const jobId3 = pad("0x03", { size: 32 });

  before(async function () {
    publicClient = await hre.viem.getPublicClient();
    const wallets = await hre.viem.getWalletClients();
    buyerWallet = wallets[0];
    sellerWallet = wallets[1];
    rogueWallet = wallets[2];

    // Deploy MockUSDC
    mockUSDC = await hre.viem.deployContract("MockUSDC");

    // Deploy DropEscrow
    dropEscrow = await hre.viem.deployContract("DropEscrow");

    // Mint funds
    await mockUSDC.write.mint([buyerWallet.account.address, parseUnits("10000", 6)]);
    await mockUSDC.write.mint([sellerWallet.account.address, parseUnits("10000", 6)]);
    await mockUSDC.write.mint([rogueWallet.account.address, parseUnits("10000", 6)]);

    // Approve escrow contract
    await mockUSDC.write.approve([dropEscrow.address, parseUnits("10000", 6)], {
      account: buyerWallet.account,
    });
    await mockUSDC.write.approve([dropEscrow.address, parseUnits("10000", 6)], {
      account: sellerWallet.account,
    });
  });

  describe("PART 1: Job Creation & Escrow Deposit", function () {
    it("buyer creates escrow job with required seller bond and deposits payment", async function () {
      const block = await publicClient.getBlock();
      const deadline = BigInt(block.timestamp) + 86400n; // 1 day

      const preBalance = await mockUSDC.read.balanceOf([buyerWallet.account.address]);

      const tx = await dropEscrow.write.createJob(
        [
          jobId1,
          sellerWallet.account.address,
          mockUSDC.address,
          PAYMENT_AMOUNT,
          BOND_AMOUNT,
          EXPECTED_EFFECT_HASH,
          deadline,
        ],
        { account: buyerWallet.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const postBalance = await mockUSDC.read.balanceOf([buyerWallet.account.address]);
      expect(postBalance).to.equal(preBalance - PAYMENT_AMOUNT);

      const job = await dropEscrow.read.getJob([jobId1]);
      expect(job.buyerAccount.toLowerCase()).to.equal(buyerWallet.account.address.toLowerCase());
      expect(job.sellerAccount.toLowerCase()).to.equal(sellerWallet.account.address.toLowerCase());
      expect(job.paymentAmount).to.equal(PAYMENT_AMOUNT);
      expect(job.requiredBond).to.equal(BOND_AMOUNT);
      expect(job.status).to.equal(1); // INITIALIZED
    });

    it("rejects duplicate jobId creation", async function () {
      const block = await publicClient.getBlock();
      const deadline = BigInt(block.timestamp) + 86400n;

      await expect(
        dropEscrow.write.createJob(
          [
            jobId1,
            sellerWallet.account.address,
            mockUSDC.address,
            PAYMENT_AMOUNT,
            BOND_AMOUNT,
            EXPECTED_EFFECT_HASH,
            deadline,
          ],
          { account: buyerWallet.account }
        )
      ).to.be.rejected;
    });

    it("rejects job where seller is buyer", async function () {
      const block = await publicClient.getBlock();
      const deadline = BigInt(block.timestamp) + 86400n;

      await expect(
        dropEscrow.write.createJob(
          [
            pad("0x99", { size: 32 }),
            buyerWallet.account.address,
            mockUSDC.address,
            PAYMENT_AMOUNT,
            BOND_AMOUNT,
            EXPECTED_EFFECT_HASH,
            deadline,
          ],
          { account: buyerWallet.account }
        )
      ).to.be.rejected;
    });
  });

  describe("PART 2: Seller Bond Staking & Activation", function () {
    it("rejects unauthorized third party from staking seller bond", async function () {
      await expect(
        dropEscrow.write.stakeBond([jobId1], {
          account: rogueWallet.account,
        })
      ).to.be.rejected;
    });

    it("allows assigned seller to stake required bond, activating the job", async function () {
      const preSellerBalance = await mockUSDC.read.balanceOf([sellerWallet.account.address]);

      const tx = await dropEscrow.write.stakeBond([jobId1], {
        account: sellerWallet.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const postSellerBalance = await mockUSDC.read.balanceOf([sellerWallet.account.address]);
      expect(postSellerBalance).to.equal(preSellerBalance - BOND_AMOUNT);

      const job = await dropEscrow.read.getJob([jobId1]);
      expect(job.status).to.equal(2); // ACTIVE

      const escrowBalance = await mockUSDC.read.balanceOf([dropEscrow.address]);
      expect(escrowBalance).to.equal(PAYMENT_AMOUNT + BOND_AMOUNT);
    });
  });

  describe("PART 3: Effect-Verified Deliverable Completion & Payout", function () {
    it("BLOCKS completion when deliverable effect hash does not match expected effect", async function () {
      await expect(
        dropEscrow.write.completeJob([jobId1, ROGUE_EFFECT_HASH], {
          account: sellerWallet.account,
        })
      ).to.be.rejected;
    });

    it("ALLOWS completion when deliverable effect hash matches, releasing payment + bond to seller", async function () {
      const preSellerBalance = await mockUSDC.read.balanceOf([sellerWallet.account.address]);

      const tx = await dropEscrow.write.completeJob([jobId1, EXPECTED_EFFECT_HASH], {
        account: sellerWallet.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const postSellerBalance = await mockUSDC.read.balanceOf([sellerWallet.account.address]);
      // Seller gets payment (500) + bond back (100) = +600 USDC!
      expect(postSellerBalance).to.equal(preSellerBalance + PAYMENT_AMOUNT + BOND_AMOUNT);

      const job = await dropEscrow.read.getJob([jobId1]);
      expect(job.status).to.equal(3); // COMPLETED
    });
  });

  describe("PART 4: Deliverable Discrepancy & Seller Bond Slashing", function () {
    it("creates and activates a second job for slashing demonstration", async function () {
      const block = await publicClient.getBlock();
      const deadline = BigInt(block.timestamp) + 86400n;

      await dropEscrow.write.createJob(
        [
          jobId2,
          sellerWallet.account.address,
          mockUSDC.address,
          PAYMENT_AMOUNT,
          BOND_AMOUNT,
          EXPECTED_EFFECT_HASH,
          deadline,
        ],
        { account: buyerWallet.account }
      );

      await dropEscrow.write.stakeBond([jobId2], {
        account: sellerWallet.account,
      });

      const job = await dropEscrow.read.getJob([jobId2]);
      expect(job.status).to.equal(2); // ACTIVE
    });

    it("buyer slashes malicious seller: refunds payment AND awards slashed bond to buyer", async function () {
      const preBuyerBalance = await mockUSDC.read.balanceOf([buyerWallet.account.address]);

      const tx = await dropEscrow.write.slashJob(
        [jobId2, "Worker attempted unauthorized effect modification"],
        { account: buyerWallet.account }
      );
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const postBuyerBalance = await mockUSDC.read.balanceOf([buyerWallet.account.address]);
      // Buyer gets original payment (500) + seller slashed bond (100) = +600 USDC!
      expect(postBuyerBalance).to.equal(preBuyerBalance + PAYMENT_AMOUNT + BOND_AMOUNT);

      const job = await dropEscrow.read.getJob([jobId2]);
      expect(job.status).to.equal(6); // SLASHED
    });
  });

  describe("PART 5: Refund of Unbonded Jobs", function () {
    it("buyer can cancel and refund an unbonded job", async function () {
      const block = await publicClient.getBlock();
      const deadline = BigInt(block.timestamp) + 86400n;

      await dropEscrow.write.createJob(
        [
          jobId3,
          sellerWallet.account.address,
          mockUSDC.address,
          PAYMENT_AMOUNT,
          BOND_AMOUNT,
          EXPECTED_EFFECT_HASH,
          deadline,
        ],
        { account: buyerWallet.account }
      );

      const preBuyerBalance = await mockUSDC.read.balanceOf([buyerWallet.account.address]);

      const tx = await dropEscrow.write.refundJob([jobId3], {
        account: buyerWallet.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const postBuyerBalance = await mockUSDC.read.balanceOf([buyerWallet.account.address]);
      expect(postBuyerBalance).to.equal(preBuyerBalance + PAYMENT_AMOUNT);

      const job = await dropEscrow.read.getJob([jobId3]);
      expect(job.status).to.equal(5); // REFUNDED
    });
  });
});
