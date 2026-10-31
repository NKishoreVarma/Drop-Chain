import { expect } from "chai";
import hre from "hardhat";
import {
  parseUnits,
  parseEther,
  pad,
  encodeFunctionData,
  concat,
  keccak256,
  toHex,
  stringToHex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

describe("Phase 4 — EIP-712 Human Mandates & Onchain Enforcement", function () {
  this.timeout(120000);

  let publicClient: any;
  let deployerWallet: any;
  let supplierAWallet: any;
  let supplierBWallet: any;
  let attackerWallet: any;

  // Human Authorizer (Owner of Smart Account)
  const humanOwnerPrivateKey = generatePrivateKey();
  const humanOwnerAccount = privateKeyToAccount(humanOwnerPrivateKey);

  // Agent Session Key
  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);

  // Attacker Agent Key
  const rogueAgentPrivateKey = generatePrivateKey();
  const rogueAgentAccount = privateKeyToAccount(rogueAgentPrivateKey);

  // Contracts
  let mockUSDC: any;
  let dropMandate: any;
  let dropValidator: any;
  let mockEntryPoint: any;
  let realSmartAccount: any;
  let chainId: number;

  const MAX_TX_AMOUNT = parseUnits("400", 6); // 400 USDC
  const DAILY_BUDGET = parseUnits("2000", 6); // 2000 USDC
  const INITIAL_BALANCE = parseUnits("10000", 6); // 10,000 USDC
  const ACTION_TYPE_ERC20_TRANSFER = keccak256(toHex("ERC20_TRANSFER"));
  const PURPOSE_HASH = keccak256(toHex("Q4 Supplier Invoice Settlements"));
  const POLICY_HASH = pad("0x01", { size: 32 });

  // Dynamic ESM imports
  let buildCanonicalTransaction: any;
  let decodeSimulationOutput: any;
  let compareEffectManifests: any;
  let evaluateFirewallDecision: any;

  // EIP-712 Types for Viem signTypedData
  const mandateEIP712Types = {
    Mandate: [
      { name: "account", type: "address" },
      { name: "authorizer", type: "address" },
      { name: "sessionKey", type: "address" },
      { name: "chainId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "actionType", type: "bytes32" },
      { name: "maxAmount", type: "uint256" },
      { name: "dailyBudget", type: "uint256" },
      { name: "validAfter", type: "uint48" },
      { name: "validUntil", type: "uint48" },
      { name: "nonce", type: "uint256" },
      { name: "policyHash", type: "bytes32" },
      { name: "purposeHash", type: "bytes32" },
    ],
  } as const;

  function getEIP712Domain(verifyingContract: `0x${string}`) {
    return {
      name: "DropMandate",
      version: "1",
      chainId: BigInt(chainId),
      verifyingContract,
    };
  }

  before(async function () {
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

    const wallets = await hre.viem.getWalletClients();
    deployerWallet = wallets[0];
    supplierAWallet = wallets[1];
    supplierBWallet = wallets[2];
    attackerWallet = wallets[3];
    publicClient = await hre.viem.getPublicClient();
    chainId = await publicClient.getChainId();

    // Fund humanOwnerAccount with ETH for gas
    await deployerWallet.sendTransaction({
      to: humanOwnerAccount.address,
      value: parseEther("10"),
    });

    // 1. Deploy MockUSDC
    mockUSDC = await hre.viem.deployContract("MockUSDC");

    // 2. Deploy MockEntryPoint
    mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");

    // 3. Deploy REAL ModularSmartAccount owned by humanOwnerAccount
    realSmartAccount = await hre.viem.deployContract("ModularSmartAccount", [
      mockEntryPoint.address,
      humanOwnerAccount.address,
    ]);

    // Fund smart account with 10,000 USDC
    await mockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);

    // 4. Deploy DropMandate
    dropMandate = await hre.viem.deployContract("DropMandate");

    // 5. Deploy DropValidator and configure dropMandate
    dropValidator = await hre.viem.deployContract("DropValidator");
    await dropValidator.write.setDropMandate([dropMandate.address]);

    // 6. Install DropValidator module on smart account (Module Type 1 = Validator)
    await realSmartAccount.write.installModule(
      [1n, dropValidator.address, "0x"],
      { account: humanOwnerAccount }
    );
  });

  async function createValidMandate(nonce: bigint = 1n) {
    const block = await publicClient.getBlock();
    const now = block.timestamp;

    const mandate = {
      account: realSmartAccount.address,
      authorizer: humanOwnerAccount.address,
      sessionKey: agentAccount.address,
      chainId: BigInt(chainId),
      token: mockUSDC.address,
      recipient: supplierAWallet.account.address,
      actionType: ACTION_TYPE_ERC20_TRANSFER,
      maxAmount: MAX_TX_AMOUNT,
      dailyBudget: DAILY_BUDGET,
      validAfter: Number(now - 60n),
      validUntil: Number(now + 86400n),
      nonce,
      policyHash: POLICY_HASH,
      purposeHash: PURPOSE_HASH,
    };

    const signature = await humanOwnerAccount.signTypedData({
      domain: getEIP712Domain(dropMandate.address),
      types: mandateEIP712Types,
      primaryType: "Mandate",
      message: mandate,
    });

    return { mandate, signature };
  }

  describe("PART 1: EIP-712 Typed Mandate Signature & Verification", function () {
    it("verifies a valid human-signed EIP-712 mandate", async function () {
      const { mandate, signature } = await createValidMandate(100n);
      const isValid = await dropMandate.read.verifySignature([mandate, signature]);
      expect(isValid).to.be.true;
    });

    it("registers a valid human-signed mandate onchain and returns unique mandateHash", async function () {
      const { mandate, signature } = await createValidMandate(1n);
      const expectedDigest = await dropMandate.read.getDigest([mandate]);

      const txHash = await dropMandate.write.registerMandate([mandate, signature]);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const isRegistered = await dropMandate.read.isMandateRegistered([expectedDigest]);
      expect(isRegistered).to.be.true;

      const registered = await dropMandate.read.getMandate([expectedDigest]);
      expect(registered.account.toLowerCase()).to.equal(realSmartAccount.address.toLowerCase());
      expect(registered.authorizer.toLowerCase()).to.equal(humanOwnerAccount.address.toLowerCase());
      expect(registered.sessionKey.toLowerCase()).to.equal(agentAccount.address.toLowerCase());
      expect(registered.maxAmount).to.equal(MAX_TX_AMOUNT);
    });

    it("REJECTS: invalid signature (e.g. signed by unauthorized third-party)", async function () {
      const { mandate } = await createValidMandate(2n);
      const rogueSigner = privateKeyToAccount(generatePrivateKey());
      const attackerSig = await rogueSigner.signTypedData({
        domain: getEIP712Domain(dropMandate.address),
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: mandate,
      });

      await expect(
        dropMandate.write.registerMandate([mandate, attackerSig])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });

    it("REJECTS: altered amount limit (signature tampering)", async function () {
      const { mandate, signature } = await createValidMandate(3n);
      // Tamper amount from 400 to 500 USDC
      const tamperedMandate = { ...mandate, maxAmount: parseUnits("500", 6) };

      await expect(
        dropMandate.write.registerMandate([tamperedMandate, signature])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });

    it("REJECTS: altered recipient (counterparty substitution)", async function () {
      const { mandate, signature } = await createValidMandate(4n);
      // Tamper recipient to Supplier B
      const tamperedMandate = { ...mandate, recipient: supplierBWallet.account.address };

      await expect(
        dropMandate.write.registerMandate([tamperedMandate, signature])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });

    it("REJECTS: altered token address", async function () {
      const { mandate, signature } = await createValidMandate(5n);
      const tamperedMandate = { ...mandate, token: supplierBWallet.account.address };

      await expect(
        dropMandate.write.registerMandate([tamperedMandate, signature])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });

    it("REJECTS: altered agent session key", async function () {
      const { mandate, signature } = await createValidMandate(6n);
      const tamperedMandate = { ...mandate, sessionKey: rogueAgentAccount.address };

      await expect(
        dropMandate.write.registerMandate([tamperedMandate, signature])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });

    it("REJECTS: altered policy hash", async function () {
      const { mandate, signature } = await createValidMandate(7n);
      const tamperedMandate = { ...mandate, policyHash: pad("0xff", { size: 32 }) };

      await expect(
        dropMandate.write.registerMandate([tamperedMandate, signature])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });

    it("REJECTS: wrong chainId (cross-chain replay protection)", async function () {
      const block = await publicClient.getBlock();
      const now = block.timestamp;
      const wrongChainMandate = {
        account: realSmartAccount.address,
        authorizer: humanOwnerAccount.address,
        sessionKey: agentAccount.address,
        chainId: 1n, // Mainnet chain ID instead of testnet
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        actionType: ACTION_TYPE_ERC20_TRANSFER,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: Number(now - 60n),
        validUntil: Number(now + 86400n),
        nonce: 8n,
        policyHash: POLICY_HASH,
        purposeHash: PURPOSE_HASH,
      };

      const sig = await humanOwnerAccount.signTypedData({
        domain: { ...getEIP712Domain(dropMandate.address), chainId: 1n },
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: wrongChainMandate,
      });

      await expect(
        dropMandate.write.registerMandate([wrongChainMandate, sig])
      ).to.be.rejectedWith("DropMandate: chainId mismatch");
    });

    it("REJECTS: wrong authorizer (authorizer != account.owner())", async function () {
      const block = await publicClient.getBlock();
      const now = block.timestamp;
      const fakeAuthorizer = privateKeyToAccount(generatePrivateKey());

      const wrongAuthorizerMandate = {
        account: realSmartAccount.address,
        authorizer: fakeAuthorizer.address, // Not the owner of realSmartAccount!
        sessionKey: agentAccount.address,
        chainId: BigInt(chainId),
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        actionType: ACTION_TYPE_ERC20_TRANSFER,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: Number(now - 60n),
        validUntil: Number(now + 86400n),
        nonce: 9n,
        policyHash: POLICY_HASH,
        purposeHash: PURPOSE_HASH,
      };

      const sig = await fakeAuthorizer.signTypedData({
        domain: getEIP712Domain(dropMandate.address),
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: wrongAuthorizerMandate,
      });

      await expect(
        dropMandate.write.registerMandate([wrongAuthorizerMandate, sig])
      ).to.be.rejectedWith("DropMandate: authorizer is not account owner");
    });

    it("REJECTS: wrong account (signature binding to different account)", async function () {
      const { mandate, signature } = await createValidMandate(10n);
      const tamperedMandate = { ...mandate, account: supplierAWallet.account.address };

      await expect(
        dropMandate.write.registerMandate([tamperedMandate, signature])
      ).to.be.rejected;
    });

    it("REJECTS: invalid domain (signature intended for different verifying contract)", async function () {
      const { mandate } = await createValidMandate(11n);
      // Sign with fake verifyingContract address
      const invalidDomainSig = await humanOwnerAccount.signTypedData({
        domain: getEIP712Domain(supplierAWallet.account.address),
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: mandate,
      });

      await expect(
        dropMandate.write.registerMandate([mandate, invalidDomainSig])
      ).to.be.rejectedWith("DropMandate: invalid authorizer signature");
    });
  });

  describe("PART 2: Replay Protection & Mandate Lifecycle", function () {
    it("REJECTS: nonce reuse (replay attack with same nonce)", async function () {
      // Register with nonce 20
      const { mandate, signature } = await createValidMandate(20n);
      await dropMandate.write.registerMandate([mandate, signature]);

      // Attempt to register again with same nonce 20
      await expect(
        dropMandate.write.registerMandate([mandate, signature])
      ).to.be.rejectedWith("DropMandate: nonce already used or revoked");
    });

    it("REJECTS: duplicate mandate registration", async function () {
      const isUsed = await dropMandate.read.isNonceUsed([humanOwnerAccount.address, 1n]);
      expect(isUsed).to.be.true;
    });

    it("allows authorizer to proactively cancel an unused nonce via revokeNonce", async function () {
      await dropMandate.write.revokeNonce([999n], { account: humanOwnerAccount });
      const isUsed = await dropMandate.read.isNonceUsed([humanOwnerAccount.address, 999n]);
      expect(isUsed).to.be.true;

      // Attempt to register with revoked nonce fails
      const { mandate, signature } = await createValidMandate(999n);
      await expect(
        dropMandate.write.registerMandate([mandate, signature])
      ).to.be.rejectedWith("DropMandate: nonce already used or revoked");
    });

    it("revocation: authorizer can revoke an active registered mandate", async function () {
      const { mandate, signature } = await createValidMandate(30n);
      const mandateHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      expect(await dropMandate.read.isMandateValid([mandateHash])).to.be.true;

      // Revoke as humanOwner
      await dropMandate.write.revokeMandate([mandateHash], { account: humanOwnerAccount });

      expect(await dropMandate.read.isRevoked([mandateHash])).to.be.true;
      expect(await dropMandate.read.isMandateValid([mandateHash])).to.be.false;
    });

    it("REJECTS: unauthorized caller cannot revoke someone else's mandate", async function () {
      const { mandate, signature } = await createValidMandate(31n);
      const mandateHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      // Attacker tries to revoke
      await expect(
        dropMandate.write.revokeMandate([mandateHash], { account: attackerWallet.account })
      ).to.be.rejectedWith("DropMandate: unauthorized revocation caller");
    });

    it("lifecycle: not-yet-active mandate returns isMandateValid == false", async function () {
      const block = await publicClient.getBlock();
      const now = block.timestamp;

      // Mandate valid only in the future (+3600s)
      const futureMandate = {
        account: realSmartAccount.address,
        authorizer: humanOwnerAccount.address,
        sessionKey: agentAccount.address,
        chainId: BigInt(chainId),
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        actionType: ACTION_TYPE_ERC20_TRANSFER,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: Number(now + 3600n), // Future start!
        validUntil: Number(now + 86400n),
        nonce: 32n,
        policyHash: POLICY_HASH,
        purposeHash: PURPOSE_HASH,
      };

      const sig = await humanOwnerAccount.signTypedData({
        domain: getEIP712Domain(dropMandate.address),
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: futureMandate,
      });

      const hash = await dropMandate.read.getDigest([futureMandate]);
      await dropMandate.write.registerMandate([futureMandate, sig]);

      // Active? No, not yet started!
      const isValid = await dropMandate.read.isMandateValid([hash]);
      expect(isValid).to.be.false;
    });

    it("lifecycle: rejects registration of already-expired mandate", async function () {
      const block = await publicClient.getBlock();
      const now = block.timestamp;

      const expiredMandate = {
        account: realSmartAccount.address,
        authorizer: humanOwnerAccount.address,
        sessionKey: agentAccount.address,
        chainId: BigInt(chainId),
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        actionType: ACTION_TYPE_ERC20_TRANSFER,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: Number(now - 7200n),
        validUntil: Number(now - 3600n), // Expired 1 hour ago!
        nonce: 33n,
        policyHash: POLICY_HASH,
        purposeHash: PURPOSE_HASH,
      };

      const sig = await humanOwnerAccount.signTypedData({
        domain: getEIP712Domain(dropMandate.address),
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: expiredMandate,
      });

      await expect(
        dropMandate.write.registerMandate([expiredMandate, sig])
      ).to.be.rejectedWith("DropMandate: mandate already expired");
    });

    it("lifecycle: independent mandates for different accounts do not collide", async function () {
      const owner2Account = privateKeyToAccount(generatePrivateKey());
      // Deploy Account 2 owned by owner2Account
      const account2 = await hre.viem.deployContract("ModularSmartAccount", [
        mockEntryPoint.address,
        owner2Account.address,
      ]);

      const { mandate: mandate1, signature: sig1 } = await createValidMandate(34n);
      const hash1 = await dropMandate.read.getDigest([mandate1]);
      await dropMandate.write.registerMandate([mandate1, sig1]);

      const block = await publicClient.getBlock();
      const now = block.timestamp;

      // Mandate for Account 2
      const mandate2 = {
        account: account2.address,
        authorizer: owner2Account.address,
        sessionKey: agentAccount.address,
        chainId: BigInt(chainId),
        token: mockUSDC.address,
        recipient: supplierBWallet.account.address,
        actionType: ACTION_TYPE_ERC20_TRANSFER,
        maxAmount: parseUnits("100", 6),
        dailyBudget: parseUnits("500", 6),
        validAfter: Number(now - 60n),
        validUntil: Number(now + 86400n),
        nonce: 1n, // owner2's nonce 1
        policyHash: POLICY_HASH,
        purposeHash: PURPOSE_HASH,
      };

      const sig2 = await owner2Account.signTypedData({
        domain: getEIP712Domain(dropMandate.address),
        types: mandateEIP712Types,
        primaryType: "Mandate",
        message: mandate2,
      });

      const hash2 = await dropMandate.read.getDigest([mandate2]);
      await dropMandate.write.registerMandate([mandate2, sig2]);

      expect(hash1).to.not.equal(hash2);
      expect(await dropMandate.read.isMandateValid([hash1])).to.be.true;
      expect(await dropMandate.read.isMandateValid([hash2])).to.be.true;
    });
  });

  describe("PART 3: Onchain Enforcement via DropValidator", function () {
    let activeMandateHash: `0x${string}`;

    before(async function () {
      // Register canonical mandate for 400 USDC to Supplier A
      const { mandate, signature } = await createValidMandate(50n);
      activeMandateHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      // Install session policy bound to activeMandateHash
      const block = await publicClient.getBlock();
      const now = block.timestamp;

      const policy = {
        sessionKey: agentAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: mandate.validAfter,
        validUntil: mandate.validUntil,
        enabled: true,
        mandateHash: activeMandateHash,
      };

      const setPolicyPayload = encodeFunctionData({
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [policy],
      });

      // Execute from account owner to install policy in DropValidator
      await realSmartAccount.write.execute(
        [
          pad("0x00", { size: 32 }),
          concat([dropValidator.address, pad("0x00", { size: 32 }), setPolicyPayload]),
        ],
        { account: humanOwnerAccount }
      );
    });

    async function buildUserOp(target: `0x${string}`, innerCalldata: `0x${string}`) {
      const executionCalldata = concat([target, pad("0x00", { size: 32 }), innerCalldata]);
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
        args: [pad("0x00", { size: 32 }), executionCalldata],
      });

      const userOp = {
        sender: realSmartAccount.address,
        nonce: 0n,
        initCode: "0x" as `0x${string}`,
        callData,
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      const sig = await agentAccount.sign({ hash: opHash });
      userOp.signature = sig;
      return { userOp, opHash };
    }

    it("✓ ALLOW: agent submits 400 USDC transfer matching valid onchain mandate -> EXECUTION SUCCEEDS", async function () {
      const transferCalldata = encodeFunctionData({
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

      const { userOp } = await buildUserOp(mockUSDC.address, transferCalldata);

      const initialBalance = await mockUSDC.read.balanceOf([supplierAWallet.account.address]);
      await mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address]);
      const finalBalance = await mockUSDC.read.balanceOf([supplierAWallet.account.address]);

      expect(finalBalance - initialBalance).to.equal(MAX_TX_AMOUNT);
    });

    it("✗ BLOCK: policy broader than mandate is rejected during policy configuration", async function () {
      const block = await publicClient.getBlock();
      const now = block.timestamp;

      // Attempt to configure policy with maxAmount 500 USDC > Mandate 400 USDC
      const excessivePolicy = {
        sessionKey: agentAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        maxAmount: parseUnits("500", 6), // Violates mandate max (400)!
        dailyBudget: DAILY_BUDGET,
        validAfter: Number(now - 30n),
        validUntil: Number(now + 86400n),
        enabled: true,
        mandateHash: activeMandateHash,
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [excessivePolicy],
      });

      await expect(
        realSmartAccount.write.execute(
          [
            pad("0x00", { size: 32 }),
            concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
          ],
          { account: humanOwnerAccount }
        )
      ).to.be.rejected;
    });

    it("✗ BLOCK: mandate revocation immediately disables validation onchain", async function () {
      // 1. Human revokes the mandate on DropMandate
      await dropMandate.write.revokeMandate([activeMandateHash], { account: humanOwnerAccount });
      expect(await dropMandate.read.isRevoked([activeMandateHash])).to.be.true;

      // 2. Agent attempts transfer under the now-revoked mandate
      const transferCalldata = encodeFunctionData({
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

      const { userOp } = await buildUserOp(mockUSDC.address, transferCalldata);

      // Must fail validation at EntryPoint!
      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("✗ BLOCK: policy referencing unregistered mandateHash is rejected", async function () {
      const fakeMandateHash = pad("0xee", { size: 32 });
      const policy = {
        sessionKey: agentAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: 0,
        validUntil: 2000000000,
        enabled: true,
        mandateHash: fakeMandateHash,
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [policy],
      });

      await expect(
        realSmartAccount.write.execute(
          [
            pad("0x00", { size: 32 }),
            concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
          ],
          { account: humanOwnerAccount }
        )
      ).to.be.rejected;
    });

    it("✗ BLOCK: policy with agent sessionKey mismatch against mandate is rejected", async function () {
      const { mandate, signature } = await createValidMandate(60n);
      const mHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      // Session key is rogueAgentAccount instead of agentAccount
      const mismatchedPolicy = {
        sessionKey: rogueAgentAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: mandate.validAfter,
        validUntil: mandate.validUntil,
        enabled: true,
        mandateHash: mHash,
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [mismatchedPolicy],
      });

      await expect(
        realSmartAccount.write.execute(
          [
            pad("0x00", { size: 32 }),
            concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
          ],
          { account: humanOwnerAccount }
        )
      ).to.be.rejected;
    });

    it("✗ BLOCK: policy with token mismatch against mandate is rejected", async function () {
      const { mandate, signature } = await createValidMandate(61n);
      const mHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      // Token is supplierBWallet.account.address instead of mockUSDC
      const mismatchedPolicy = {
        sessionKey: agentAccount.address,
        token: supplierBWallet.account.address,
        recipient: supplierAWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: mandate.validAfter,
        validUntil: mandate.validUntil,
        enabled: true,
        mandateHash: mHash,
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [mismatchedPolicy],
      });

      await expect(
        realSmartAccount.write.execute(
          [
            pad("0x00", { size: 32 }),
            concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
          ],
          { account: humanOwnerAccount }
        )
      ).to.be.rejected;
    });

    it("✗ BLOCK: policy with recipient mismatch against mandate is rejected", async function () {
      const { mandate, signature } = await createValidMandate(62n);
      const mHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      // Recipient is supplierB instead of supplierA
      const mismatchedPolicy = {
        sessionKey: agentAccount.address,
        token: mockUSDC.address,
        recipient: supplierBWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: mandate.validAfter,
        validUntil: mandate.validUntil,
        enabled: true,
        mandateHash: mHash,
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [mismatchedPolicy],
      });

      await expect(
        realSmartAccount.write.execute(
          [
            pad("0x00", { size: 32 }),
            concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
          ],
          { account: humanOwnerAccount }
        )
      ).to.be.rejected;
    });
  });

  describe("PART 4: End-to-End Pipeline (Human Mandate -> Intent -> Simulation -> Onchain)", function () {
    let freshMandateHash: `0x${string}`;

    before(async function () {
      // 1. Human owner signs fresh mandate for Supplier A (400 USDC)
      const { mandate, signature } = await createValidMandate(70n);
      freshMandateHash = await dropMandate.read.getDigest([mandate]);
      await dropMandate.write.registerMandate([mandate, signature]);

      // 2. Smart account configures session policy referencing freshMandateHash
      const block = await publicClient.getBlock();
      const now = block.timestamp;

      const policy = {
        sessionKey: agentAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        maxAmount: MAX_TX_AMOUNT,
        dailyBudget: DAILY_BUDGET,
        validAfter: mandate.validAfter,
        validUntil: mandate.validUntil,
        enabled: true,
        mandateHash: freshMandateHash,
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
                  { name: "mandateHash", type: "bytes32" },
                ],
              },
            ],
            outputs: [],
          },
        ],
        functionName: "setSessionPolicy",
        args: [policy],
      });

      await realSmartAccount.write.execute(
        [
          pad("0x00", { size: 32 }),
          concat([dropValidator.address, pad("0x00", { size: 32 }), payload]),
        ],
        { account: humanOwnerAccount }
      );
    });

    it("E2E SUCCESS: Valid mandate -> Intent referencing mandate -> Simulation match -> DropValidator allows", async function () {
      // AI Proposes Intent referencing freshMandateHash
      const intent = {
        version: "1" as const,
        kind: "ERC20_TRANSFER" as const,
        chainId,
        account: realSmartAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        amount: "400000000",
        purpose: "Q4 Invoice",
        mandateId: freshMandateHash,
      };

      // Canonical Builder compiles
      const compiled = buildCanonicalTransaction(intent);

      // Simulation Dry-run (invoked by account owner context)
      const txHash = await deployerWallet.sendTransaction({
        to: realSmartAccount.address,
        data: compiled.executionData.accountCalldata,
        account: humanOwnerAccount,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Effect Decoder
      const actualManifest = decodeSimulationOutput({
        success: receipt.status === "success",
        logs: receipt.logs,
        gasUsed: receipt.gasUsed,
        isComplete: true,
      });

      // Comparator
      const diff = compareEffectManifests(compiled.expectedManifest, actualManifest);
      expect(diff.matches).to.be.true;

      // Firewall Decision
      const decision = evaluateFirewallDecision(diff);
      expect(decision.verdict).to.equal("ALLOW");

      // Sign and Submit UserOp
      const userOp = {
        sender: realSmartAccount.address,
        nonce: 1n,
        initCode: "0x" as `0x${string}`,
        callData: compiled.executionData.accountCalldata,
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      userOp.signature = await agentAccount.sign({ hash: opHash });

      // Execute onchain
      await mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address]);
    });

    it("E2E UNAUTHORIZED: altering recipient to Supplier B is rejected onchain by DropValidator", async function () {
      const intent = {
        version: "1" as const,
        kind: "ERC20_TRANSFER" as const,
        chainId,
        account: realSmartAccount.address,
        token: mockUSDC.address,
        recipient: supplierBWallet.account.address, // Altered!
        amount: "400000000",
        purpose: "Q4 Invoice",
        mandateId: freshMandateHash,
      };

      const compiled = buildCanonicalTransaction(intent);

      const userOp = {
        sender: realSmartAccount.address,
        nonce: 2n,
        initCode: "0x" as `0x${string}`,
        callData: compiled.executionData.accountCalldata,
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      userOp.signature = await agentAccount.sign({ hash: opHash });

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("E2E UNAUTHORIZED: altering amount to 500 USDC exceeds mandate and is rejected onchain by DropValidator", async function () {
      const intent = {
        version: "1" as const,
        kind: "ERC20_TRANSFER" as const,
        chainId,
        account: realSmartAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        amount: "500000000", // 500 USDC > 400 USDC!
        purpose: "Q4 Invoice",
        mandateId: freshMandateHash,
      };

      const compiled = buildCanonicalTransaction(intent);

      const userOp = {
        sender: realSmartAccount.address,
        nonce: 3n,
        initCode: "0x" as `0x${string}`,
        callData: compiled.executionData.accountCalldata,
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      userOp.signature = await agentAccount.sign({ hash: opHash });

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("E2E UNAUTHORIZED: rogue agent signature is rejected onchain", async function () {
      const intent = {
        version: "1" as const,
        kind: "ERC20_TRANSFER" as const,
        chainId,
        account: realSmartAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        amount: "400000000",
        purpose: "Q4 Invoice",
        mandateId: freshMandateHash,
      };

      const compiled = buildCanonicalTransaction(intent);

      const userOp = {
        sender: realSmartAccount.address,
        nonce: 4n,
        initCode: "0x" as `0x${string}`,
        callData: compiled.executionData.accountCalldata,
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      // Rogue agent signs
      userOp.signature = await rogueAgentAccount.sign({ hash: opHash });

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });

    it("E2E UNAUTHORIZED: intent referencing revoked mandate is blocked onchain", async function () {
      // Revoke the mandate
      await dropMandate.write.revokeMandate([freshMandateHash], { account: humanOwnerAccount });
      expect(await dropMandate.read.isRevoked([freshMandateHash])).to.be.true;

      const intent = {
        version: "1" as const,
        kind: "ERC20_TRANSFER" as const,
        chainId,
        account: realSmartAccount.address,
        token: mockUSDC.address,
        recipient: supplierAWallet.account.address,
        amount: "400000000",
        purpose: "Q4 Invoice",
        mandateId: freshMandateHash,
      };

      const compiled = buildCanonicalTransaction(intent);

      const userOp = {
        sender: realSmartAccount.address,
        nonce: 5n,
        initCode: "0x" as `0x${string}`,
        callData: compiled.executionData.accountCalldata,
        accountGasLimits: pad("0x01", { size: 32 }),
        preVerificationGas: 100000n,
        gasFees: pad("0x01", { size: 32 }),
        paymasterAndData: "0x" as `0x${string}`,
        signature: "0x" as `0x${string}`,
      };

      const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
      userOp.signature = await agentAccount.sign({ hash: opHash });

      await expect(
        mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
      ).to.be.rejectedWith("EntryPoint: validation failed");
    });
  });
});
