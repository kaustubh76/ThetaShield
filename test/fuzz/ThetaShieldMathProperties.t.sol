// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ThetaShieldUnits} from "../../src/base/ThetaShieldUnits.sol";
import {ConfidenceWeight} from "../../src/libraries/ConfidenceWeight.sol";
import {DeadBandFilter} from "../../src/libraries/DeadBandFilter.sol";
import {DirectionalMarkoutMath} from "../../src/libraries/DirectionalMarkoutMath.sol";
import {FeeCurve} from "../../src/libraries/FeeCurve.sol";
import {FixedPointMath} from "../../src/libraries/FixedPointMath.sol";
import {PersistenceWindow} from "../../src/libraries/PersistenceWindow.sol";
import {TrailingVolatility} from "../../src/libraries/TrailingVolatility.sol";

contract ThetaShieldMathPropertiesTest is Test {
    function testFuzz_markoutIsAntisymmetric(uint128 executionSeed, uint128 referenceSeed) external pure {
        uint256 executionPriceWad = bound(uint256(executionSeed), 1e18, 1e30);
        uint256 referencePriceWad = bound(uint256(referenceSeed), 1e18, 1e30);

        int256 buyMarkoutWad = DirectionalMarkoutMath.calculate(executionPriceWad, referencePriceWad, 1);
        int256 sellMarkoutWad = DirectionalMarkoutMath.calculate(executionPriceWad, referencePriceWad, -1);

        assertEq(buyMarkoutWad, -sellMarkoutWad);
    }

    function testFuzz_deadBandNeverFlipsSignOrIncreasesMagnitude(int96 markoutSeed, uint96 sigmaSeed, uint96 kSeed)
        external
        pure
    {
        int256 markoutWad = bound(int256(markoutSeed), -10e18, 10e18);
        uint256 sigmaWad = bound(uint256(sigmaSeed), 0, 2e18);
        uint256 kWad = bound(uint256(kSeed), 0, 3e18);

        int256 filteredWad = DeadBandFilter.filter(markoutWad, sigmaWad, kWad);

        assertLe(FixedPointMath.abs(filteredWad), FixedPointMath.abs(markoutWad));
        if (filteredWad != 0) assertEq(filteredWad > 0, markoutWad > 0);
    }

    function testFuzz_currentObservationIsExcluded(
        int64 first,
        int64 second,
        int64 third,
        int64 currentA,
        int64 currentB
    ) external pure {
        int256[] memory seriesA = new int256[](4);
        int256[] memory seriesB = new int256[](4);
        seriesA[0] = bound(int256(first), -1e18, 1e18);
        seriesA[1] = bound(int256(second), -1e18, 1e18);
        seriesA[2] = bound(int256(third), -1e18, 1e18);
        seriesA[3] = bound(int256(currentA), -10e18, 10e18);
        seriesB[0] = seriesA[0];
        seriesB[1] = seriesA[1];
        seriesB[2] = seriesA[2];
        seriesB[3] = bound(int256(currentB), -10e18, 10e18);

        (uint256 sigmaA, uint256 countA) = TrailingVolatility.trailingSigma(seriesA, 3, 3);
        (uint256 sigmaB, uint256 countB) = TrailingVolatility.trailingSigma(seriesB, 3, 3);

        assertEq(sigmaA, sigmaB);
        assertEq(countA, countB);
    }

    function testFuzz_confidenceIsBoundedByCap(
        uint16 observationCount,
        uint16 targetSeed,
        uint96 totalSeed,
        uint96 agreementSeed,
        uint96 dispersionSeed,
        uint96 maximumDispersionSeed,
        uint96 capSeed
    ) external pure {
        uint256 target = bound(uint256(targetSeed), 1, 1_000);
        uint256 totalNotionalWad = bound(uint256(totalSeed), 1, 1e28);
        uint256 agreeingNotionalWad = bound(uint256(agreementSeed), 0, totalNotionalWad);
        uint256 maximumDispersionWad = bound(uint256(maximumDispersionSeed), 1, 1e18);
        uint256 referenceDispersionWad = bound(uint256(dispersionSeed), 0, 2e18);
        uint256 confidenceCapWad = bound(uint256(capSeed), 0, ThetaShieldUnits.WAD);

        ConfidenceWeight.Components memory result = ConfidenceWeight.calculate(
            observationCount,
            target,
            agreeingNotionalWad,
            totalNotionalWad,
            referenceDispersionWad,
            maximumDispersionWad,
            confidenceCapWad
        );

        assertLe(result.confidenceWad, confidenceCapWad);
        assertLe(result.uncappedConfidenceWad, ThetaShieldUnits.WAD);
    }

    function testFuzz_persistenceBitmapNeverExceedsWindow(uint256 bitmap, bool toxic, uint8 windowSeed) external pure {
        uint16 windowLength = uint16(bound(uint256(windowSeed), 1, 255));
        uint256 updated = PersistenceWindow.push(bitmap, toxic, windowLength);
        uint256 mask = (uint256(1) << windowLength) - 1;

        assertEq(updated & ~mask, 0);
    }

    function testFuzz_feeRemainsBoundedAndRateLimited(
        int96 riskSeed,
        uint96 confidenceSeed,
        bool active,
        uint24 previousSeed
    ) external pure {
        FeeCurve.Config memory config = FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 500_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 1_000,
            maximumDecreasePips: 500,
            confidenceFloorWad: 0.5e18,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
        int256 signedRiskWad = bound(int256(riskSeed), -10e18, 10e18);
        uint256 confidenceWad = bound(uint256(confidenceSeed), 0, 1e18);
        uint24 previousFeePips = uint24(bound(uint256(previousSeed), 500, 10_000));

        FeeCurve.Result memory result =
            FeeCurve.calculate(signedRiskWad, confidenceWad, active, previousFeePips, config);

        assertGe(result.nextFeePips, config.minimumFeePips);
        assertLe(result.nextFeePips, config.maximumFeePips);
        if (result.nextFeePips > previousFeePips) {
            assertLe(result.nextFeePips - previousFeePips, config.maximumIncreasePips);
        } else {
            assertLe(previousFeePips - result.nextFeePips, config.maximumDecreasePips);
        }
    }

    function testFuzz_closedLoopCoverageNeverEscapesFeeBounds(
        uint96 revenueSeed,
        uint96 lossSeed,
        bool meetsMinimumEpochNotional
    ) external pure {
        FeeCurve.Config memory config = FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 450_000,
            coverageGainFeePips: 50,
            maximumIncreasePips: 1_000,
            maximumDecreasePips: 500,
            confidenceFloorWad: 0.5e18,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
        FeeCurve.Result memory result = FeeCurve.calculateClosedLoop(
            1e16,
            0.75e18,
            true,
            500,
            FeeCurve.CoverageInput({
                feeRevenueWad: revenueSeed,
                estimatedLossWad: lossSeed,
                meetsMinimumEpochNotional: meetsMinimumEpochNotional
            }),
            config
        );

        assertGe(result.nextFeePips, config.minimumFeePips);
        assertLe(result.nextFeePips, config.maximumFeePips);
        assertLe(result.premiumPips, config.maximumFeePips - config.baseFeePips);
        if (!meetsMinimumEpochNotional || lossSeed < config.minimumEstimatedLossWad) {
            assertFalse(result.coverageEligible);
            assertEq(result.coverageDeficitWad, 0);
        }
    }
}
