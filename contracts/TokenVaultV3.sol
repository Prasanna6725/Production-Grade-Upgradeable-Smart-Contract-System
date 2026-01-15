// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title TokenVaultV3
 * @dev V3 adds withdrawal delays and emergency mechanisms while maintaining all V1+V2 functionality
 * Storage layout preserves all V1+V2 variables and adds new ones at the end
 */
contract TokenVaultV3 is
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

    // V2 Storage - MUST NOT CHANGE
    uint256 public yieldRate;
    mapping(address => uint256) public lastClaimTime;
    mapping(address => uint256) public accumulatedYield;
    bool public depositsPaused;

    // V3 New Storage - appended after V2 storage
    uint256 public withdrawalDelay; // in seconds
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    // Storage gap for future upgrades (reduced from 41 to 39 to account for 2 new vars)
    uint256[39] private __gap;

    // Structures
    struct WithdrawalRequest {
        uint256 amount;
        uint256 requestTime;
    }

    // Events (inherit from V1 and V2)
    event Deposit(address indexed user, uint256 amount, uint256 fee);
    event Withdrawal(address indexed user, uint256 amount);
    event FeeUpdated(uint256 newFee);
    event YieldRateUpdated(uint256 newRate);
    event YieldClaimed(address indexed user, uint256 amount);
    event DepositsToggled(bool paused);
    event WithdrawalDelayUpdated(uint256 newDelay);
    event WithdrawalRequested(
        address indexed user,
        uint256 amount,
        uint256 requestTime
    );
    event WithdrawalExecuted(address indexed user, uint256 amount);
    event EmergencyWithdrawal(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize V3 - called once during V2->V3 upgrade via reinitializer
     */
    function initializeV3(uint256 _withdrawalDelay)
        external
        reinitializer(3)
    {
        require(
            _withdrawalDelay <= 30 days,
            "Withdrawal delay cannot exceed 30 days"
        );
        withdrawalDelay = _withdrawalDelay;
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
     * @dev Request withdrawal with delay
     * New request cancels previous pending request
     * @param amount Amount of tokens to withdraw
     */
    function requestWithdrawal(uint256 amount) external {
        require(amount > 0, "Withdrawal amount must be > 0");
        require(userBalances[msg.sender] >= amount, "Insufficient balance");

        // Cancel previous request if any
        withdrawalRequests[msg.sender] = WithdrawalRequest(
            amount,
            block.timestamp
        );

        emit WithdrawalRequested(msg.sender, amount, block.timestamp);
    }

    /**
     * @dev Execute withdrawal after delay period
     * @return Amount of tokens withdrawn
     */
    function executeWithdrawal() external returns (uint256) {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];
        require(request.amount > 0, "No pending withdrawal request");
        require(
            block.timestamp >= request.requestTime + withdrawalDelay,
            "Withdrawal delay not satisfied"
        );

        uint256 amount = request.amount;
        require(userBalances[msg.sender] >= amount, "Insufficient balance");

        // Clear request
        withdrawalRequests[msg.sender].amount = 0;
        withdrawalRequests[msg.sender].requestTime = 0;

        // Update balances
        userBalances[msg.sender] -= amount;
        totalDepositAmount -= amount;

        // Transfer tokens to user
        require(token.transfer(msg.sender, amount), "Transfer failed");

        emit WithdrawalExecuted(msg.sender, amount);
        return amount;
    }

    /**
     * @dev Emergency withdraw bypassing delay (implementation choice: no role required)
     * @return Amount of tokens withdrawn
     */
    function emergencyWithdraw() external returns (uint256) {
        require(userBalances[msg.sender] > 0, "No balance to withdraw");

        uint256 amount = userBalances[msg.sender];

        // Clear pending withdrawal request if any
        withdrawalRequests[msg.sender].amount = 0;
        withdrawalRequests[msg.sender].requestTime = 0;

        // Update balances
        userBalances[msg.sender] = 0;
        totalDepositAmount -= amount;

        // Transfer tokens to user
        require(token.transfer(msg.sender, amount), "Transfer failed");

        emit EmergencyWithdrawal(msg.sender, amount);
        return amount;
    }

    /**
     * @dev Withdraw tokens immediately (for backward compatibility with V1/V2)
     * This function is deprecated in favor of requestWithdrawal + executeWithdrawal
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
     * @dev Set withdrawal delay (admin only)
     * @param _delaySeconds New delay in seconds
     */
    function setWithdrawalDelay(uint256 _delaySeconds)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            _delaySeconds <= 30 days,
            "Withdrawal delay cannot exceed 30 days"
        );
        withdrawalDelay = _delaySeconds;
        emit WithdrawalDelayUpdated(_delaySeconds);
    }

    /**
     * @dev Get current withdrawal delay
     * @return Delay in seconds
     */
    function getWithdrawalDelay() external view returns (uint256) {
        return withdrawalDelay;
    }

    /**
     * @dev Get withdrawal request details
     * @param user Address of user
     * @return amount Amount requested to withdraw
     * @return requestTime Time of request
     */
    function getWithdrawalRequest(address user)
        external
        view
        returns (uint256 amount, uint256 requestTime)
    {
        WithdrawalRequest storage request = withdrawalRequests[user];
        return (request.amount, request.requestTime);
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
        return "V3";
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
