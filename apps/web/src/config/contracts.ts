export const DROP_CONFIG = {
  chainId: 84532,
  chainName: "Base Sepolia",
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  contracts: {
    dropMandate: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    dropValidator: "0x9fE46736679d2D9a65F0992F2272dE9f3c7Fa6e0",
    dropEffectGuard: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    dropAuditRegistry: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    dropEscrow: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    mockUSDC: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    smartAccount: "0x2279B7A0a67E34828784ac56143777a93c4eC24a",
  },
  demoSuppliers: [
    { name: "Supplier A (Approved)", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
    { name: "Supplier B (Unapproved)", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  ],
  attackerAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
};
