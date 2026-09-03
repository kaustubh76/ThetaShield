// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ThetaShieldUnits
/// @notice Canonical denominators used across ThetaShield contracts and tests.
library ThetaShieldUnits {
    /// @notice Fixed-point denominator for signed risk and normalized prices.
    uint256 internal constant WAD = 1e18;

    /// @notice Denominator for confidence and other basis-point values.
    uint256 internal constant BPS = 10_000;

    /// @notice Denominator for Uniswap fee-pip values, where 1e6 is 100%.
    uint256 internal constant FEE_PIPS = 1_000_000;
}
