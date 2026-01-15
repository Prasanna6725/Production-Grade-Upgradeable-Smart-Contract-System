const hre = require("hardhat");
const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("Deploying TokenVaultV1...");

  // Get signers
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  // Deploy mock token for testing (or use existing token)
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(ethers.parseEther("10000000"));
  await token.waitForDeployment();
  console.log(`MockERC20 deployed to: ${token.target}`);

  // Get admin address (deployer for this example)
  const admin = deployer.address;
  const depositFee = 500; // 5%

  // Deploy TokenVaultV1 as UUPS proxy
  const TokenVaultV1 = await hre.ethers.getContractFactory("TokenVaultV1");
  const vault = await upgrades.deployProxy(
    TokenVaultV1,
    [token.target, admin, depositFee],
    { kind: "uups" }
  );
  await vault.waitForDeployment();
  console.log(`TokenVaultV1 proxy deployed to: ${vault.target}`);

  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    vault.target
  );
  console.log(`TokenVaultV1 implementation deployed to: ${implementationAddress}`);

  // Verify deployment
  const version = await vault.getImplementationVersion();
  console.log(`Implementation version: ${version}`);

  console.log("\n=== Deployment Summary ===");
  console.log(`Token Address: ${token.target}`);
  console.log(`Vault Proxy Address: ${vault.target}`);
  console.log(`Vault Implementation Address: ${implementationAddress}`);
  console.log(`Admin Address: ${admin}`);
  console.log(`Deposit Fee: ${depositFee} basis points (${depositFee / 100}%)`);

  return {
    token: token.target,
    vault: vault.target,
    implementation: implementationAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
