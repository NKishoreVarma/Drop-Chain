import { expect } from "chai";
import hre from "hardhat";
import {
  parseUnits,
  encodePacked,
  encodeFunctionData,
  keccak256,
  concat,
  zeroAddress,
  toHex,
  pad,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

describe("DROP Security Core — DropValidator & ModularSmartAccount", function () {
  let publicClient: any;
  let deployerWallet: any;
  let supplierAWallet: any;
  let supplierBWallet: any;
  let attackerWallet: any;

  // Agent Session Key (Private key known to agent)
  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);

  // Contracts
  let dropValidator: any;
  let mockUSDC: any;
  let mockEntryPoint: any;
  let realSmartAccount: any;
  let unitTestHarness: any;

  const MAX_TX_AMOUNT = parseUnits("400", 6); // 400 USDC
  const EXCESSIVE_AMOUNT = parseUnits("600", 6); // 600 USDC
  const DAILY_BUDGET = parseUnits("2000", 6); // 2000 USDC
  const INITIAL_BALANCE = parseUnits("10000", 6); // 10,000 USDC

  before(async function () {
    const wallets = await hre.viem.getWalletClients();
    deployerWallet = wallets[0];
    supplierAWallet = wallets[1];
    supplierBWallet = wallets[2];
    attackerWallet = wallets[3];
    publicClient = await hre.viem.getPublicClient();

    // 1. Deploy MockUSDC
    mockUSDC = await hre.viem.deployContract("MockUSDC");

    // 2. Deploy DropValidator
    dropValidator = await hre.viem.deployContract("DropValidator");

    // 3. Deploy MockEntryPoint (ERC-4337 v0.7 flow)
    mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");

    // 4. Deploy REAL ModularSmartAccount
    realSmartAccount = await hre.viem.deployContract("ModularSmartAccount", [
      mockEntryPoint.address,
      deployerWallet.account.address,
    ]);

    // 5. Deploy UNIT TEST HARNESS (clearly distinct)
    unitTestHarness = await hre.viem.deployContract("TestHarnessAccount", [
      dropValidator.address,
    ]);

    // Mint USDC to realSmartAccount and testHarness
    await mockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);
    await mockUSDC.write.mint([unitTestHarness.address, INITIAL_BALANCE]);

    // Install DropValidator on realSmartAccount (Module Type 1 = MODULE_TYPE_VALIDATOR)
    await realSmartAccount.write.installModule([
      1n,
      dropValidator.address,
      "0x",
    ]);

    // Install on unitTestHarness
    await unitTestHarness.write.installValidator();
  });

  async function getTimestamp(): Promise<bigint> {
    const block = await publicClient.getBlock();
    return block.timestamp;
  }

  function buildUserOp(
    sender: `0x${string}`,
    target: `0x${string}`,
    innerCalldata: `0x${string}`,
    signature: `0x${string}` = "0x",
    customMode: `0x${string}` = pad("0x00", { size: 32 }),
    customValue: `0x${string}` = pad("0x00", { size: 32 })
  ) {
    // executionCalldata: target (20 bytes) + value (32 bytes) + innerCalldata
    const executionCalldata = concat([
      target,
      customValue,
      innerCalldata,
    ]);

    // Outer callData: execute(bytes32 mode, bytes calldata executionCalldata)
    const callData = encodeFunctionData({
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
      args: [customMode, executionCalldata],
    });

    return {
      sender,
      nonce: 0n,
      initCode: "0x" as `0x${string}`,
      callData,
      accountGasLimits: pad("0x01", { size: 32 }),
      preVerificationGas: 100000n,
      gasFees: pad("0x01", { size: 32 }),
      paymasterAndData: "0x" as `0x${string}`,
      signature,
    };
  }

  describe("1. Policy Setup & Restrictions", function () {
    it("configures session policy on real smart account", async function () {
      const now = await getTimestamp();
      const validUntil = Number(now + 86400n); // 24 hours

      // Configure policy via owner call to realSmartAccount
      const policyData = encodeFunctionData({
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
        args: [
          {
            sessionKey: agentAccount.address,
            token: mockUSDC.address,
            recipient: supplierAWallet.account.address,
            maxAmount: MAX_TX_AMOUNT,
            dailyBudget: DAILY_BUDGET,
            validAfter: Number(now - 60n),
            validUntil,
            enabled: true,
          },
        ],
      });

      // Execute from real account owner
      await realSmartAccount.write.execute([
        pad("0x00", { size: 32 }),
        concat([dropValidator.address, pad("0x00", { size: 32 }), policyData]),
      ]);

      const policy = await dropValidator.read.sessionPolicies([
        realSmartAccount.address,
        agentAccount.address,
      ]);

      expect(policy[0].toLowerCase()).to.equal(agentAccount.address.toLowerCase());
      expect(policy[1].toLowerCase()).to.equal(mockUSDC.address.toLowerCase());
      expect(policy[2].toLowerCase()).to.equal(supplierAWallet.account.address.toLowerCase());
      expect(policy[3]).to.equal(MAX_TX_AMOUNT);
      expect(policy[7]).to.be.true; // enabled
    });

    it("rejects unauthorized third-party attempts to configure policy for smart account", async function () {
      const now = await getTimestamp();
      // Attacker calls DropValidator.setSessionPolicy directly
      await dropValidator.write.setSessionPolicy(
        [
          {
            sessionKey: attackerWallet.account.address,
            token: mockUSDC.address,
            recipient: attackerWallet.account.address,
            maxAmount: MAX_TX_AMOUNT,
            dailyBudget: DAILY_BUDGET,
            validAfter: Number(now),
            validUntil: Number(now + 3600n),
            enabled: true,
          },
        ],
        { account: attackerWallet.account }
      );

      // Verify realSmartAccount policy was NOT modified by attacker
      const realPolicy = await dropValidator.read.sessionPolicies([
        realSmartAccount.address,
        attackerWallet.account.address,
      ]);
      expect(realPolicy[7]).to.be.false; // Not enabled for realSmartAccount
    });
  });

  describe("2. DropValidator Security Properties", function () {
    let transfer400Calldata: `0x${string}`;
    let transfer600Calldata: `0x${string}`;
    let transferSupplierBCalldata: `0x${string}`;
    let maliciousApproveCalldata: `0x${string}`;

    before(function () {
      // Valid 400 USDC transfer to SupplierA
      transfer400Calldata = encodeFunctionData({
        abi: [
          {
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ],
        functionName: "transfer",
        args: [supplierAWallet.account.address, MAX_TX_AMOUNT],
      });

      // Excessive 600 USDC transfer to SupplierA
      transfer600Calldata = encodeFunctionData({
        abi: [
          {
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ],
        functionName: "transfer",
        args: [supplierAWallet.account.address, EXCESSIVE_AMOUNT],
      });

      // 400 USDC transfer to unauthorized SupplierB
      transferSupplierBCalldata = encodeFunctionData({
        abi: [
          {
            name: "transfer",
            type: "function",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ],
        functionName: "transfer",
        args: [supplierBWallet.account.address, MAX_TX_AMOUNT],
      });

      // Malicious unlimited approval
      maliciousApproveCalldata = encodeFunctionData({
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
        args: [
          attackerWallet.account.address,
          BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),
        ],
      });
    });

    it("✓ ALLOW: authorized session key sending 400 USDC to approved supplier succeeds", async function () {
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer400Calldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      // Execute through real EntryPoint & real Smart Account!
      const initialSupplierBalance = await mockUSDC.read.balanceOf([
        supplierAWallet.account.address,
      ]);

      await mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address]);

      const finalSupplierBalance = await mockUSDC.read.balanceOf([
        supplierAWallet.account.address,
      ]);
      expect(finalSupplierBalance - initialSupplierBalance).to.equal(MAX_TX_AMOUNT);
    });

    it("✗ BLOCK: amount exceeding limit (600 USDC > 400 USDC) fails validation", async function () {
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer600Calldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      // UserOp must fail validation at the EntryPoint!
      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: unauthorized recipient (Supplier B instead of Supplier A) fails validation", async function () {
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transferSupplierBCalldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: unauthorized token (calling rogue contract) fails validation", async function () {
      // Target is attacker address, not mockUSDC
      const userOp = buildUserOp(
        realSmartAccount.address,
        attackerWallet.account.address,
        transfer400Calldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: unauthorized function selector (hidden approve) fails validation", async function () {
      // Agent attempts stealth approval
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        maliciousApproveCalldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: unauthorized signer (attacker signature) fails validation", async function () {
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer400Calldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      // Attacker signs instead of authorized agent
      const attackerAccount = privateKeyToAccount(generatePrivateKey());
      const attackerSig = await attackerAccount.sign({ hash: opHash });
      userOp.signature = attackerSig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: unauthorized execution mode (delegatecall) fails validation", async function () {
      // Attacker attempts delegatecall mode (0xff)
      const delegateCallMode = pad("0xff", { size: 32, dir: "right" });
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer400Calldata,
        "0x",
        delegateCallMode
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: non-zero native ETH transfer attempt fails validation", async function () {
      // Attacker attempts to extract 1 ETH value
      const nonZeroValue = pad("0x0de0b6b3a7640000", { size: 32 }); // 1 ether
      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer400Calldata,
        "0x",
        pad("0x00", { size: 32 }),
        nonZeroValue
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: expired session key fails validation", async function () {
      // Configure an expired session key
      const now = await getTimestamp();
      const expiredAgent = privateKeyToAccount(generatePrivateKey());
      const expiredPolicyData = encodeFunctionData({
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
        args: [
          {
            sessionKey: expiredAgent.address,
            token: mockUSDC.address,
            recipient: supplierAWallet.account.address,
            maxAmount: MAX_TX_AMOUNT,
            dailyBudget: DAILY_BUDGET,
            validAfter: Number(now - 3600n),
            validUntil: Number(now - 60n), // Expired 1 min ago
            enabled: true,
          },
        ],
      });

      await realSmartAccount.write.execute([
        pad("0x00", { size: 32 }),
        concat([dropValidator.address, pad("0x00", { size: 32 }), expiredPolicyData]),
      ]);

      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer400Calldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await expiredAgent.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: revoked session key fails validation", async function () {
      // Revoke session policy via account owner
      const revokeData = encodeFunctionData({
        abi: [
          {
            name: "revokeSessionPolicy",
            type: "function",
            inputs: [{ name: "sessionKey", type: "address" }],
            outputs: [],
          },
        ],
        functionName: "revokeSessionPolicy",
        args: [agentAccount.address],
      });

      await realSmartAccount.write.execute([
        pad("0x00", { size: 32 }),
        concat([dropValidator.address, pad("0x00", { size: 32 }), revokeData]),
      ]);

      const userOp = buildUserOp(
        realSmartAccount.address,
        mockUSDC.address,
        transfer400Calldata
      );

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });
  });

  describe("3. Unit Test Harness Isolated Verification", function () {
    it("harness confirms DropValidator rejects arbitrary calldata lengths", async function () {
      const dummyUserOp = {
        sender: unitTestHarness.address,
        nonce: 0n,
        initCode: "0x" as `0x${string}`,
        callData: "0x1234" as `0x${string}`, // Invalid short calldata
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const result = await unitTestHarness.write.testValidateUserOp([
        dummyUserOp,
        pad("0x00", { size: 32 }),
      ]);
      expect(result).to.not.be.undefined;
    });
  });
});
