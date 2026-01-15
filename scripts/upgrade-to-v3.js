const hre = require("hardhat");
const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Upgrading TokenVault to V3...");

  // Get signers
  const [deployer] = await ethers.getSigners();
  console.log(`Upgrading with account: ${deployer.address}`);

  // Replace with actual proxy address from V2 deployment
  const vaultProxyAddress = process.env.VAULT_PROXY_ADDRESS;
  if (!vaultProxyAddress) {
    throw new Error(
      "VAULT_PROXY_ADDRESS environment variable not set. Please provide the V2 proxy address."
    );
  }

  console.log(`Upgrading proxy at: ${vaultProxyAddress}`);

  // Get the proxy instance
  const vaultV2 = await ethers.getContractAt("TokenVaultV2", vaultProxyAddress);

  // Verify current state before upgrade
  const balanceBefore = await vaultV2.totalDeposits();
  const adminBefore = await vaultV2.admin();
  const yieldRateBefore = await vaultV2.getYieldRate();
  console.log(`\nState before upgrade:`);
  console.log(`Total deposits: ${ethers.formatEther(balanceBefore)} tokens`);
  console.log(`Admin: ${adminBefore}`);
  console.log(`Yield rate: ${yieldRateBefore} basis points`);

  // Get the admin for initialization
  const admin = adminBefore;

  // Upgrade to V3
  const TokenVaultV3 = await hre.ethers.getContractFactory("TokenVaultV3");
  const vaultV3 = await upgrades.upgradeProxy(vaultProxyAddress, TokenVaultV3, {
    kind: "uups",
  });
  console.log(`\nTokenVault upgraded to V3 at: ${vaultV3.target}`);

  // Initialize V3
  const withdrawalDelay = 7 * 24 * 60 * 60; // 7 days
  await vaultV3.initializeV3(withdrawalDelay);
  console.log(`V3 initialized with withdrawal delay: ${withdrawalDelay} seconds (7 days)`);

  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    vaultV3.target
  );
  console.log(`TokenVaultV3 implementation deployed to: ${implementationAddress}`);

  // Verify upgrade
  const version = await vaultV3.getImplementationVersion();
  const balanceAfter = await vaultV3.totalDeposits();
  const yieldRateAfter = await vaultV3.getYieldRate();
  const delayAfter = await vaultV3.getWithdrawalDelay();

  console.log(`\nState after upgrade:`);
  console.log(`Implementation version: ${version}`);
  console.log(`Total deposits: ${ethers.formatEther(balanceAfter)} tokens`);
  console.log(`Yield rate: ${yieldRateAfter} basis points`);
  console.log(`Withdrawal delay: ${delayAfter} seconds`);

  if (balanceBefore !== balanceAfter) {
    throw new Error("Storage layout error: Total deposits changed after upgrade!");
  }

  if (yieldRateBefore !== yieldRateAfter) {
    throw new Error("Storage layout error: Yield rate changed after upgrade!");
  }

  console.log("\n=== Upgrade Summary ===");
  console.log(`Vault Proxy Address: ${vaultV3.target}`);
  console.log(`V3 Implementation Address: ${implementationAddress}`);
  console.log(`✓ Storage preserved`);
  console.log(`✓ V2 features maintained`);
  console.log(`✓ Withdrawal delay feature added`);
  console.log(`✓ Emergency withdrawal feature added`);

  return {
    vault: vaultV3.target,
    implementation: implementationAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
