// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @title IThetaShieldController
/// @notice Read-only controller surface used on the hook's swap path.
interface IThetaShieldController {
    /// @return feePips Direction-specific Uniswap fee in hundredths of a basis point.
    /// @return usedBaseline True when pause, expiry, timing, or confidence caused fallback.
    function feeForSwap(bytes32 poolId, bool zeroForOne) external view returns (uint24 feePips, bool usedBaseline);
}
