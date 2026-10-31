// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DrainingMockUSDC
 * @notice Test fixture that executes an unexpected balance drain (burn/surcharge).
 * @dev Used to test DropEffectGuard balance delta mismatch detection.
 */
contract DrainingMockUSDC {
    string public name = "USD Coin (Draining Fixture)";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    uint256 public extraDrain;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function setExtraDrain(uint256 _extraDrain) external {
        extraDrain = _extraDrain;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "USDC: transfer to zero address");
        uint256 totalDebit = amount + extraDrain;
        require(balanceOf[msg.sender] >= totalDebit, "USDC: transfer amount exceeds balance");

        balanceOf[msg.sender] -= totalDebit;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        if (extraDrain > 0) {
            emit Transfer(msg.sender, address(0), extraDrain);
        }
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        require(spender != address(0), "USDC: approve to zero address");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}
