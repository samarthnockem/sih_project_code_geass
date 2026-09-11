const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [bob, alice] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const KryptoVaultAccess = await hre.ethers.getContractFactory("KryptoVaultAccess");
  const vault = await KryptoVaultAccess.connect(bob).deploy();

  await vault.waitForDeployment();

  const contractAddress = await vault.getAddress();
  const artifact = await hre.artifacts.readArtifact("KryptoVaultAccess");
  const root = path.resolve(__dirname, "..");
  const outputDir = path.join(root, "exports");
  const deployment = {
    contractName: "KryptoVaultAccess",
    contractAddress,
    chainId: Number(network.chainId),
    network: hre.network.name,
    rpcUrl: "http://127.0.0.1:8545",
    bobOwnerAddress: bob.address,
    aliceRecipientAddress: alice.address,
    abi: artifact.abi
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "KryptoVaultAccess.local.json"), `${JSON.stringify(deployment, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "KryptoVaultAccess.abi.json"), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outputDir, "local.env"),
    [
      `CONTRACT_ADDRESS=${contractAddress}`,
      `CHAIN_ID=${Number(network.chainId)}`,
      "BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545",
      ""
    ].join("\n")
  );

  console.log("KryptoVaultAccess deployed locally");
  console.log(`CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`CHAIN_ID=${Number(network.chainId)}`);
  console.log("BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545");
  console.log(`Bob owner account: ${bob.address}`);
  console.log(`Alice recipient account: ${alice.address}`);
  console.log("Wrote exports/KryptoVaultAccess.local.json, exports/KryptoVaultAccess.abi.json, and exports/local.env");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
