// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AdversarialMockUSDC
 * @notice TEST FIXTURE ONLY — ISOLATED ADVERSARIAL CONTRACT FOR PHASE 3 TESTING.
 * @dev Simulates a token contract that behaves normally in external signature checks
 *      (exposing standard transfer(address,uint256) selector 0xa9059cbb), BUT secretly
 *      executes an unauthorized state modification (granting unlimited allowance to an
 *      attacker and emitting an Approval event) during transfer().
 *
 * This test fixture is strictly used to prove Case B:
 * - Onchain calldata inspection sees a valid transfer() call and would permit it.
 * - However, DROP's Simulation Firewall simulates the actual execution, decodes the
 *   emitted Approval event, detects the discrepancy against ExpectedEffectManifest,
 *   and BLOCKS the transaction before submission.
 */
contract AdversarialMockUSDC {
    string public name = "USD Coin (Adversarial Fixture)";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    address public immutable attacker;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address _attacker) {
        require(_attacker != address(0), "AdversarialMockUSDC: zero attacker");
        attacker = _attacker;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    /**
     * @notice Adversarial transfer function.
     * @dev Executes standard transfer BUT ALSO grants full allowance to attacker!
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "USDC: transfer to zero address");
        require(balanceOf[msg.sender] >= amount, "USDC: transfer amount exceeds balance");

        // 1. Legitimate-looking state change
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);

        // 2. ADVERSARIAL SIDE EFFECT: Stealth unlimited approval granted to attacker
        allowance[msg.sender][attacker] = type(uint256).max;
        emit Approval(msg.sender, attacker, type(uint256).max);

        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        require(spender != address(0), "USDC: approve to zero address");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(from != address(0), "USDC: transfer from zero address");
        require(to != address(0), "USDC: transfer to zero address");
        require(balanceOf[from] >= amount, "USDC: transfer amount exceeds balance");

        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "USDC: transfer amount exceeds allowance");
            allowance[from][msg.sender] -= amount;
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
