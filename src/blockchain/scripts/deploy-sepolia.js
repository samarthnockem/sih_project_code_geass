const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const KryptoVaultAccess = await hre.ethers.getContractFactory("KryptoVaultAccess");
  const vault = await KryptoVaultAccess.connect(deployer).deploy();
  const deploymentTransaction = vault.deploymentTransaction();

  await vault.waitForDeployment();

  const contractAddress = await vault.getAddress();
  const receipt = deploymentTransaction ? await deploymentTransaction.wait() : null;
  const artifact = await hre.artifacts.readArtifact("KryptoVaultAccess");
  const root = path.resolve(__dirname, "..");
  const outputDir = path.join(root, "exports");
  const deployment = {
    contractName: "KryptoVaultAccess",
    contractAddress,
    chainId: Number(network.chainId),
    network: "sepolia",
    deploymentTransactionHash: deploymentTransaction?.hash || null,
    deploymentBlockNumber: receipt?.blockNumber || null,
    abi: artifact.abi
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "KryptoVaultAccess.sepolia.json"), `${JSON.stringify(deployment, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "KryptoVaultAccess.abi.json"), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outputDir, "sepolia.env.example"),
    [
      `ETHEREUM_RPC_URL=${process.env.SEPOLIA_RPC_URL ? "<your-sepolia-rpc-url>" : ""}`,
      `CONTRACT_ADDRESS=${contractAddress}`,
      `EXPECTED_CHAIN_ID=${Number(network.chainId)}`,
      ""
    ].join("\n")
  );

  console.log("KryptoVaultAccess deployed to Sepolia");
  console.log(`CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`DEPLOYMENT_TX=${deploymentTransaction?.hash || ""}`);
  console.log(`DEPLOYMENT_BLOCK=${receipt?.blockNumber || ""}`);
  console.log(`EXPECTED_CHAIN_ID=${Number(network.chainId)}`);
  console.log("Wrote exports/KryptoVaultAccess.sepolia.json, exports/KryptoVaultAccess.abi.json, and exports/sepolia.env.example");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
