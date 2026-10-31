import hre from "hardhat";
import fs from "fs";
import path from "path";
import { parseUnits, parseEther } from "viem";

const CANONICAL_ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();

  const networkName = hre.network.name;
  const chainId = await publicClient.getChainId();

  console.log(`=======================================================`);
  console.log(`Deploying DROP Protocol Core on ${networkName} (Chain ID: ${chainId})`);
  console.log(`Deployer address: ${deployer.account.address}`);
  console.log(`=======================================================`);

  // 1. EntryPoint Resolution
  let entryPointAddress = CANONICAL_ENTRYPOINT_V07;
  if (networkName === "hardhat" || networkName === "localhost") {
    console.log(`Deploying MockEntryPoint for local development...`);
    const mockEP = await hre.viem.deployContract("MockEntryPoint");
    entryPointAddress = mockEP.address;
    console.log(`MockEntryPoint deployed at: ${entryPointAddress}`);
  } else {
    console.log(`Using canonical ERC-4337 v0.7 EntryPoint: ${entryPointAddress}`);
  }

  // 2. Deploy DropMandate (EIP-712 Registry)
  console.log(`Deploying DropMandate...`);
  const dropMandate = await hre.viem.deployContract("DropMandate");
  console.log(`✓ DropMandate deployed at: ${dropMandate.address}`);

  // 3. Deploy DropValidator (ERC-7579 Validator Module)
  console.log(`Deploying DropValidator...`);
  const dropValidator = await hre.viem.deployContract("DropValidator");
  console.log(`✓ DropValidator deployed at: ${dropValidator.address}`);

  // 4. Link DropValidator -> DropMandate
  console.log(`Linking DropValidator to DropMandate...`);
  const linkTx = await dropValidator.write.setDropMandate([dropMandate.address]);
  await publicClient.waitForTransactionReceipt({ hash: linkTx });
  console.log(`✓ DropValidator linked to DropMandate`);

  // 5. Deploy DropEffectGuard (ERC-7579 Hook Module)
  console.log(`Deploying DropEffectGuard...`);
  const dropEffectGuard = await hre.viem.deployContract("DropEffectGuard");
  console.log(`✓ DropEffectGuard deployed at: ${dropEffectGuard.address}`);

  // 6. Deploy DropAuditRegistry
  console.log(`Deploying DropAuditRegistry...`);
  const dropAuditRegistry = await hre.viem.deployContract("DropAuditRegistry");
  console.log(`✓ DropAuditRegistry deployed at: ${dropAuditRegistry.address}`);

  // 7. Deploy MockUSDC
  console.log(`Deploying MockUSDC...`);
  const mockUSDC = await hre.viem.deployContract("MockUSDC");
  console.log(`✓ MockUSDC deployed at: ${mockUSDC.address}`);

  // 8. Deploy Demo ModularSmartAccount
  console.log(`Deploying Demo ModularSmartAccount...`);
  const smartAccount = await hre.viem.deployContract("ModularSmartAccount", [
    entryPointAddress,
    deployer.account.address,
  ]);
  console.log(`✓ ModularSmartAccount deployed at: ${smartAccount.address}`);

  // Install DropValidator (moduleTypeId = 1)
  console.log(`Installing DropValidator on ModularSmartAccount...`);
  const installValTx = await smartAccount.write.installModule([
    1n, // MODULE_TYPE_VALIDATOR
    dropValidator.address,
    "0x",
  ]);
  await publicClient.waitForTransactionReceipt({ hash: installValTx });
  console.log(`✓ DropValidator installed`);

  // Install DropEffectGuard (moduleTypeId = 4)
  console.log(`Installing DropEffectGuard on ModularSmartAccount...`);
  const installHookTx = await smartAccount.write.installModule([
    4n, // MODULE_TYPE_HOOK
    dropEffectGuard.address,
    "0x",
  ]);
  await publicClient.waitForTransactionReceipt({ hash: installHookTx });
  console.log(`✓ DropEffectGuard installed`);

  // Fund smart account with test USDC
  console.log(`Minting 10,000 MockUSDC to Smart Account...`);
  const mintTx = await mockUSDC.write.mint([smartAccount.address, parseUnits("10000", 6)]);
  await publicClient.waitForTransactionReceipt({ hash: mintTx });
  console.log(`✓ 10,000 MockUSDC minted to Smart Account`);

  // Save deployment artifact
  const deploymentData = {
    network: networkName,
    chainId,
    timestamp: new Date().toISOString(),
    contracts: {
      entryPoint: entryPointAddress,
      dropMandate: dropMandate.address,
      dropValidator: dropValidator.address,
      dropEffectGuard: dropEffectGuard.address,
      dropAuditRegistry: dropAuditRegistry.address,
      mockUSDC: mockUSDC.address,
      demoSmartAccount: smartAccount.address,
    },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const outFilePath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outFilePath, JSON.stringify(deploymentData, null, 2));
  console.log(`=======================================================`);
  console.log(`Deployment manifest written to: ${outFilePath}`);
  console.log(`=======================================================`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
