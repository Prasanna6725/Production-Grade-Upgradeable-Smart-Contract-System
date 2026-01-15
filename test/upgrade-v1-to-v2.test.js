const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgrade V1 to V2", function () {
  let tokenVaultV1;
  let tokenVaultV2;
  let mockToken;
  let owner, admin, user1, user2;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const DEPOSIT_FEE = 500; // 5%
  const YIELD_RATE = 500; // 5% annual

  beforeEach(async function () {
    [owner, admin, user1, user2] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy(INITIAL_SUPPLY);

    // Deploy TokenVaultV1
    const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
    tokenVaultV1 = await upgrades.deployProxy(
      TokenVaultV1,
      [mockToken.target, admin.address, DEPOSIT_FEE],
      { kind: "uups", initializer: "initialize" }
    );

    // Distribute tokens to users
    await mockToken.transfer(user1.address, ethers.parseEther("10000"));
    await mockToken.transfer(user2.address, ethers.parseEther("10000"));

    // Approve vault
    await mockToken
      .connect(user1)
      .approve(tokenVaultV1.target, ethers.MaxUint256);
    await mockToken
      .connect(user2)
      .approve(tokenVaultV1.target, ethers.MaxUint256);

    // Perform some operations
    await tokenVaultV1.connect(user1).deposit(ethers.parseEther("1000"));
    await tokenVaultV1.connect(user2).deposit(ethers.parseEther("500"));
  });

  describe("Storage Preservation", function () {
    beforeEach(async function () {
      // Upgrade to V2 using admin account
      const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2", admin);
      tokenVaultV2 = await upgrades.upgradeProxy(
        tokenVaultV1.target,
        TokenVaultV2,
        { kind: "uups" }
      );

      // Initialize V2
      await tokenVaultV2.connect(admin).initializeV2(YIELD_RATE);

      // Approve for V2
      await mockToken
        .connect(user1)
        .approve(tokenVaultV2.target, ethers.MaxUint256);
      await mockToken
        .connect(user2)
        .approve(tokenVaultV2.target, ethers.MaxUint256);
    });

    it("should preserve user balances after upgrade", async function () {
      const user1Balance = await tokenVaultV2.balanceOf(user1.address);
      const user2Balance = await tokenVaultV2.balanceOf(user2.address);

      // Expected: deposit amount minus fee
      const expectedUser1 = ethers.parseEther("1000") -
        (ethers.parseEther("1000") * BigInt(DEPOSIT_FEE)) / BigInt(10000);
      const expectedUser2 = ethers.parseEther("500") -
        (ethers.parseEther("500") * BigInt(DEPOSIT_FEE)) / BigInt(10000);

      expect(user1Balance).to.equal(expectedUser1);
      expect(user2Balance).to.equal(expectedUser2);
    });

    it("should preserve total deposits after upgrade", async function () {
      const total = await tokenVaultV2.totalDeposits();

      const deposit1 = ethers.parseEther("1000") -
        (ethers.parseEther("1000") * BigInt(DEPOSIT_FEE)) / BigInt(10000);
      const deposit2 = ethers.parseEther("500") -
        (ethers.parseEther("500") * BigInt(DEPOSIT_FEE)) / BigInt(10000);

      expect(total).to.equal(deposit1 + deposit2);
    });

    it("should maintain admin access control after upgrade", async function () {
      // Only admin should be able to set yield rate
      let reverted = false;
      try {
        await tokenVaultV2.connect(user1).setYieldRate(1000);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;

      // Admin should be able to set yield rate
      await tokenVaultV2.connect(admin).setYieldRate(1000);
      expect(await tokenVaultV2.getYieldRate()).to.equal(BigInt(1000));
    });
  });

  describe("V2 Yield Functionality", function () {
    beforeEach(async function () {
      // Upgrade to V2
      const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2", admin);
      tokenVaultV2 = await upgrades.upgradeProxy(
        tokenVaultV1.target,
        TokenVaultV2,
        { kind: "uups" }
      );

      // Initialize V2
      await tokenVaultV2.connect(admin).initializeV2(YIELD_RATE);

      // Approve for V2
      await mockToken
        .connect(user1)
        .approve(tokenVaultV2.target, ethers.MaxUint256);
    });

    it("should allow setting yield rate in V2", async function () {
      const newRate = 1000;
      await tokenVaultV2.connect(admin).setYieldRate(newRate);
      expect(await tokenVaultV2.getYieldRate()).to.equal(BigInt(newRate));
    });

    it("should calculate yield correctly", async function () {
      // Advance time by multiple days
      const timeToAdvance = 30 * 86400; // 30 days
      await ethers.provider.send("evm_increaseTime", [timeToAdvance]);
      await ethers.provider.send("evm_mine");

      const yield_ = await tokenVaultV2.getUserYield(user1.address);

      // Yield should be greater than 0 after advancing time
      expect(Number(yield_) > 0).to.be.true;
    });

    it("should prevent non-admin from setting yield rate", async function () {
      let reverted = false;
      try {
        await tokenVaultV2.connect(user1).setYieldRate(1000);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("V2 Pause Functionality", function () {
    beforeEach(async function () {
      // Upgrade to V2
      const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2", admin);
      tokenVaultV2 = await upgrades.upgradeProxy(
        tokenVaultV1.target,
        TokenVaultV2,
        { kind: "uups" }
      );

      // Initialize V2
      await tokenVaultV2.connect(admin).initializeV2(YIELD_RATE);

      // Approve for V2
      await mockToken
        .connect(user1)
        .approve(tokenVaultV2.target, ethers.MaxUint256);
    });

    it("should allow pausing deposits in V2", async function () {
      expect(await tokenVaultV2.isDepositsPaused()).to.equal(false);

      await tokenVaultV2.connect(admin).pauseDeposits();
      expect(await tokenVaultV2.isDepositsPaused()).to.equal(true);

      // Should not allow deposits when paused
      let reverted = false;
      try {
        await tokenVaultV2.connect(user1).deposit(ethers.parseEther("100"));
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;

      // Unpause
      await tokenVaultV2.connect(admin).unpauseDeposits();
      expect(await tokenVaultV2.isDepositsPaused()).to.equal(false);

      // Should allow deposits when unpaused
      await tokenVaultV2.connect(user1).deposit(ethers.parseEther("100"));
    });
  });
});
