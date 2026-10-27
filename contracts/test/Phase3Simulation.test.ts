import { expect } from "chai";
import hre from "hardhat";
import { parseUnits, pad, encodeFunctionData, concat } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

describe("Phase 3 — Simulation Pipeline, Effect Decoder & Intent-vs-Effect Firewall", function () {
  this.timeout(120000);

  let publicClient: any;
  let deployerWallet: any;
  let supplierAWallet: any;
  let attackerWallet: any;

  // Dynamic ESM imports
  let buildCanonicalTransaction: any;
  let decodeSimulationOutput: any;
  let compareEffectManifests: any;
  let evaluateFirewallDecision: any;

  // Agent Session Key
  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);

  // Contracts
  let mockUSDC: any;
  let adversarialMockUSDC: any;
  let dropValidator: any;
  let mockEntryPoint: any;
  let realSmartAccount: any;

  const MAX_TX_AMOUNT = parseUnits("400", 6); // 400 USDC
  const DAILY_BUDGET = parseUnits("2000", 6); // 2000 USDC
  const INITIAL_BALANCE = parseUnits("10000", 6); // 10,000 USDC
  const MANDATE_ID = ("0x" + "d".repeat(64)) as `0x${string}`;

  before(async function () {
    this.timeout(120000);
    console.log("[Setup] Loading ESM modules...");
    // Dynamic import of ESM packages
    const loadBuilder = new Function('return import("@drop/canonical-builder")');
    const loadDecoder = new Function('return import("@drop/decoder")');
    const loadComparator = new Function('return import("@drop/comparator")');

    const [builderMod, decoderMod, comparatorMod] = await Promise.all([
      loadBuilder(),
      loadDecoder(),
      loadComparator(),
    ]);

    buildCanonicalTransaction = builderMod.buildCanonicalTransaction;
    decodeSimulationOutput = decoderMod.decodeSimulationOutput;
    compareEffectManifests = comparatorMod.compareEffectManifests;
    evaluateFirewallDecision = comparatorMod.evaluateFirewallDecision;

    console.log("[Setup] Getting wallet clients...");
    const wallets = await hre.viem.getWalletClients();
    deployerWallet = wallets[0];
    supplierAWallet = wallets[1];
    attackerWallet = wallets[2];
    publicClient = await hre.viem.getPublicClient();

    // 1. Deploy Legitimate MockUSDC
    console.log("[Setup] Deploying MockUSDC...");
    mockUSDC = await hre.viem.deployContract("MockUSDC");

    // 2. Deploy Adversarial MockUSDC test fixture targeting attacker address
    console.log("[Setup] Deploying AdversarialMockUSDC...");
    adversarialMockUSDC = await hre.viem.deployContract("AdversarialMockUSDC", [
      attackerWallet.account.address,
    ]);

    // 3. Deploy DropValidator
    console.log("[Setup] Deploying DropValidator...");
    dropValidator = await hre.viem.deployContract("DropValidator");

    // 4. Deploy MockEntryPoint
    console.log("[Setup] Deploying MockEntryPoint...");
    mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");

    // 5. Deploy REAL ModularSmartAccount
    console.log("[Setup] Deploying ModularSmartAccount...");
    realSmartAccount = await hre.viem.deployContract("ModularSmartAccount", [
      mockEntryPoint.address,
      deployerWallet.account.address,
    ]);

    // Fund smart account with tokens
    console.log("[Setup] Minting initial balances...");
    await mockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);
    await adversarialMockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);

    // Install DropValidator module (Module Type 1 = Validator)
    console.log("[Setup] Installing DropValidator module...");
    await realSmartAccount.write.installModule([
      1n,
      dropValidator.address,
      "0x",
    ]);

    // Configure Agent Session Policy for BOTH tokens
    const block = await publicClient.getBlock();
    const now = block.timestamp;

    const setPolicy = async (tokenAddress: `0x${string}`) => {
      const policy = {
        sessionKey: agentAccount.address,
        token: tokenAddress,
        recipient: supplierAWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: Number(now - 60n),
        validUntil: Number(now + 86400n),
        enabled: true,
      };

      const payload = encodeFunctionData({
        abi: [
          {
            name: "setSessionPolicy",
            type: "function",
            inputs: [
              {
                name: "policy",
                type: "tuple",
                components: [
                  { name: "sessionKey", type: "address" },
                  { name: "token", type: "address" },
                  { name: "recipient", type: "address" },
                  { name: "maxAmount", type: "uint256" },
                  { name: "dailyBudget", type: "uint256" },
                  { name: "validAfter", type: "uint48" },
                  { name: "validUntil", type: "uint48" },
                  { name: "enabled", type: "bool" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [policy],
      });

      await realSmartAccount.write.execute([
        pad("0x00", { size: 32 }),
        concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
      ]);
    };

    await setPolicy(mockUSDC.address);
    await setPolicy(adversarialMockUSDC.address);
  });

  async function packageUserOp(accountCalldata: `0x${string}`) {
    const userOp = {
      sender: realSmartAccount.address,
      nonce: 0n,
      initCode: "0x" as `0x${string}`,
      callData: accountCalldata,
      accountGasLimits: pad("0x01", { size: 32 }),
      preVerificationGas: 100000n,
      gasFees: pad("0x01", { size: 32 }),
      paymasterAndData: "0x" as `0x${string}`,
      signature: "0x" as `0x${string}`,
    };

    const opHash = (await mockEntryPoint.read.getUserOpHash([userOp])) as `0x${string}`;
    userOp.signature = await agentAccount.sign({ hash: opHash });
    return { userOp, opHash };
  }

  // =========================================================================
  // CASE A: Unauthorized Calldata (Rejected Onchain by Validator)
  // =========================================================================
  it("Case A: Unauthorized calldata with hidden approve() is rejected onchain by DropValidator before execution", async function () {
    // Malicious calldata calling approve(attacker, max) instead of transfer()
    const approveCalldata = encodeFunctionData({
      abi: [
        {
          name: "approve",
          type: "function",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [attackerWallet.account.address, (2n ** 256n) - 1n],
    });

    // Encoded inside ModularSmartAccount.execute(mode, executionCalldata)
    const rogueAccountCalldata = encodeFunctionData({
      abi: [
        {
          name: "execute",
          type: "function",
          inputs: [
            { name: "mode", type: "bytes32" },
            { name: "executionCalldata", type: "bytes" },
          ],
          outputs: [],
        },
      ],
      functionName: "execute",
      args: [
        pad("0x00", { size: 32 }),
        concat([mockUSDC.address, pad("0x00", { size: 32 }), approveCalldata]),
      ],
    });

    const { userOp, opHash } = await packageUserOp(rogueAccountCalldata);

    // 1. Check onchain DropValidator.validateUserOp simulation result
    const { result: validationData } = await dropValidator.simulate.validateUserOp([userOp, opHash]);

    // Onchain validationData authorizer: 1 indicates VALIDATION_FAILED
    const authorizer = Number(BigInt(validationData) & 0xffffffffn);
    expect(authorizer).to.equal(1); // Rejected onchain by DropValidator before execution!

    // 2. Verify MockEntryPoint rejects the UserOp with validation failure
    await expect(
      mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
    ).to.be.rejectedWith("EntryPoint: validation failed");

    // Verify allowance remained zero
    const allowance = await mockUSDC.read.allowance([
      realSmartAccount.address,
      attackerWallet.account.address,
    ]);
    expect(allowance).to.equal(0n);
  });

  // =========================================================================
  // CASE B: Unexpected Execution Effect (Caught by Simulation Firewall)
  // =========================================================================
  it("Case B: Permitted transfer calldata sent to AdversarialMockUSDC is BLOCKED by Simulation Firewall before submission", async function () {
    // 1. Agent proposes intent to send 400 USDC to Supplier A using AdversarialMockUSDC
    const intent = {
      version: "1" as const,
      kind: "ERC20_TRANSFER" as const,
      chainId: 84532,
      account: realSmartAccount.address,
      token: adversarialMockUSDC.address,
      recipient: supplierAWallet.account.address,
      amount: "400000000", // 400 USDC (within 400 limit)
      purpose: "supplier_invoice",
      mandateId: MANDATE_ID,
    };

    // 2. Canonical builder compiles transaction & ExpectedEffectManifest
    const compiled = buildCanonicalTransaction(intent);
    expect(compiled.transaction.callData.slice(0, 10)).to.equal("0xa9059cbb"); // transfer selector!

    // Note: If submitted blindly, DropValidator would see valid transfer(supplierA, 400) and pass!
    // But DROP routes through the simulation firewall first:

    // 3. Simulate execution on EVM
    // Dry-run call via publicClient to capture transaction effects
    const txHash = await deployerWallet.sendTransaction({
      to: realSmartAccount.address,
      data: compiled.executionData.accountCalldata,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 4. Effect Decoder decodes raw receipt logs
    const actualManifest = decodeSimulationOutput({
      success: receipt.status === "success",
      logs: receipt.logs,
      gasUsed: receipt.gasUsed,
      isComplete: true,
    });

    // Actual manifest contains the transfer AND the stealth approval!
    expect(actualManifest.effects.length).to.equal(2);
    expect(actualManifest.effects[0].type).to.equal("ERC20_TRANSFER");
    expect(actualManifest.effects[1].type).to.equal("ERC20_APPROVAL");

    // 5. Multiset Comparator compares ExpectedEffectManifest vs ActualEffectManifest
    const diff = compareEffectManifests(compiled.expectedManifest, actualManifest);
    expect(diff.matches).to.be.false;
    expect(diff.reasonCode).to.equal("UNEXPECTED_APPROVAL");
    expect(diff.unexpectedEffects.length).to.equal(1);

    // 6. Firewall Decision Engine
    const decision = evaluateFirewallDecision(diff);
    expect(decision.verdict).to.equal("BLOCK");
    expect(decision.reasonCode).to.equal("UNEXPECTED_APPROVAL");

    // CRITICAL RESULT: Firewall BLOCKS the transaction!
  });

  // =========================================================================
  // LEGITIMATE FLOW: Simulation Matches Expected Manifest -> ALLOW
  // =========================================================================
  it("Legitimate Flow: Valid 400 USDC intent to honest MockUSDC matches simulation effects -> ALLOW -> Executes onchain", async function () {
    const initialSmartAccountBalance = await mockUSDC.read.balanceOf([realSmartAccount.address]);
    const initialSupplierBalance = await mockUSDC.read.balanceOf([supplierAWallet.account.address]);

    // 1. Agent proposes valid intent
    const intent = {
      version: "1" as const,
      kind: "ERC20_TRANSFER" as const,
      chainId: 84532,
      account: realSmartAccount.address,
      token: mockUSDC.address,
      recipient: supplierAWallet.account.address,
      amount: "400000000", // 400 USDC
      purpose: "supplier_payment",
      mandateId: MANDATE_ID,
    };

    // 2. Canonical builder compiles transaction & ExpectedEffectManifest
    const compiled = buildCanonicalTransaction(intent);

    // 3. Simulate execution on EVM
    const txHash = await deployerWallet.sendTransaction({
      to: realSmartAccount.address,
      data: compiled.executionData.accountCalldata,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 4. Effect Decoder decodes raw logs
    const actualManifest = decodeSimulationOutput({
      success: receipt.status === "success",
      logs: receipt.logs,
      gasUsed: receipt.gasUsed,
      isComplete: true,
    });

    // Exactly 1 transfer effect observed
    expect(actualManifest.effects.length).to.equal(1);
    expect(actualManifest.effects[0].type).to.equal("ERC20_TRANSFER");

    // 5. Comparator confirms exact multiset match
    const diff = compareEffectManifests(compiled.expectedManifest, actualManifest);
    expect(diff.matches).to.be.true;
    expect(diff.reasonCode).to.equal("EFFECT_MATCH");

    // 6. Firewall Decision
    const decision = evaluateFirewallDecision(diff);
    expect(decision.verdict).to.equal("ALLOW");
    expect(decision.reasonCode).to.equal("EFFECT_MATCH");

    // 7. Onchain Execution Verification
    const finalSmartAccountBalance = await mockUSDC.read.balanceOf([realSmartAccount.address]);
    const finalSupplierBalance = await mockUSDC.read.balanceOf([supplierAWallet.account.address]);

    expect(initialSmartAccountBalance - finalSmartAccountBalance).to.equal(parseUnits("400", 6));
    expect(finalSupplierBalance - initialSupplierBalance).to.equal(parseUnits("400", 6));
  });
});
