require("@nomicfoundation/hardhat-toolbox");
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...valueParts] = trimmed.split("=");
    process.env[key.trim()] = process.env[key.trim()] || valueParts.join("=").trim();
  }
}

const networks = {};
if (process.env.SEPOLIA_RPC_URL && process.env.DEPLOYER_PRIVATE_KEY) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC_URL,
    chainId: 11155111,
    accounts: [process.env.DEPLOYER_PRIVATE_KEY]
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks,
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  }
};
