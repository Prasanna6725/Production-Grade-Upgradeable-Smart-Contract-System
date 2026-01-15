const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgrade V2 to V3", function () {
  let tokenVaultV1;
  let tokenVaultV2;
  let tokenVaultV3;
  let mockToken;
  let owner, admin, user1, user2;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const DEPOSIT_FEE = 500; // 5%
  const YIELD_RATE = 500; // 5% annual
  const WITHDRAWAL_DELAY = 7 * 24 * 60 * 60; // 7 days

  beforeEach(async function () {
    [owner, admin, user1, user2] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy(INITIAL_SUPPLY);

    // Deploy V1
    const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
    tokenVaultV1 = await upgrades.deployProxy(
      TokenVaultV1,
      [mockToken.target, admin.address, DEPOSIT_FEE],
      { kind: "uups", initializer: "initialize" }
    );

    // Upgrade to V2
    const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2", admin);
    tokenVaultV2 = await upgrades.upgradeProxy(
      tokenVaultV1.target,
      TokenVaultV2,
      { kind: "uups" }
    );
    await tokenVaultV2.connect(admin).initializeV2(YIELD_RATE);

    // Distribute tokens
    await mockToken.transfer(user1.address, ethers.parseEther("10000"));
    await mockToken.transfer(user2.address, ethers.parseEther("10000"));

    // Approve V2
    await mockToken
      .connect(user1)
      .approve(tokenVaultV2.target, ethers.MaxUint256);
    await mockToken
      .connect(user2)
      .approve(tokenVaultV2.target, ethers.MaxUint256);

    // Perform V2 operations
    await tokenVaultV2.connect(user1).deposit(ethers.parseEther("1000"));
    await tokenVaultV2.connect(user2).deposit(ethers.parseEther("500"));
  });

  describe("Upgrade Process", function () {
    beforeEach(async function () {
      // Upgrade to V3
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      tokenVaultV3 = await upgrades.upgradeProxy(
        tokenVaultV2.target,
        TokenVaultV3,
        { kind: "uups" }
      );

      // Initialize V3
      await tokenVaultV3.connect(admin).initializeV3(WITHDRAWAL_DELAY);

      // Approve V3
      await mockToken
        .connect(user1)
        .approve(tokenVaultV3.target, ethers.MaxUint256);
      await mockToken
        .connect(user2)
        .approve(tokenVaultV3.target, ethers.MaxUint256);
    });

    it("should preserve all V2 state after upgrade", async function () {
      // Check balances preserved
      const user1Balance = await tokenVaultV3.balanceOf(user1.address);
      const user2Balance = await tokenVaultV3.balanceOf(user2.address);

      const expectedUser1 = ethers.parseEther("1000") -
        (ethers.parseEther("1000") * BigInt(DEPOSIT_FEE)) / BigInt(10000);
      const expectedUser2 = ethers.parseEther("500") -
        (ethers.parseEther("500") * BigInt(DEPOSIT_FEE)) / BigInt(10000);

      expect(user1Balance).to.equal(expectedUser1);
      expect(user2Balance).to.equal(expectedUser2);

      // Check total deposits preserved
      const total = await tokenVaultV3.totalDeposits();
      expect(total).to.equal(expectedUser1 + expectedUser2);

      // Check yield settings preserved
      expect(await tokenVaultV3.getYieldRate()).to.equal(BigInt(YIELD_RATE));
    });
  });

  describe("V3 Withdrawal Delay Functionality", function () {
    beforeEach(async function () {
      // Upgrade to V3
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      tokenVaultV3 = await upgrades.upgradeProxy(
        tokenVaultV2.target,
        TokenVaultV3,
        { kind: "uups" }
      );

      // Initialize V3
      await tokenVaultV3.connect(admin).initializeV3(WITHDRAWAL_DELAY);

      // Approve V3
      await mockToken
        .connect(user1)
        .approve(tokenVaultV3.target, ethers.MaxUint256);
    });

    it("should allow setting withdrawal delay", async function () {
      const newDelay = 2 * 24 * 60 * 60; // 2 days
      await tokenVaultV3.connect(admin).setWithdrawalDelay(newDelay);
      expect(await tokenVaultV3.getWithdrawalDelay()).to.equal(BigInt(newDelay));
    });

    it("should handle withdrawal requests correctly", async function () {
      const user1Balance = await tokenVaultV3.balanceOf(user1.address);
      const withdrawAmount = user1Balance / BigInt(2);

      await tokenVaultV3.connect(user1).requestWithdrawal(withdrawAmount);

      const [amount, requestTime] = await tokenVaultV3.getWithdrawalRequest(
        user1.address
      );
      expect(amount).to.equal(withdrawAmount);
      expect(Number(requestTime)).to.be.greaterThan(0);
    });

    it("should enforce withdrawal delay", async function () {
      const user1Balance = await tokenVaultV3.balanceOf(user1.address);
      const withdrawAmount = user1Balance / BigInt(2);

      await tokenVaultV3.connect(user1).requestWithdrawal(withdrawAmount);

      // Try to execute before delay
      let reverted = false;
      try {
        await tokenVaultV3.connect(user1).executeWithdrawal();
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;

      // Advance time by withdrawal delay + 1 second
      await ethers.provider.send("evm_increaseTime", [WITHDRAWAL_DELAY + 1]);
      await ethers.provider.send("evm_mine");

      // Now execution should work
      const balanceBefore = await mockToken.balanceOf(user1.address);
      await tokenVaultV3.connect(user1).executeWithdrawal();
      const balanceAfter = await mockToken.balanceOf(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });

    it("should prevent premature withdrawal execution", async function () {
      const user1Balance = await tokenVaultV3.balanceOf(user1.address);
      const withdrawAmount = user1Balance / BigInt(2);

      await tokenVaultV3.connect(user1).requestWithdrawal(withdrawAmount);

      // Should fail immediately after request
      let reverted = false;
      try {
        await tokenVaultV3.connect(user1).executeWithdrawal();
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("V3 Emergency Withdrawal", function () {
    beforeEach(async function () {
      // Upgrade to V3
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      tokenVaultV3 = await upgrades.upgradeProxy(
        tokenVaultV2.target,
        TokenVaultV3,
        { kind: "uups" }
      );

      // Initialize V3
      await tokenVaultV3.connect(admin).initializeV3(WITHDRAWAL_DELAY);

      // Approve V3
      await mockToken
        .connect(user1)
        .approve(tokenVaultV3.target, ethers.MaxUint256);
    });

    it("should allow emergency withdrawals", async function () {
      const user1Balance = await tokenVaultV3.balanceOf(user1.address);

      const balanceBefore = await mockToken.balanceOf(user1.address);
      await tokenVaultV3.connect(user1).emergencyWithdraw();
      const balanceAfter = await mockToken.balanceOf(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(user1Balance);
      expect(await tokenVaultV3.balanceOf(user1.address)).to.equal(0n);
    });

    it("should clear pending withdrawal on emergency withdraw", async function () {
      const user1Balance = await tokenVaultV3.balanceOf(user1.address);
      const withdrawAmount = user1Balance / BigInt(2);

      // Create a pending request
      await tokenVaultV3.connect(user1).requestWithdrawal(withdrawAmount);

      // Emergency withdraw should clear it
      await tokenVaultV3.connect(user1).emergencyWithdraw();

      const [amount, requestTime] = await tokenVaultV3.getWithdrawalRequest(
        user1.address
      );
      expect(amount).to.equal(0n);
      expect(requestTime).to.equal(0n);
    });
  });

  describe("V3 Backward Compatibility", function () {
    beforeEach(async function () {
      // Upgrade to V3
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      tokenVaultV3 = await upgrades.upgradeProxy(
        tokenVaultV2.target,
        TokenVaultV3,
        { kind: "uups" }
      );

      // Initialize V3
      await tokenVaultV3.connect(admin).initializeV3(WITHDRAWAL_DELAY);

      // Approve V3
      await mockToken
        .connect(user1)
        .approve(tokenVaultV3.target, ethers.MaxUint256);
    });

    it("should allow immediate withdrawals using withdraw() function", async function () {
      await tokenVaultV3.connect(user1).deposit(ethers.parseEther("100"));

      const balance = await tokenVaultV3.balanceOf(user1.address);
      const withdrawAmount = balance / BigInt(2);

      const balanceBefore = await mockToken.balanceOf(user1.address);
      await tokenVaultV3.connect(user1).withdraw(withdrawAmount);
      const balanceAfter = await mockToken.balanceOf(user1.address);

      expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
    });
  });
});
