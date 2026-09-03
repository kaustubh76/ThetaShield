// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title ReferencePriceDispersion
/// @notice Bounded normalized weighted mean absolute deviation around a weighted median.
/// @dev The weighted median provides a manipulation-resistant center. Averaging the
///      weighted absolute deviations avoids the degenerate zero-MAD result common
///      with only two equally weighted sources.
library ReferencePriceDispersion {
    uint8 internal constant MAX_REFERENCE_SOURCES = 16;

    struct Sample {
        uint256 priceWad;
        uint256 weightWad;
    }

    struct Result {
        uint256 weightedMedianPriceWad;
        uint256 weightedMeanAbsoluteDeviationWad;
        uint256 normalizedDispersionWad;
    }

    error InvalidReferenceSamples();

    /// @notice Calculates robust center and normalized dispersion for reference sources.
    function calculate(Sample[] memory samples) internal pure returns (Result memory result) {
        if (samples.length == 0 || samples.length > MAX_REFERENCE_SOURCES) {
            revert InvalidReferenceSamples();
        }

        Sample[] memory sorted = new Sample[](samples.length);
        uint256 totalWeightWad;
        for (uint256 index; index < samples.length; ++index) {
            if (
                samples[index].priceWad == 0 || samples[index].priceWad > type(uint128).max
                    || samples[index].weightWad == 0 || samples[index].weightWad > ThetaShieldUnits.WAD
            ) revert InvalidReferenceSamples();
            sorted[index] = samples[index];
            totalWeightWad += samples[index].weightWad;
        }

        _sortByPrice(sorted);
        uint256 medianThreshold = (totalWeightWad + 1) / 2;
        uint256 cumulativeWeightWad;
        for (uint256 index; index < sorted.length; ++index) {
            cumulativeWeightWad += sorted[index].weightWad;
            if (cumulativeWeightWad >= medianThreshold) {
                result.weightedMedianPriceWad = sorted[index].priceWad;
                break;
            }
        }

        uint256 weightedDeviationSumWad;
        for (uint256 index; index < sorted.length; ++index) {
            uint256 deviationWad = sorted[index].priceWad > result.weightedMedianPriceWad
                ? sorted[index].priceWad - result.weightedMedianPriceWad
                : result.weightedMedianPriceWad - sorted[index].priceWad;
            weightedDeviationSumWad += FixedPointMath.mulWadDown(deviationWad, sorted[index].weightWad);
        }

        result.weightedMeanAbsoluteDeviationWad =
            FixedPointMath.mulDivDown(weightedDeviationSumWad, ThetaShieldUnits.WAD, totalWeightWad);
        result.normalizedDispersionWad = FixedPointMath.mulDivDown(
            result.weightedMeanAbsoluteDeviationWad, ThetaShieldUnits.WAD, result.weightedMedianPriceWad
        );
    }

    function _sortByPrice(Sample[] memory samples) private pure {
        for (uint256 index = 1; index < samples.length; ++index) {
            Sample memory current = samples[index];
            uint256 position = index;
            while (position > 0 && samples[position - 1].priceWad > current.priceWad) {
                samples[position] = samples[position - 1];
                --position;
            }
            samples[position] = current;
        }
    }
}
