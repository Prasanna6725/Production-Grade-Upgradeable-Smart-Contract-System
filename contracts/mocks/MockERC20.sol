// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token for testing
 */
contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MOCK") {
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Mint tokens (for testing)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
