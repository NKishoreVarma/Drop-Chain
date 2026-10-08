import { expect } from "chai";
import hre from "hardhat";
import { parseUnits, pad, encodeFunctionData, concat } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

describe("Phase 2 Integration — Intent -> Canonical Builder -> DropValidator", function () {
  let publicClient: any;
  let deployerWallet: any;
  let supplierAWallet: any;
  let supplierBWallet: any;
  let buildCanonicalTransaction: any;

  // Agent Session Key
  const agentPrivateKey = generatePrivateKey();
  const agentAccount = privateKeyToAccount(agentPrivateKey);

  // Contracts
  let mockUSDC: any;
  let dropValidator: any;
  let mockEntryPoint: any;
  let realSmartAccount: any;

  const MAX_TX_AMOUNT = parseUnits("400", 6); // 400 USDC
  const DAILY_BUDGET = parseUnits("2000", 6); // 2000 USDC
  const INITIAL_BALANCE = parseUnits("10000", 6); // 10,000 USDC
  const MANDATE_ID = ("0x" + "c".repeat(64)) as `0x${string}`;

  before(async function () {
    // True native dynamic import of ESM workspace package (avoids ts-node CJS transpile)
    const loadEsm = new Function('return import("@drop/canonical-builder")');
    const canonicalBuilderModule = await loadEsm();
    buildCanonicalTransaction = canonicalBuilderModule.buildCanonicalTransaction;

    const wallets = await hre.viem.getWalletClients();
    deployerWallet = wallets[0];
    supplierAWallet = wallets[1];
    supplierBWallet = wallets[2];
    publicClient = await hre.viem.getPublicClient();

    // 1. Deploy MockUSDC
    mockUSDC = await hre.viem.deployContract("MockUSDC");

    // 2. Deploy DropValidator
    dropValidator = await hre.viem.deployContract("DropValidator");

    // 3. Deploy MockEntryPoint
    mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");

    // 4. Deploy REAL ModularSmartAccount
    realSmartAccount = await hre.viem.deployContract("ModularSmartAccount", [
      mockEntryPoint.address,
      deployerWallet.account.address,
    ]);

    // Fund smart account with 10,000 USDC
    await mockUSDC.write.mint([realSmartAccount.address, INITIAL_BALANCE]);

    // Install DropValidator on ModularSmartAccount (Module Type 1 = Validator)
    await realSmartAccount.write.installModule([
      1n,
      dropValidator.address,
      "0x",
    ]);

    // Configure Agent Session Policy: Token = USDC, Recipient = SupplierA, MaxAmount = 400 USDC
    const block = await publicClient.getBlock();
    const now = block.timestamp;

    const policy = {
      sessionKey: agentAccount.address,
      token: mockUSDC.address,
      recipient: supplierAWallet.account.address,
      maxAmount: MAX_TX_AMOUNT,
      dailyBudget: DAILY_BUDGET,
      validAfter: Number(now - 60n),
      validUntil: Number(now + 86400n),
      enabled: true,
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
      concat([dropValidator.address, pad("0x00", { size: 32 }), setPolicyPayload]),
    ]);
  });

  async function packageUserOp(executionData: any) {
    const userOp = {
      sender: realSmartAccount.address,
      nonce: 0n,
      initCode: "0x" as `0x${string}`,
      callData: executionData.accountCalldata,
      accountGasLimits: pad("0x01", { size: 32 }),
      preVerificationGas: 100000n,
      gasFees: pad("0x01", { size: 32 }),
      paymasterAndData: "0x" as `0x${string}`,
      signature: "0x" as `0x${string}`,
    };

    const opHash = await mockEntryPoint.read.getUserOpHash([userOp]);
    const sig = await agentAccount.sign({ hash: opHash });
    userOp.signature = sig;
    return userOp;
  }

  it("1. ALLOW: Valid 400 USDC intent -> Canonical Builder -> DropValidator -> EXECUTION SUCCEEDS", async function () {
    const intent = {
      version: "1" as const,
      kind: "ERC20_TRANSFER" as const,
      chainId: 31337,
      account: realSmartAccount.address,
      token: mockUSDC.address,
      recipient: supplierAWallet.account.address,
      amount: "400000000", // 400 USDC
      purpose: "supplier_payment_invoice_400",
      mandateId: MANDATE_ID,
    };

    // 1. Compile intent deterministically
    const compiled = buildCanonicalTransaction(intent);

    // Verify expected effect matches intent
    expect(compiled.expectedEffect.amount).to.equal("400000000");
    expect(compiled.expectedEffect.to.toLowerCase()).to.equal(
      supplierAWallet.account.address.toLowerCase()
    );
    expect(compiled.expectedEffect.token.toLowerCase()).to.equal(
      mockUSDC.address.toLowerCase()
    );

    // 2. Package into ERC-4337 UserOperation
    const userOp = await packageUserOp(compiled.executionData);

    const initialBalance = await mockUSDC.read.balanceOf([
      supplierAWallet.account.address,
    ]);

    // 3. Execute via EntryPoint
    await mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address]);

    const finalBalance = await mockUSDC.read.balanceOf([
      supplierAWallet.account.address,
    ]);

    // Invariant: Supplier received exactly 400 USDC
    expect(finalBalance - initialBalance).to.equal(MAX_TX_AMOUNT);
  });

  it("2. BLOCK: Excessive 600 USDC intent -> Canonical Builder -> DropValidator -> REJECTED ONCHAIN", async function () {
    const excessiveIntent = {
      version: "1" as const,
      kind: "ERC20_TRANSFER" as const,
      chainId: 31337,
      account: realSmartAccount.address,
      token: mockUSDC.address,
      recipient: supplierAWallet.account.address,
      amount: "600000000", // 600 USDC (exceeds 400 limit)
      purpose: "excessive_supplier_payment",
      mandateId: MANDATE_ID,
    };

    const compiled = buildCanonicalTransaction(excessiveIntent);
    const userOp = await packageUserOp(compiled.executionData);

    // Invariant: Smart account validator must reject excessive amount
    await expect(
      mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
    ).to.be.rejectedWith("EntryPoint: validation failed");
  });

  it("3. BLOCK: Unauthorized Supplier B intent -> Canonical Builder -> DropValidator -> REJECTED ONCHAIN", async function () {
    const rogueRecipientIntent = {
      version: "1" as const,
      kind: "ERC20_TRANSFER" as const,
      chainId: 31337,
      account: realSmartAccount.address,
      token: mockUSDC.address,
      recipient: supplierBWallet.account.address, // Unauthorized Supplier B
      amount: "400000000",
      purpose: "payment_to_unauthorized_party",
      mandateId: MANDATE_ID,
    };

    const compiled = buildCanonicalTransaction(rogueRecipientIntent);
    const userOp = await packageUserOp(compiled.executionData);

    // Invariant: Smart account validator must reject unauthorized recipient
    await expect(
      mockEntryPoint.write.handleOps([[userOp], deployerWallet.account.address])
    ).to.be.rejectedWith("EntryPoint: validation failed");
  });
});
