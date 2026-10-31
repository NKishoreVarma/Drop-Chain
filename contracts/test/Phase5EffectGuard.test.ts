import { expect } from "chai";
import hre from "hardhat";
import {
  parseUnits,
  parseEther,
  encodeFunctionData,
  concat,
  toHex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

describe("Phase 5 — ERC-7579 Effect Guard (DropEffectGuard)", function () {
  this.timeout(120000);

  let publicClient: any;
  let deployerWallet: any;
  let supplierAWallet: any;
  let attackerWallet: any;

  // Human Owner (Owner of ModularSmartAccount)
  const humanOwnerPrivateKey = generatePrivateKey();
  const humanOwnerAccount = privateKeyToAccount(humanOwnerPrivateKey);

  // Contracts
  let mockUSDC: any;
  let adversarialMockUSDC: any;
  let drainingMockUSDC: any;
  let reentrantAttacker: any;
  let mockEntryPoint: any;
  let realSmartAccount: any;
  let dropEffectGuard: any;

  const MODULE_TYPE_HOOK = 4n;
  const INITIAL_BALANCE = parseUnits("1000", 6); // 1,000 USDC
  const TRANSFER_AMOUNT = parseUnits("400", 6); // 400 USDC

  function buildExecuteCalldata(target: `0x${string}`, value: bigint, innerCalldata: `0x${string}`): `0x${string}` {
    const paddedTarget = target.toLowerCase().replace("0x", "").padStart(40, "0");
    const paddedValue = value.toString(16).padStart(64, "0");
    const rawData = innerCalldata.replace("0x", "");
    return `0x${paddedTarget}${paddedValue}${rawData}` as `0x${string}`;
  }

  before(async function () {
    publicClient = await hre.viem.getPublicClient();
    const wallets = await hre.viem.getWalletClients();
    deployerWallet = wallets[0];
    supplierAWallet = wallets[1];
    attackerWallet = wallets[2];

    // Fund human owner account for gas
    await deployerWallet.sendTransaction({
      to: humanOwnerAccount.address,
      value: parseEther("10"),
    });

    // 1. Deploy MockEntryPoint
    mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");

    // 2. Deploy ModularSmartAccount
    realSmartAccount = await hre.viem.deployContract("ModularSmartAccount", [
      mockEntryPoint.address,
      humanOwnerAccount.address,
    ]);

    // 3. Deploy Mock Tokens
    mockUSDC = await hre.viem.deployContract("MockUSDC");
    adversarialMockUSDC = await hre.viem.deployContract("AdversarialMockUSDC", [
      attackerWallet.account.address,
    ]);
    drainingMockUSDC = await hre.viem.deployContract("DrainingMockUSDC");

    // 4. Deploy Reentrant Attacker
    reentrantAttacker = await hre.viem.deployContract("ReentrantAttacker");

    // 5. Deploy DropEffectGuard
    dropEffectGuard = await hre.viem.deployContract("DropEffectGuard");

    // Mint initial balances to smart account
    await mockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);
    await adversarialMockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);
    await drainingMockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);

    // Fund smart account with native ETH
    await deployerWallet.sendTransaction({
      to: realSmartAccount.address,
      value: parseEther("2"),
    });

    // 6. Install DropEffectGuard as MODULE_TYPE_HOOK on ModularSmartAccount
    await realSmartAccount.write.installModule(
      [MODULE_TYPE_HOOK, dropEffectGuard.address, "0x"],
      { account: humanOwnerAccount }
    );
  });

  describe("PART 1: Hook Registration & Module Conformance", function () {
    it("confirms DropEffectGuard is installed as currentHook on smart account", async function () {
      const currentHook = await realSmartAccount.read.currentHook();
      expect(currentHook.toLowerCase()).to.equal(dropEffectGuard.address.toLowerCase());

      const isInstalled = await realSmartAccount.read.isModuleInstalled([
        MODULE_TYPE_HOOK,
        dropEffectGuard.address,
        "0x",
      ]);
      expect(isInstalled).to.be.true;
    });

    it("confirms DropEffectGuard reports initialization status and module type", async function () {
      const initialized = await dropEffectGuard.read.isInitialized([realSmartAccount.address]);
      expect(initialized).to.be.true;

      const isHookType = await dropEffectGuard.read.isModuleType([MODULE_TYPE_HOOK]);
      expect(isHookType).to.be.true;

      const isValidatorType = await dropEffectGuard.read.isModuleType([1n]);
      expect(isValidatorType).to.be.false;
    });

    it("allows smart account owner to manage watched spenders and tokens", async function () {
      await dropEffectGuard.write.addWatchedSpender(
        [realSmartAccount.address, attackerWallet.account.address],
        { account: humanOwnerAccount }
      );

      const isSpenderWatched = await dropEffectGuard.read.isSpenderWatched([
        realSmartAccount.address,
        attackerWallet.account.address,
      ]);
      expect(isSpenderWatched).to.be.true;

      const spenders = await dropEffectGuard.read.getWatchedSpenders([realSmartAccount.address]);
      expect(spenders.map((s: string) => s.toLowerCase())).to.include(
        attackerWallet.account.address.toLowerCase()
      );

      // Add watched token
      await dropEffectGuard.write.addWatchedToken(
        [realSmartAccount.address, mockUSDC.address],
        { account: humanOwnerAccount }
      );
      const isTokenWatched = await dropEffectGuard.read.isTokenWatched([
        realSmartAccount.address,
        mockUSDC.address,
      ]);
      expect(isTokenWatched).to.be.true;
    });

    it("rejects unauthorized third party from managing account watched spenders", async function () {
      await expect(
        dropEffectGuard.write.addWatchedSpender(
          [realSmartAccount.address, supplierAWallet.account.address],
          { account: attackerWallet.account }
        )
      ).to.be.rejectedWith("DropEffectGuard: unauthorized");
    });
  });

  describe("PART 2: Requirement 1 — Normal Expected Transfer", function () {
    it("ALLOW: valid 400 USDC transfer succeeds with preCheck & postCheck verification", async function () {
      const preBalance = await mockUSDC.read.balanceOf([realSmartAccount.address]);
      expect(preBalance).to.equal(INITIAL_BALANCE);

      const transferCalldata = encodeFunctionData({
        abi: mockUSDC.abi,
        functionName: "transfer",
        args: [supplierAWallet.account.address, TRANSFER_AMOUNT],
      });

      const execCalldata = buildExecuteCalldata(mockUSDC.address, 0n, transferCalldata);

      // Execute via ModularSmartAccount (authorized by owner)
      const hash = await realSmartAccount.write.execute(
        [toHex(0, { size: 32 }), execCalldata],
        { account: humanOwnerAccount }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      // Verify post-balances
      const postBalance = await mockUSDC.read.balanceOf([realSmartAccount.address]);
      expect(postBalance).to.equal(INITIAL_BALANCE - TRANSFER_AMOUNT);

      const supplierBalance = await mockUSDC.read.balanceOf([supplierAWallet.account.address]);
      expect(supplierBalance).to.equal(TRANSFER_AMOUNT);

      // Verify no allowance granted to recipient
      const allowance = await mockUSDC.read.allowance([
        realSmartAccount.address,
        supplierAWallet.account.address,
      ]);
      expect(allowance).to.equal(0n);
    });
  });

  describe("PART 3: Requirement 2 — Unexpected Stealth Approval Blocked", function () {
    it("BLOCK: AdversarialMockUSDC sneaking stealth approval to attacker is REVERTED onchain by postCheck", async function () {
      // Ensure attacker is a watched spender
      const isWatched = await dropEffectGuard.read.isSpenderWatched([
        realSmartAccount.address,
        attackerWallet.account.address,
      ]);
      if (!isWatched) {
        await dropEffectGuard.write.addWatchedSpender(
          [realSmartAccount.address, attackerWallet.account.address],
          { account: humanOwnerAccount }
        );
      }

      // Initial state
      const preBalance = await adversarialMockUSDC.read.balanceOf([realSmartAccount.address]);
      expect(preBalance).to.equal(INITIAL_BALANCE);
      const preAllowance = await adversarialMockUSDC.read.allowance([
        realSmartAccount.address,
        attackerWallet.account.address,
      ]);
      expect(preAllowance).to.equal(0n);

      // Prepare transfer calldata for AdversarialMockUSDC
      const transferCalldata = encodeFunctionData({
        abi: adversarialMockUSDC.abi,
        functionName: "transfer",
        args: [supplierAWallet.account.address, TRANSFER_AMOUNT],
      });

      const execCalldata = buildExecuteCalldata(
        adversarialMockUSDC.address,
        0n,
        transferCalldata
      );

      // Attempt execution: postCheck must catch the unexpected approval and REVERT!
      await expect(
        realSmartAccount.write.execute(
          [toHex(0, { size: 32 }), execCalldata],
          { account: humanOwnerAccount }
        )
      ).to.be.rejectedWith("DropEffectGuard: unexpected allowance increase");
    });
  });

  describe("PART 4: Requirement 3 — Balance Delta Mismatch Blocked", function () {
    it("BLOCK: token draining more balance than expected (500 > 400) is REVERTED onchain by postCheck", async function () {
      // Configure DrainingMockUSDC to steal an extra 100 USDC during transfer
      const EXTRA_DRAIN = parseUnits("100", 6);
      await drainingMockUSDC.write.setExtraDrain([EXTRA_DRAIN]);

      const transferCalldata = encodeFunctionData({
        abi: drainingMockUSDC.abi,
        functionName: "transfer",
        args: [supplierAWallet.account.address, TRANSFER_AMOUNT],
      });

      const execCalldata = buildExecuteCalldata(
        drainingMockUSDC.address,
        0n,
        transferCalldata
      );

      // Attempt execution: postCheck must catch delta mismatch (500 != 400) and REVERT!
      await expect(
        realSmartAccount.write.execute(
          [toHex(0, { size: 32 }), execCalldata],
          { account: humanOwnerAccount }
        )
      ).to.be.rejectedWith("DropEffectGuard: balance delta mismatch");
    });
  });

  describe("PART 5: Requirement 4 — PostCheck Atomic Revert Guarantees", function () {
    it("confirms that when postCheck reverts, smart account state is 100% rolled back atomically", async function () {
      // Check AdversarialMockUSDC balances and allowances after the blocked attack
      const accountBalance = await adversarialMockUSDC.read.balanceOf([realSmartAccount.address]);
      expect(accountBalance).to.equal(INITIAL_BALANCE); // Untouched!

      const attackerAllowance = await adversarialMockUSDC.read.allowance([
        realSmartAccount.address,
        attackerWallet.account.address,
      ]);
      expect(attackerAllowance).to.equal(0n); // Untouched! No stealth approval persisted!

      const supplierBalance = await adversarialMockUSDC.read.balanceOf([supplierAWallet.account.address]);
      expect(supplierBalance).to.equal(0n); // Untouched!
    });

    it("confirms that when balance delta mismatch reverts, drained token state is 100% rolled back", async function () {
      const accountBalance = await drainingMockUSDC.read.balanceOf([realSmartAccount.address]);
      expect(accountBalance).to.equal(INITIAL_BALANCE); // 1,000 USDC intact!

      const supplierBalance = await drainingMockUSDC.read.balanceOf([supplierAWallet.account.address]);
      expect(supplierBalance).to.equal(0n); // Untouched!
    });
  });

  describe("PART 6: Requirement 5 — Hook Reentrancy Protection", function () {
    it("BLOCK: reentrant call into ModularSmartAccount.execute is intercepted and REVERTED", async function () {
      // Prepare inner calldata for reentrancy: attacker tries to call execute again
      const reentrantTransferCalldata = encodeFunctionData({
        abi: mockUSDC.abi,
        functionName: "transfer",
        args: [attackerWallet.account.address, TRANSFER_AMOUNT],
      });
      const reentrantExecCalldata = buildExecuteCalldata(
        mockUSDC.address,
        0n,
        reentrantTransferCalldata
      );

      // Install ReentrantAttacker as MODULE_TYPE_EXECUTOR (2)
      await realSmartAccount.write.installModule(
        [2n, reentrantAttacker.address, "0x"],
        { account: humanOwnerAccount }
      );

      // Configure ReentrantAttacker with smart account and execution payload
      await reentrantAttacker.write.configure([
        realSmartAccount.address,
        reentrantExecCalldata,
      ]);

      // Calldata to trigger the exploit on ReentrantAttacker
      const exploitCalldata = encodeFunctionData({
        abi: reentrantAttacker.abi,
        functionName: "exploit",
        args: [],
      });

      const initialExecCalldata = buildExecuteCalldata(
        reentrantAttacker.address,
        0n,
        exploitCalldata
      );

      // Attempt execution: smartAccount calls reentrantAttacker.exploit, which calls smartAccount.execute.
      // preCheck will see _isExecuting == true and REVERT with "DropEffectGuard: reentrant call"
      await expect(
        realSmartAccount.write.execute(
          [toHex(0, { size: 32 }), initialExecCalldata],
          { account: humanOwnerAccount }
        )
      ).to.be.rejectedWith("DropEffectGuard: reentrant call");
    });
  });

  describe("PART 7: Explicit Commitment Controls & Direct Call Protections", function () {
    it("allows manual commitExpectedEffect to enforce custom balance decrease threshold", async function () {
      // Commit an expected effect allowing up to 500 USDC decrease
      const MAX_ALLOWED_DECREASE = parseUnits("500", 6);
      await dropEffectGuard.write.commitExpectedEffect(
        [
          realSmartAccount.address,
          mockUSDC.address,
          supplierAWallet.account.address,
          MAX_ALLOWED_DECREASE,
          0n,
          false, // exactAmount = false, allows <= 500
        ],
        { account: humanOwnerAccount }
      );

      // Transfer 400 USDC (400 <= 500) -> Succeeds!
      const transferCalldata = encodeFunctionData({
        abi: mockUSDC.abi,
        functionName: "transfer",
        args: [supplierAWallet.account.address, TRANSFER_AMOUNT],
      });
      const execCalldata = buildExecuteCalldata(mockUSDC.address, 0n, transferCalldata);

      const hash = await realSmartAccount.write.execute(
        [toHex(0, { size: 32 }), execCalldata],
        { account: humanOwnerAccount }
      );
      await publicClient.waitForTransactionReceipt({ hash });

      // Smart account balance was 600, now 200
      const postBalance = await mockUSDC.read.balanceOf([realSmartAccount.address]);
      expect(postBalance).to.equal(parseUnits("200", 6));
    });

    it("rejects direct unauthorized call to postCheck from an external caller", async function () {
      const dummyHookData = "0x";
      await expect(
        dropEffectGuard.write.postCheck([dummyHookData], {
          account: attackerWallet.account,
        })
      ).to.be.rejected;
    });

    it("rejects preCheck from uninstalled account", async function () {
      await expect(
        dropEffectGuard.write.preCheck(
          [deployerWallet.account.address, 0n, "0x"],
          { account: deployerWallet.account }
        )
      ).to.be.rejectedWith("DropEffectGuard: not installed");
    });
  });

  describe("PART 8: Module Lifecycle & Clean Uninstallation", function () {
    it("allows owner to cleanly uninstall DropEffectGuard", async function () {
      await realSmartAccount.write.uninstallModule(
        [MODULE_TYPE_HOOK, dropEffectGuard.address, "0x"],
        { account: humanOwnerAccount }
      );

      const currentHook = await realSmartAccount.read.currentHook();
      expect(currentHook).to.equal("0x0000000000000000000000000000000000000000");

      const isInstalled = await realSmartAccount.read.isModuleInstalled([
        MODULE_TYPE_HOOK,
        dropEffectGuard.address,
        "0x",
      ]);
      expect(isInstalled).to.be.false;

      const isInitialized = await dropEffectGuard.read.isInitialized([realSmartAccount.address]);
      expect(isInitialized).to.be.false;
    });

    it("executes without hook checks after uninstallation", async function () {
      // Re-mint some USDC to account
      await mockUSDC.write.mint([realSmartAccount.address, parseUnits("100", 6)]);

      const transferCalldata = encodeFunctionData({
        abi: mockUSDC.abi,
        functionName: "transfer",
        args: [supplierAWallet.account.address, parseUnits("100", 6)],
      });
      const execCalldata = buildExecuteCalldata(mockUSDC.address, 0n, transferCalldata);

      // Executes normally without any hook
      const hash = await realSmartAccount.write.execute(
        [toHex(0, { size: 32 }), execCalldata],
        { account: humanOwnerAccount }
      );
      await publicClient.waitForTransactionReceipt({ hash });
    });
  });
});
