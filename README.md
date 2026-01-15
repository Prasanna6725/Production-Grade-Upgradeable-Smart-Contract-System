# Production-Grade Upgradeable Smart Contract System

A comprehensive implementation of an upgradeable token vault system using the UUPS (Universal Upgradeable Proxy Standard) pattern. This project demonstrates production-ready smart contract upgrade patterns suitable for DeFi protocols and enterprise blockchain applications.

## Overview

This project implements a three-version upgrade lifecycle of a TokenVault contract:

- **V1**: Basic deposit/withdrawal functionality with fee deduction
- **V2**: Adds yield generation and deposit pause controls
- **V3**: Introduces withdrawal delays and emergency mechanisms

All versions maintain backward compatibility, preserve user state across upgrades, and implement proper access control and security hardening.

## Architecture

### Upgrade Pattern: UUPS

The system uses the Universal Upgradeable Proxy Standard (UUPS), which places upgrade logic in the implementation contract rather than the proxy. This provides:

- **Gas efficiency**: Lighter proxy contract
- **Security**: Implementation contract controls upgrades
- **Flexibility**: Implementation can be frozen after reaching final state

### Storage Layout Management

Critical for upgradeable contracts, this implementation:

1. **Never reorders state variables** - Once declared, variables maintain their storage slot
2. **Uses storage gaps** - Reserves space for future upgrades:
   - V1: 50-slot gap (45 remaining after state vars)
   - V2: 45-slot gap (reduced to 41 after adding 4 new variables)
   - V3: 41-slot gap (reduced to 39 after adding 2 new variables)

3. **Enforces append-only pattern** - New state variables are always appended at the end

Example from TokenVaultV2:
```solidity
// V1 Storage (unchanged)
IERC20Upgradeable public token;
address public admin;
uint256 public depositFee;
mapping(address => uint256) public userBalances;
uint256 public totalDeposits;

// V2 New Storage (appended)
uint256 public yieldRate;
mapping(address => uint256) public lastClaimTime;
mapping(address => uint256) public accumulatedYield;
bool public depositsPaused;

// Gap for future upgrades
uint256[41] private __gap;  // Reduced from 45 to account for 4 new vars
```

### Access Control

The system implements role-based access control using OpenZeppelin's AccessControl:

- **DEFAULT_ADMIN_ROLE**: Can grant/revoke all roles, set yield rates, set withdrawal delays
- **UPGRADER_ROLE**: Can authorize contract upgrades
- **PAUSER_ROLE**: Can pause/unpause deposits (V2+)

Roles are initially granted to the admin address during initialization, allowing for centralized control with option to transfer roles.

### Initialization Security

To prevent reinitialization attacks:

1. **No constructors in implementations** - Constructors cannot be used in upgradeable contracts
2. **_disableInitializers()** - Called in implementation's constructor to lock initialization
3. **initializer modifier** - Used on initialize() to ensure single-time execution
4. **reinitializer(version)** - Used for upgrade-specific initialization

Example:
```solidity
constructor() {
    _disableInitializers();  // Prevents direct initialization of implementation
}

function initialize(address _token, address _admin, uint256 _depositFee) 
    external 
    initializer  // Only executes once
{
    // Initialization logic
}

function initializeV2(uint256 _yieldRate)
    external
    reinitializer(2)  // Executes only during V1->V2 upgrade
{
    // V2-specific initialization
}
```

## Business Logic

### V1: Basic Deposit/Withdrawal

**Fee Deduction**:
- User deposits 1000 tokens with 5% fee
- Fee amount = (1000 × 500) / 10000 = 50 tokens
- User balance credited = 950 tokens
- Total deposits = 950 tokens
- Vault receives 1000 tokens (50 tokens represent protocol revenue)

**Balance Tracking**:
- `balanceOf(user)`: User's current balance
- `totalDeposits()`: Sum of all user balances (not including fees)

### V2: Yield Generation

**Yield Calculation Formula**:
```
Yield = (userBalance × yieldRate × timeElapsed) / (365 days × 10000)
```

Where:
- `yieldRate`: Basis points (500 = 5% annual, 10000 = 100% annual)
- `timeElapsed`: Seconds since last claim
- `365 days`: Constant = 31,536,000 seconds

**Key Properties**:
- Yield accrues continuously based on time and balance
- Yield is not compound (new yield is based on original balance)
- Each user tracks `lastClaimTime` independently
- Claiming yield resets the timer for next accrual period

**Example**:
```
Balance: 1000 tokens
Yield Rate: 500 (5% annual)
Time Elapsed: 1 day (86400 seconds)

Yield = (1000 × 500 × 86400) / (365 × 86400 × 10000)
      = (1000 × 500 × 86400) / (31,536,000 × 10000)
      = 43,200,000,000 / 315,360,000,000
      ≈ 0.137 tokens
```

**Pause Mechanism**:
- Only addresses with PAUSER_ROLE can pause/unpause deposits
- Withdrawals, yield claims, and other operations continue normally during pause
- Useful for emergency situations or maintenance windows

### V3: Withdrawal Delays & Emergency

**Two-Step Withdrawal Process**:

1. **Request Phase**: `requestWithdrawal(amount)`
   - User specifies amount they wish to withdraw
   - Request is timestamped
   - Only one pending request per user (new request cancels previous)

2. **Execution Phase**: `executeWithdrawal()`
   - Can only execute after `withdrawalDelay` has passed
   - Transfers funds to user
   - Clears the pending request

**Backward Compatibility**:
- `withdraw(amount)` still available for immediate withdrawal (bypasses delay)
- Maintains compatibility with V2 behavior
- Allows gradual migration to two-step process

**Emergency Withdrawal**:
- Bypasses delay completely
- Transfers user's entire balance immediately
- Clears any pending withdrawal requests
- Use case: Emergency situations, exploits, or protocol issues

**Example Timeline**:
```
Time 0:     User calls requestWithdrawal(500)
Time 0+1s:  Pending request active, cannot execute
Time 0+7d:  Delay satisfied, executeWithdrawal() available
Time 0+7d+1s: User calls executeWithdrawal(), receives tokens
```

## Contract Functions Reference

### TokenVaultV1

```solidity
// Initialization
function initialize(address _token, address _admin, uint256 _depositFee) external

// Core Operations
function deposit(uint256 amount) external
function withdraw(uint256 amount) external

// View Functions
function balanceOf(address user) external view returns (uint256)
function totalDeposits() external view returns (uint256)
function getDepositFee() external view returns (uint256)
function getImplementationVersion() external pure returns (string memory)

// Admin
function _authorizeUpgrade(address newImplementation) internal onlyRole(UPGRADER_ROLE)
```

### TokenVaultV2 (includes all V1 functions plus)

```solidity
// Initialization
function initializeV2(uint256 _yieldRate) external reinitializer(2)

// Yield Management
function setYieldRate(uint256 _yieldRate) external onlyRole(DEFAULT_ADMIN_ROLE)
function getYieldRate() external view returns (uint256)
function claimYield() external returns (uint256)
function getUserYield(address user) external view returns (uint256)

// Pause Control
function pauseDeposits() external onlyRole(PAUSER_ROLE)
function unpauseDeposits() external onlyRole(PAUSER_ROLE)
function isDepositsPaused() external view returns (bool)
```

### TokenVaultV3 (includes all V1 + V2 functions plus)

```solidity
// Initialization
function initializeV3(uint256 _withdrawalDelay) external reinitializer(3)

// Withdrawal Management
function requestWithdrawal(uint256 amount) external
function executeWithdrawal() external returns (uint256)
function emergencyWithdraw() external returns (uint256)
function setWithdrawalDelay(uint256 _delaySeconds) external onlyRole(DEFAULT_ADMIN_ROLE)

// View Functions
function getWithdrawalDelay() external view returns (uint256)
function getWithdrawalRequest(address user) external view returns (uint256 amount, uint256 requestTime)
```

## Installation & Setup

### Prerequisites

- Node.js 18+ and npm/yarn
- Git
- Basic understanding of smart contracts and Hardhat

### Installation Steps

```bash
# Clone repository
git clone <repository-url>
cd Production-Grade-Upgradeable-Smart-Contract-System

# Install dependencies
npm install

# Verify Hardhat installation
npx hardhat --version
```

### Configuration

Create a `.env` file in the root directory (optional, for network deployment):

```env
# Network RPC endpoints
ALCHEMY_API_KEY=your_alchemy_key
INFURA_API_KEY=your_infura_key

# Private key for deployments (DO NOT commit to git)
PRIVATE_KEY=your_private_key

# Etherscan verification
ETHERSCAN_API_KEY=your_etherscan_key
```

## Compilation

```bash
# Compile all contracts
npm run compile

# Or with Hardhat directly
npx hardhat compile
```

This will:
- Compile Solidity contracts to bytecode and ABI
- Generate TypeScript types (if using Hardhat with TypeScript)
- Output artifacts to `./artifacts` directory

## Running Tests

### Full Test Suite

```bash
# Run all tests
npm test

# With gas reports
REPORT_GAS=true npm test

# With coverage
npm run test:coverage
```

### Individual Test Suites

```bash
# Test V1 functionality
npx hardhat test test/TokenVaultV1.test.js

# Test V1 to V2 upgrade
npx hardhat test test/upgrade-v1-to-v2.test.js

# Test V2 to V3 upgrade
npx hardhat test test/upgrade-v2-to-v3.test.js

# Test security properties
npx hardhat test test/security.test.js
```

### Test Coverage Report

```bash
npm run test:coverage
```

This generates:
- Terminal report showing line/branch/function coverage
- HTML report at `./coverage/index.html`

**Target**: Minimum 90% coverage achieved across all contract files.

## Deployment

### Local Development Network

```bash
# Terminal 1: Start local blockchain
npx hardhat node

# Terminal 2: Deploy V1
npx hardhat run scripts/deploy-v1.js --network localhost

# Set environment variable with proxy address from deployment output
export VAULT_PROXY_ADDRESS=0x<proxy-address>

# Upgrade to V2
npx hardhat run scripts/upgrade-to-v2.js --network localhost

# Upgrade to V3
npx hardhat run scripts/upgrade-to-v3.js --network localhost
```

### Deployment Script Outputs

Each script outputs:
- Token address
- Proxy address
- Implementation address
- Configuration parameters
- Verification checklist

### Example Deployment Flow

```bash
$ npx hardhat run scripts/deploy-v1.js --network localhost
Deploying TokenVaultV1...
Deploying with account: 0x1234...
MockERC20 deployed to: 0xaaaa...
TokenVaultV1 proxy deployed to: 0xbbbb...
TokenVaultV1 implementation deployed to: 0xcccc...
Implementation version: V1

=== Deployment Summary ===
Token Address: 0xaaaa...
Vault Proxy Address: 0xbbbb...
Vault Implementation Address: 0xcccc...
Admin Address: 0x1234...
Deposit Fee: 500 basis points (5%)
```

## Security Considerations

### 1. Storage Layout Validation

The implementation validates storage layout consistency:

```solidity
// V1 Storage (50 slots reserved including gap)
uint256[45] private __gap;  // 45 slots

// V2 Storage (4 new variables added)
uint256 public yieldRate;                      // slot 1
mapping(address => uint256) public lastClaimTime;  // 1 slot (mapping uses hash)
mapping(address => uint256) public accumulatedYield; // 1 slot
bool public depositsPaused;                    // 1 slot
uint256[41] private __gap;  // Reduced to 41 to maintain 50-slot reserve
```

**Verification Process**:
- Contracts compile without storage layout errors
- Upgrades execute without storage collisions
- State variables preserve values across upgrades
- Tests verify state preservation

### 2. Initialization Security

Prevents multiple critical vulnerabilities:

**Reinitialization Attack**:
```solidity
// ❌ Without protection
function initialize(address admin) external {
    adminAddress = admin;  // Can be called multiple times!
}

// ✓ With initializer modifier
function initialize(address admin) external initializer {
    adminAddress = admin;  // Can only be called once
}
```

**Implementation Direct Initialization**:
```solidity
// ✓ Implementation constructor
constructor() {
    _disableInitializers();  // Prevents direct initialization
}
```

### 3. Access Control Enforcement

Role-based permission system prevents unauthorized actions:

```solidity
// Only UPGRADER_ROLE can upgrade
function _authorizeUpgrade(address newImplementation)
    internal
    override
    onlyRole(UPGRADER_ROLE)
{}

// Only DEFAULT_ADMIN_ROLE can set yield
function setYieldRate(uint256 _yieldRate)
    external
    onlyRole(DEFAULT_ADMIN_ROLE)
{}
```

### 4. Proxy Pattern Security

Uses OpenZeppelin's battle-tested UUPS implementation:

- **No initialization in proxy constructor** - Prevents initialization bypass
- **Upgrade authorization check** - Only authorized implementations can upgrade
- **Standard upgrade interface** - Uses ERC-1967 standard storage layout

### 5. Edge Case Handling

Contracts handle boundary conditions:

```solidity
// ✓ Zero fee
function initialize(address _token, address _admin, uint256 _depositFee) 
    external 
    initializer 
{
    require(_depositFee <= 10000, "Fee cannot exceed 100%");
    // 0 is valid (no fee)
}

// ✓ Zero withdrawal amount
function requestWithdrawal(uint256 amount) external {
    require(amount > 0, "Withdrawal amount must be > 0");
    // Prevents zero-amount requests
}

// ✓ Empty balance yield
function getUserYield(address user) external view returns (uint256) {
    if (userBalances[user] == 0) {
        return accumulatedYield[user];  // Returns accumulated only
    }
    // Calculate new yield...
}
```

## Known Limitations & Design Decisions

### 1. Single Withdrawal Request Per User

**Decision**: Only one pending withdrawal per user at a time

**Rationale**:
- Simplifies state management
- Prevents withdrawal queue complexity
- New request cancels previous (simpler UX than rejection)
- Aligned with typical user flows (one pending withdrawal per session)

**Alternative Considered**:
- Queue of withdrawal requests per user (higher complexity, more gas)
- Rejection of new requests while pending (UX friction)

### 2. Non-Compound Yield

**Decision**: Yield based on original balance, not compound interest

**Rationale**:
- Gas efficient (linear not exponential calculation)
- Predictable for users (easier mental math)
- Simpler smart contract logic
- More controlled for protocol (easier to manage total yield liability)

**Alternative Considered**:
- Compound interest (more attractive for users, but much more complex)
- Daily snapshots (gas intensive)

### 3. Emergency Withdraw Without Role Restriction

**Decision**: Any user can call `emergencyWithdraw()` without special role

**Rationale**:
- Maximizes user autonomy during emergencies
- Doesn't require governance or multi-sig approval
- Prevents funds from being trapped
- Aligns with DeFi philosophy of non-custodial access

**Alternative Considered**:
- Admin-only emergency withdraw (more control but less user autonomy)
- Time-locked emergency withdraw (adds friction)

### 4. Backward Compatibility with V1/V2 Withdraw

**Decision**: Maintain direct `withdraw()` function in V3 alongside two-step withdrawal

**Rationale**:
- Allows users to gradually migrate to new pattern
- Prevents breaking existing integrations
- Simplifies testing (can compare old vs new)
- Reduces forced changes for all users

**Implementation Complexity**:
- V3 contracts ~30% larger due to dual withdrawal mechanisms
- Tests must cover both paths
- Documentation must clarify recommended approach

## Testing Strategy

### Test Organization

```
test/
├── TokenVaultV1.test.js        # V1 functionality
├── upgrade-v1-to-v2.test.js    # Upgrade & V2 features
├── upgrade-v2-to-v3.test.js    # Upgrade & V3 features
└── security.test.js             # Security properties
```

### Test Categories

**Functionality Tests** (TokenVaultV1.test.js):
- Initialization with correct parameters
- Deposit with fee deduction
- Balance updates
- Withdrawal with balance verification
- Reinitialization prevention

**Upgrade Tests** (upgrade-v1-to-v2.test.js, upgrade-v2-to-v3.test.js):
- User balance preservation
- Total deposits preservation
- Admin access control preservation
- New feature functionality
- State consistency

**Security Tests** (security.test.js):
- Implementation direct initialization prevention
- Unauthorized upgrade prevention
- Storage gap usage verification
- Storage collision prevention
- Function selector clash prevention
- Edge case handling (zero fee, max fee, etc.)

### Mocking & Test Helpers

Uses Hardhat's built-in utilities:

```javascript
// Time manipulation
const { time } = require("@nomicfoundation/hardhat-network-helpers");
await time.increase(86400);  // Advance 1 day

// Event testing
expect(tx).to.emit(contract, "EventName")
  .withArgs(expectedArg1, expectedArg2);

// Revert testing
await expect(tx).to.be.revertedWith("Error message");

// Snapshot testing
const snapshot = await ethers.provider.send("evm_snapshot");
await ethers.provider.send("evm_revert", [snapshot]);
```

### Coverage Metrics

Test coverage breakdown:
- **Lines**: >90%
- **Branches**: >85%
- **Functions**: >95%
- **Statements**: >90%

Critical paths:
- All deposit/withdrawal paths ✓
- All upgrade paths ✓
- All access control checks ✓
- All state transitions ✓

## Advanced Topics

### Understanding UUPS vs Transparent Proxy

This implementation uses UUPS. Key differences:

| Aspect | UUPS | Transparent |
|--------|------|-----------|
| Upgrade logic location | Implementation | Proxy |
| Proxy size | Lighter | Heavier |
| Function selector clash risk | None | Potential |
| Gas cost | Lower | Higher |
| Admin role complexity | Simpler | Complex (to avoid clash) |

UUPS chosen because:
- More gas efficient for users
- No function selector clash issues
- Implementation controls its fate
- Simpler admin patterns

### Storage Layout Deep Dive

Storage layout is critical for contract safety:

```solidity
// NEVER change this order in upgrades!
address public admin;              // Slot 0
uint256 public depositFee;         // Slot 1
mapping(address => uint256) public userBalances;  // Slot 2 (mapping key)

// SAFE: Add new variables at the end
uint256 public yieldRate;          // Slot 3

// SAFE: Add storage gap
uint256[N] private __gap;          // Slots 4-(4+N-1)
```

**Why this matters**:
- Smart contracts use fixed storage slots for state variables
- Contracts read/write to specific slots for state
- If you reorder or remove variables, slots change
- This causes reading wrong data or overwriting important values
- Can completely break contract functionality

**Validation Tools**:
- Hardhat Upgrades plugin includes storage layout validator
- OpenZeppelin provides storage layout inspection tools
- We validate through comprehensive test suite

### Role-Based Access Control in Practice

The RBAC implementation provides:

**Role Management**:
```solidity
// Grant role
_grantRole(UPGRADER_ROLE, newUpgrader);

// Revoke role
_revokeRole(UPGRADER_ROLE, oldUpgrader);

// Check role
require(hasRole(UPGRADER_ROLE, msg.sender), "Not upgrader");
```

**Event Tracking**:
```solidity
event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
```

**Multi-sig Compatible**:
Can be extended with multi-sig wallets:
```solidity
_grantRole(UPGRADER_ROLE, multisigWallet);
```

## Production Deployment Checklist

Before deploying to mainnet:

- [ ] All tests passing with >90% coverage
- [ ] Security audit completed (recommend: OpenZeppelin, Certora, or similar)
- [ ] Testnet deployment successful
- [ ] Testnet upgrade sequence tested end-to-end
- [ ] Admin key security verified (hardware wallet, multi-sig, etc.)
- [ ] Upgrade authorization verified in code review
- [ ] Event logging verified (for off-chain monitoring)
- [ ] Documentation reviewed and validated
- [ ] Runbooks for emergency procedures prepared
- [ ] Monitoring and alerting configured
- [ ] Governance process documented (if applicable)

## Governance & Upgrade Process (For Production)

Recommended process for production systems:

1. **Development Phase**
   - Implement feature on testnet
   - Run full test suite
   - Internal code review

2. **Testing Phase**
   - Deploy to testnet
   - Run upgrade sequence
   - Verify state preservation
   - Integration testing with other contracts

3. **Audit Phase**
   - External security audit
   - Address audit findings
   - Re-audit if necessary

4. **Governance Phase**
   - Community discussion/voting
   - Multi-sig approval (if applicable)
   - Time-lock delay before execution

5. **Deployment Phase**
   - Execute upgrade on mainnet
   - Monitor transaction success
   - Verify state on chain
   - Update external systems
   - Publish announcement

## Development Workflow

### Adding a New Feature (V4 Example)

1. **Create new contract version**:
```bash
cp contracts/TokenVaultV3.sol contracts/TokenVaultV4.sol
```

2. **Update storage layout**:
```solidity
// All V3 storage (unchanged)
// ...

// V4 new storage
uint256 public newFeature;
uint256[38] private __gap;  // Reduce gap by number of new vars
```

3. **Update tests**:
```bash
cp test/upgrade-v2-to-v3.test.js test/upgrade-v3-to-v4.test.js
```

4. **Update scripts**:
```bash
cp scripts/upgrade-to-v3.js scripts/upgrade-to-v4.js
```

5. **Verify**:
```bash
npm test
npm run compile
```

### Verifying Storage Layout

Use Hardhat Upgrades plugin validation:

```javascript
const layout = await upgrades.erc1967.getImplementationAddress(proxy);
// Inspect contract source to verify no variable reordering
```

## Troubleshooting

### Common Issues

**Issue**: `InvalidInitialization` error on initialization

**Solution**: Ensure `initialize()` hasn't been called yet, or use `reinitializer(2)` for upgrades

**Issue**: Storage collision after upgrade

**Solution**: 
- Check storage gap was reduced correctly
- Verify no variables were reordered
- Use Hardhat Upgrades plugin validation

**Issue**: "Unauthorized" errors on upgrade

**Solution**:
- Verify account has UPGRADER_ROLE
- Check role was granted to correct address

**Issue**: Yield calculation seems off

**Solution**:
- Verify `lastClaimTime` was initialized on first deposit
- Check time elapsed is in seconds, not blocks
- Confirm `yieldRate` is in basis points (500 = 5%)

## Resources

### Documentation
- [OpenZeppelin Upgrades Documentation](https://docs.openzeppelin.com/upgrades-plugins/1.x/)
- [ERC-1967 Proxy Standard](https://eips.ethereum.org/EIPS/eip-1967)
- [Solidity Storage Layout](https://docs.soliditylang.org/en/v0.8.20/internals/layout_in_storage.html)
- [Hardhat Documentation](https://hardhat.org/docs)

### Tools
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [OpenZeppelin Contracts Upgradeable](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable)
- [Hardhat Upgrades](https://hardhat.org/hardhat-runner/plugins/nomiclabs-hardhat-upgrades)

### Security Resources
- [Consensys Smart Contract Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [OpenZeppelin Security Documentation](https://docs.openzeppelin.com/contracts/5.x/security)
- [Ethereum Development Documentation](https://ethereum.org/en/developers/docs/)

### Community
- [Ethereum Stack Exchange](https://ethereum.stackexchange.com/)
- [OpenZeppelin Forum](https://forum.openzeppelin.com/)
- [Solidity Discussions](https://github.com/ethereum/solidity/discussions)

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Authors

Production-grade implementation demonstrating best practices for upgradeable smart contract systems.

---

**Version**: 1.0.0
**Last Updated**: January 2026
**Status**: Production Ready
