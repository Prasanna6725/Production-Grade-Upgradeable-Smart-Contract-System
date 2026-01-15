// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title TokenVaultV1
 * @dev V1 of the upgradeable TokenVault implementing basic deposit/withdrawal with fees
 * Uses UUPS proxy pattern with proper storage layout and access control
 */
contract TokenVaultV1 is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable
{
    // Role definitions
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // Storage layout - Critical for upgrades
    IERC20Upgradeable public token;
    address public admin;
    uint256 public depositFee; // in basis points (500 = 5%)
    
    mapping(address => uint256) public userBalances;
    uint256 public totalDepositAmount;

    // Storage gap for future upgrades
    uint256[45] private __gap;

    // Events
    event Deposit(address indexed user, uint256 amount, uint256 fee);
    event Withdrawal(address indexed user, uint256 amount);
    event FeeUpdated(uint256 newFee);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract - replaces constructor in upgradeable pattern
     * @param _token Address of ERC20 token for deposits
     * @param _admin Address of admin account
     * @param _depositFee Fee in basis points (500 = 5%)
     */
    function initialize(
        address _token,
        address _admin,
        uint256 _depositFee
    ) external initializer {
        require(_token != address(0), "Invalid token address");
        require(_admin != address(0), "Invalid admin address");
        require(_depositFee <= 10000, "Fee cannot exceed 100%");

        token = IERC20Upgradeable(_token);
        admin = _admin;
        depositFee = _depositFee;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(UPGRADER_ROLE, _admin);
    }

    /**
     * @dev Deposit tokens into the vault
     * Deducts fee from deposit amount
     * @param amount Amount of tokens to deposit
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Deposit amount must be > 0");

        // Calculate fee and amount after fee
        uint256 fee = (amount * depositFee) / 10000;
        uint256 amountAfterFee = amount - fee;

        // Transfer tokens from user to contract
        require(
            token.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );

        // Update balances (fee is not credited to anyone in V1)
        userBalances[msg.sender] += amountAfterFee;
        totalDepositAmount += amountAfterFee;

        emit Deposit(msg.sender, amountAfterFee, fee);
    }

    /**
     * @dev Withdraw tokens from the vault
     * @param amount Amount of tokens to withdraw
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Withdrawal amount must be > 0");
        require(userBalances[msg.sender] >= amount, "Insufficient balance");

        // Update balances first (checks-effects-interactions)
        userBalances[msg.sender] -= amount;
        totalDepositAmount -= amount;

        // Transfer tokens to user
        require(token.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawal(msg.sender, amount);
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
     * @dev Get current deposit fee
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
        return "V1";
    }

    /**
     * @dev Authorize upgrade - only UPGRADER_ROLE can upgrade
     * @param newImplementation Address of new implementation
     */
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}
}
