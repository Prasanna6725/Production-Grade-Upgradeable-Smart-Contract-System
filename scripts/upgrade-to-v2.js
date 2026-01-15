const hre = require("hardhat");
const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Upgrading TokenVault to V2...");

  // Get signers
  const [deployer] = await ethers.getSigners();
  console.log(`Upgrading with account: ${deployer.address}`);

  // Replace with actual proxy address from V1 deployment
  // This should be set via environment variable or passed as argument
  const vaultProxyAddress = process.env.VAULT_PROXY_ADDRESS;
  if (!vaultProxyAddress) {
    throw new Error(
      "VAULT_PROXY_ADDRESS environment variable not set. Please provide the V1 proxy address."
    );
  }

  console.log(`Upgrading proxy at: ${vaultProxyAddress}`);

  // Get the proxy instance
  const vaultV1 = await ethers.getContractAt("TokenVaultV1", vaultProxyAddress);

  // Verify current state before upgrade
  const balanceBefore = await vaultV1.totalDeposits();
  const adminBefore = await vaultV1.admin();
  console.log(`\nState before upgrade:`);
  console.log(`Total deposits: ${ethers.formatEther(balanceBefore)} tokens`);
  console.log(`Admin: ${adminBefore}`);

  // Get the admin for initialization
  const admin = adminBefore;

  // Upgrade to V2
  const TokenVaultV2 = await hre.ethers.getContractFactory("TokenVaultV2");
  const vaultV2 = await upgrades.upgradeProxy(vaultProxyAddress, TokenVaultV2, {
    kind: "uups",
  });
  console.log(`\nTokenVault upgraded to V2 at: ${vaultV2.target}`);

  // Initialize V2
  const yieldRate = 500; // 5% annual
  await vaultV2.initializeV2(yieldRate);
  console.log(`V2 initialized with yield rate: ${yieldRate} basis points (5%)`);

  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    vaultV2.target
  );
  console.log(`TokenVaultV2 implementation deployed to: ${implementationAddress}`);

  // Verify upgrade
  const version = await vaultV2.getImplementationVersion();
  const balanceAfter = await vaultV2.totalDeposits();
  const yieldRateAfter = await vaultV2.getYieldRate();

  console.log(`\nState after upgrade:`);
  console.log(`Implementation version: ${version}`);
  console.log(`Total deposits: ${ethers.formatEther(balanceAfter)} tokens`);
  console.log(`Yield rate: ${yieldRateAfter} basis points`);

  if (balanceBefore !== balanceAfter) {
    throw new Error("Storage layout error: Total deposits changed after upgrade!");
  }

  console.log("\n=== Upgrade Summary ===");
  console.log(`Vault Proxy Address: ${vaultV2.target}`);
  console.log(`V2 Implementation Address: ${implementationAddress}`);
  console.log(`✓ Storage preserved`);
  console.log(`✓ Yield feature added`);

  return {
    vault: vaultV2.target,
    implementation: implementationAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
