// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title TokenVaultV2
 * @dev V2 adds yield generation and pause controls while maintaining all V1 functionality
 * Storage layout preserves all V1 variables and adds new ones at the end
 */
contract TokenVaultV2 is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable
{
    // Role definitions
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // V1 Storage - MUST NOT CHANGE
    IERC20Upgradeable public token;
    address public admin;
    uint256 public depositFee;
    mapping(address => uint256) public userBalances;
    uint256 public totalDepositAmount;

    // V2 New Storage - appended after V1 storage
    uint256 public yieldRate; // in basis points (500 = 5% annual)
    mapping(address => uint256) public lastClaimTime;
    mapping(address => uint256) public accumulatedYield;
    bool public depositsPaused;

    // Storage gap for future upgrades (reduced from 45 to 41 to account for 4 new vars)
    uint256[41] private __gap;

    // Events
    event Deposit(address indexed user, uint256 amount, uint256 fee);
    event Withdrawal(address indexed user, uint256 amount);
    event FeeUpdated(uint256 newFee);
    event YieldRateUpdated(uint256 newRate);
    event YieldClaimed(address indexed user, uint256 amount);
    event DepositsToggled(bool paused);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize V2 - called once during V1->V2 upgrade via reinitializer
     */
    function initializeV2(uint256 _yieldRate)
        external
        reinitializer(2)
    {
        require(_yieldRate <= 10000, "Yield rate cannot exceed 100%");
        yieldRate = _yieldRate;
        depositsPaused = false;

        // Grant pauser role to admin if not already granted
        if (!hasRole(PAUSER_ROLE, admin)) {
            _grantRole(PAUSER_ROLE, admin);
        }
    }

    /**
     * @dev Deposit tokens into the vault
     * Deducts fee from deposit amount
     * @param amount Amount of tokens to deposit
     */
    function deposit(uint256 amount) external {
        require(!depositsPaused, "Deposits are paused");
        require(amount > 0, "Deposit amount must be > 0");

        // Calculate fee and amount after fee
        uint256 fee = (amount * depositFee) / 10000;
        uint256 amountAfterFee = amount - fee;

        // Transfer tokens from user to contract
        require(
            token.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );

        // Update balances
        userBalances[msg.sender] += amountAfterFee;
        totalDepositAmount += amountAfterFee;

        // Initialize claim time for new users
        if (lastClaimTime[msg.sender] == 0) {
            lastClaimTime[msg.sender] = block.timestamp;
        }

        emit Deposit(msg.sender, amountAfterFee, fee);
    }

    /**
     * @dev Withdraw tokens from the vault
     * @param amount Amount of tokens to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Withdrawal amount must be > 0");
        require(userBalances[msg.sender] >= amount, "Insufficient balance");

        // Update balances
        userBalances[msg.sender] -= amount;
        totalDepositAmount -= amount;

        // Transfer tokens to user
        require(token.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @dev Set yield rate (admin only)
     * @param _yieldRate New yield rate in basis points
     */
    function setYieldRate(uint256 _yieldRate)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_yieldRate <= 10000, "Yield rate cannot exceed 100%");
        yieldRate = _yieldRate;
        emit YieldRateUpdated(_yieldRate);
    }

    /**
     * @dev Get current yield rate
     * @return Yield rate in basis points
     */
    function getYieldRate() external view returns (uint256) {
        return yieldRate;
    }

    /**
     * @dev Calculate unclaimed yield for a user
     * Yield = (userBalance * yieldRate * timeElapsed) / (365 days * 10000)
     * @param user Address of user
     * @return Unclaimed yield amount
     */
    function getUserYield(address user) external view returns (uint256) {
        if (userBalances[user] == 0) {
            return accumulatedYield[user];
        }

        uint256 timeElapsed = block.timestamp - lastClaimTime[user];
        uint256 yield = (userBalances[user] * yieldRate * timeElapsed) /
            (365 days * 10000);

        return accumulatedYield[user] + yield;
    }

    /**
     * @dev Claim accumulated yield
     * @return Amount of yield claimed
     */
    function claimYield() external returns (uint256) {
        require(userBalances[msg.sender] > 0, "No balance to generate yield");

        // Calculate yield since last claim
        uint256 timeElapsed = block.timestamp - lastClaimTime[msg.sender];
        uint256 yield = (userBalances[msg.sender] * yieldRate * timeElapsed) /
            (365 days * 10000);

        // Update accumulated yield and claim time
        uint256 totalYield = accumulatedYield[msg.sender] + yield;
        accumulatedYield[msg.sender] = 0;
        lastClaimTime[msg.sender] = block.timestamp;

        // Transfer yield to user
        require(
            token.transfer(msg.sender, totalYield),
            "Yield transfer failed"
        );

        emit YieldClaimed(msg.sender, totalYield);
        return totalYield;
    }

    /**
     * @dev Pause deposits (pauser role)
     */
    function pauseDeposits() external onlyRole(PAUSER_ROLE) {
        depositsPaused = true;
        emit DepositsToggled(true);
    }

    /**
     * @dev Unpause deposits (pauser role)
     */
    function unpauseDeposits() external onlyRole(PAUSER_ROLE) {
        depositsPaused = false;
        emit DepositsToggled(false);
    }

    /**
     * @dev Check if deposits are paused
     * @return True if deposits are paused
     */
    function isDepositsPaused() external view returns (bool) {
        return depositsPaused;
    }

    /**
     * @dev Get user balance
     * @param user Address of user
     * @return User's balance
     */
    function balanceOf(address user) external view returns (uint256) {
        return userBalances[user];
    }

    /**
     * @dev Get total deposits in vault
     * @return Total amount of deposits
     */
    function totalDeposits() external view returns (uint256) {
        return totalDepositAmount;
    }

    /**
     * @dev Get deposit fee
     * @return Fee in basis points
     */
    function getDepositFee() external view returns (uint256) {
        return depositFee;
    }

    /**
     * @dev Get implementation version
     * @return Version string
     */
    function getImplementationVersion() external pure returns (string memory) {
        return "V2";
    }

    /**
     * @dev Authorize upgrade
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}
}
