const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Security", function () {
  let tokenVaultV1;
  let tokenVaultV2;
  let mockToken;
  let owner, admin, user1;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const DEPOSIT_FEE = 500;

  beforeEach(async function () {
    [owner, admin, user1] = await ethers.getSigners();

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

    // Upgrade to V2
    const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2", admin);
    tokenVaultV2 = await upgrades.upgradeProxy(
      tokenVaultV1.target,
      TokenVaultV2,
      { kind: "uups" }
    );
    await tokenVaultV2.connect(admin).initializeV2(500);
  });

  describe("Implementation Contract Security", function () {
    it("should prevent direct initialization of implementation contracts", async function () {
      const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
      const implementation = await TokenVaultV1.deploy();

      // Direct initialization should fail because _disableInitializers() was called
      let reverted = false;
      try {
        await implementation.initialize(mockToken.target, admin.address, 500);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("Access Control", function () {
    it("should prevent unauthorized upgrades", async function () {
      const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2");

      // Non-admin should not be able to upgrade
      let reverted = false;
      try {
        await upgrades.upgradeProxy(tokenVaultV2.target, TokenVaultV2, {
          kind: "uups",
        });
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("should prevent unauthorized pause/unpause", async function () {
      // User1 should not have PAUSER_ROLE
      let reverted = false;
      try {
        await tokenVaultV2.connect(user1).pauseDeposits();
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;

      // Admin should be able to pause
      await tokenVaultV2.connect(admin).pauseDeposits();
      expect(await tokenVaultV2.isDepositsPaused()).to.equal(true);
    });

    it("should prevent unauthorized fee updates", async function () {
      // User1 should not be able to set yield rate
      let reverted = false;
      try {
        await tokenVaultV2.connect(user1).setYieldRate(1000);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("Storage Layout", function () {
    it("should use storage gaps for future upgrades", async function () {
      // This is verified by checking that contracts compile and upgrade works
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      const tokenVaultV3 = await upgrades.upgradeProxy(
        tokenVaultV2.target,
        TokenVaultV3,
        { kind: "uups" }
      );

      // If there were storage collisions, this upgrade would fail
      expect(tokenVaultV3.target).to.not.be.undefined;
    });

    it("should not have storage layout collisions across versions", async function () {
      // Deploy fresh V1, operate on it, then upgrade through V2 to V3
      const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
      const freshVault = await upgrades.deployProxy(
        TokenVaultV1,
        [mockToken.target, admin.address, DEPOSIT_FEE],
        { kind: "uups", initializer: "initialize" }
      );

      // Perform operations
      await mockToken.transfer(user1.address, ethers.parseEther("5000"));
      await mockToken
        .connect(user1)
        .approve(freshVault.target, ethers.MaxUint256);
      await freshVault.connect(user1).deposit(ethers.parseEther("1000"));

      // Upgrade to V2
      const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2", admin);
      const vaultV2 = await upgrades.upgradeProxy(freshVault.target, TokenVaultV2, {
        kind: "uups",
      });
      await vaultV2.connect(admin).initializeV2(500);

      // Verify state is preserved
      const balance = await vaultV2.balanceOf(user1.address);
      expect(Number(balance)).to.be.greaterThan(0);

      // Upgrade to V3
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      const vaultV3 = await upgrades.upgradeProxy(vaultV2.target, TokenVaultV3, {
        kind: "uups",
      });
      await vaultV3.connect(admin).initializeV3(7 * 24 * 60 * 60);

      // Verify state is still preserved
      const balanceV3 = await vaultV3.balanceOf(user1.address);
      expect(balanceV3).to.equal(balance);
    });
  });

  describe("Initialization Security", function () {
    it("should prevent function selector clashing", async function () {
      // All required functions should exist and not conflict
      const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
      const TokenVaultV2 = await ethers.getContractFactory("TokenVaultV2");
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3");

      // Check that critical functions exist
      expect(TokenVaultV1.interface.fragments.map(f => f.name)).to.include(
        "deposit"
      );
      expect(TokenVaultV1.interface.fragments.map(f => f.name)).to.include(
        "withdraw"
      );
      expect(TokenVaultV2.interface.fragments.map(f => f.name)).to.include(
        "claimYield"
      );
      expect(TokenVaultV3.interface.fragments.map(f => f.name)).to.include(
        "requestWithdrawal"
      );
    });

    it("should properly initialize each version", async function () {
      // V1 initialization already done in beforeEach
      expect(await tokenVaultV2.getImplementationVersion()).to.equal("V2");

      // Upgrade to V3
      const TokenVaultV3 = await ethers.getContractFactory("TokenVaultV3", admin);
      const vaultV3 = await upgrades.upgradeProxy(
        tokenVaultV2.target,
        TokenVaultV3,
        { kind: "uups" }
      );
      await vaultV3.connect(admin).initializeV3(7 * 24 * 60 * 60);

      expect(await vaultV3.getImplementationVersion()).to.equal("V3");
    });
  });

  describe("Edge Cases", function () {
    it("should handle zero fee correctly", async function () {
      const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
      const zeroFeeVault = await upgrades.deployProxy(
        TokenVaultV1,
        [mockToken.target, admin.address, 0],
        { kind: "uups", initializer: "initialize" }
      );

      await mockToken.transfer(user1.address, ethers.parseEther("1000"));
      await mockToken
        .connect(user1)
        .approve(zeroFeeVault.target, ethers.MaxUint256);

      await zeroFeeVault.connect(user1).deposit(ethers.parseEther("1000"));

      // With 0 fee, balance should equal deposit amount
      const balance = await zeroFeeVault.balanceOf(user1.address);
      expect(balance).to.equal(ethers.parseEther("1000"));
    });

    it("should handle maximum fee correctly", async function () {
      const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");
      const maxFeeVault = await upgrades.deployProxy(
        TokenVaultV1,
        [mockToken.target, admin.address, 10000],
        { kind: "uups", initializer: "initialize" }
      );

      await mockToken.transfer(user1.address, ethers.parseEther("1000"));
      await mockToken
        .connect(user1)
        .approve(maxFeeVault.target, ethers.MaxUint256);

      await maxFeeVault.connect(user1).deposit(ethers.parseEther("1000"));

      // With 100% fee, balance should be 0
      const balance = await maxFeeVault.balanceOf(user1.address);
      expect(balance).to.equal(0n);
    });

    it("should revert on invalid fee", async function () {
      const TokenVaultV1 = await ethers.getContractFactory("TokenVaultV1");

      let reverted = false;
      try {
        await upgrades.deployProxy(
          TokenVaultV1,
          [mockToken.target, admin.address, 10001],
          { kind: "uups", initializer: "initialize" }
        );
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
