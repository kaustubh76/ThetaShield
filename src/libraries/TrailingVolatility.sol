// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title TrailingVolatility
/// @notice Population standard deviation over a bounded trailing markout window.
/// @dev `trailingSigma` reads indices strictly below `currentIndex`, making it
///      impossible for the observation being scored to widen its own band.
library TrailingVolatility {
    uint256 internal constant MAX_TRAILING_OBSERVATIONS = 256;
    uint256 internal constant MAX_ABS_MARKOUT_WAD = 10 * ThetaShieldUnits.WAD;

    error EmptyWindow();
    error CurrentIndexOutOfBounds(uint256 currentIndex, uint256 length);
    error TooManyObservations(uint256 supplied, uint256 maximum);
    error MarkoutOutOfBounds(uint256 index, int256 markoutWad);

    /// @notice Calculates sigma from observations before `currentIndex` only.
    function trailingSigma(int256[] memory markoutsWad, uint256 currentIndex, uint256 window)
        internal
        pure
        returns (uint256 sigmaWad, uint256 sampleCount)
    {
        if (window == 0) revert EmptyWindow();
        if (currentIndex > markoutsWad.length) {
            revert CurrentIndexOutOfBounds(currentIndex, markoutsWad.length);
        }

        uint256 start = currentIndex > window ? currentIndex - window : 0;
        sampleCount = currentIndex - start;
        if (sampleCount > MAX_TRAILING_OBSERVATIONS) {
            revert TooManyObservations(sampleCount, MAX_TRAILING_OBSERVATIONS);
        }
        if (sampleCount < 2) return (0, sampleCount);

        int256 sum;
        for (uint256 index = start; index < currentIndex; ++index) {
            _validateMarkout(markoutsWad[index], index);
            sum += markoutsWad[index];
        }
        // sampleCount is bounded to 256, so it is always representable as int256.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 meanWad = sum / int256(sampleCount);

        uint256 sumSquaredDeviations;
        for (uint256 index = start; index < currentIndex; ++index) {
            uint256 deviation = FixedPointMath.abs(markoutsWad[index] - meanWad);
            sumSquaredDeviations += deviation * deviation;
        }

        sigmaWad = FixedPointMath.sqrt(sumSquaredDeviations / sampleCount);
    }

    function _validateMarkout(int256 markoutWad, uint256 index) private pure {
        if (FixedPointMath.abs(markoutWad) > MAX_ABS_MARKOUT_WAD) {
            revert MarkoutOutOfBounds(index, markoutWad);
        }
    }
}
