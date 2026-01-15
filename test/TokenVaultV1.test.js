const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TokenVaultV1", function () {
  let tokenVault;
  let mockToken;
  let owner, admin, user1, user2;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const DEPOSIT_FEE = 500; // 5%

  beforeEach(async function () {
    [owner, admin, user1, user2] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy(INITIAL_SUPPLY);

    // Deploy TokenVaultV1 as proxy
    const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
    tokenVault = await upgrades.deployProxy(
      TokenVaultV1,
      [mockToken.target, admin.address, DEPOSIT_FEE],
      { kind: "uups", initializer: "initialize" }
    );

    // Distribute tokens to users
    await mockToken.transfer(user1.address, ethers.parseEther("10000"));
    await mockToken.transfer(user2.address, ethers.parseEther("10000"));

    // Approve vault to spend tokens
    await mockToken
      .connect(user1)
      .approve(tokenVault.target, ethers.MaxUint256);
    await mockToken
      .connect(user2)
      .approve(tokenVault.target, ethers.MaxUint256);
  });

  describe("Initialization", function () {
    it("should initialize with correct parameters", async function () {
      expect(await tokenVault.admin()).to.equal(admin.address);
      const fee = await tokenVault.getDepositFee();
      expect(fee).to.equal(BigInt(DEPOSIT_FEE));
      expect(await tokenVault.totalDeposits()).to.equal(0n);
    });

    it("should prevent reinitialization", async function () {
      let reverted = false;
      try {
        await tokenVault.initialize(mockToken.target, admin.address, 100);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("Deposits", function () {
    it("should allow deposits and update balances", async function () {
      const depositAmount = ethers.parseEther("1000");
      await tokenVault.connect(user1).deposit(depositAmount);

      const fee = (depositAmount * BigInt(DEPOSIT_FEE)) / BigInt(10000);
      const expectedBalance = depositAmount - fee;

      expect(await tokenVault.balanceOf(user1.address)).to.equal(
        expectedBalance
      );
    });

    it("should deduct deposit fee correctly", async function () {
      const depositAmount = ethers.parseEther("1000");
      await tokenVault.connect(user1).deposit(depositAmount);

      const fee = (depositAmount * BigInt(DEPOSIT_FEE)) / BigInt(10000);
      const expectedBalance = depositAmount - fee;

      expect(await tokenVault.balanceOf(user1.address)).to.equal(
        expectedBalance
      );
      expect(await tokenVault.totalDeposits()).to.equal(expectedBalance);
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("1000");
      await tokenVault.connect(user1).deposit(depositAmount);
    });

    it("should allow withdrawals and update balances", async function () {
      const balance = await tokenVault.balanceOf(user1.address);
      const withdrawAmount = balance / BigInt(2);

      await tokenVault.connect(user1).withdraw(withdrawAmount);

      expect(await tokenVault.balanceOf(user1.address)).to.equal(
        balance - withdrawAmount
      );
    });

    it("should prevent withdrawal of more than balance", async function () {
      const balance = await tokenVault.balanceOf(user1.address);
      const excessiveAmount = balance + ethers.parseEther("1");

      let reverted = false;
      try {
        await tokenVault.connect(user1).withdraw(excessiveAmount);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("Version", function () {
    it("should return correct version", async function () {
      expect(await tokenVault.getImplementationVersion()).to.equal("V1");
    });
  });
});
