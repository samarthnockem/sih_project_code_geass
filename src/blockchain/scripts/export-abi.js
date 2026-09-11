const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const artifactPath = path.join(root, "artifacts", "contracts", "KryptoVaultAccess.sol", "KryptoVaultAccess.json");
const outputDir = path.join(root, "exports");
const outputPath = path.join(outputDir, "KryptoVaultAccess.abi.json");
const frontendOutputPath = path.resolve(root, "..", "frontend", "KryptoVaultAccess.abi.json");

if (!fs.existsSync(artifactPath)) {
  console.error("Missing contract artifact. Run npm run compile first.");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
fs.mkdirSync(outputDir, { recursive: true });
const abiJson = `${JSON.stringify(artifact.abi, null, 2)}\n`;
fs.writeFileSync(outputPath, abiJson);
fs.writeFileSync(frontendOutputPath, abiJson);

console.log(`Exported ABI to ${path.relative(root, outputPath)}`);
console.log(`Copied ABI to ${path.relative(root, frontendOutputPath)}`);
