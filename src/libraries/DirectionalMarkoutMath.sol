// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title DirectionalMarkoutMath
/// @notice Calculates delayed signed markout as a directional risk signal.
library DirectionalMarkoutMath {
    error InvalidTradeDirection(int8 direction);
    error ZeroExecutionPrice();

    /// @notice Computes d * (reference - execution) / execution in WAD units.
    /// @param executionPriceWad Average execution price in quote per base, scaled by 1e18.
    /// @param referencePriceWad Delayed normalized reference price, scaled by 1e18.
    /// @param direction +1 when the trader buys base and -1 when the trader sells base.
    /// @return markoutWad Signed directional markout scaled by 1e18, rounded toward zero.
    function calculate(uint256 executionPriceWad, uint256 referencePriceWad, int8 direction)
        internal
        pure
        returns (int256 markoutWad)
    {
        if (executionPriceWad == 0) revert ZeroExecutionPrice();
        if (direction != 1 && direction != -1) revert InvalidTradeDirection(direction);

        bool referenceIsHigher = referencePriceWad >= executionPriceWad;
        uint256 priceDifference =
            referenceIsHigher ? referencePriceWad - executionPriceWad : executionPriceWad - referencePriceWad;
        uint256 magnitude = FixedPointMath.mulDivDown(priceDifference, ThetaShieldUnits.WAD, executionPriceWad);
        int256 signedDifference =
            referenceIsHigher ? FixedPointMath.toInt256(magnitude) : -FixedPointMath.toInt256(magnitude);

        return direction == 1 ? signedDifference : -signedDifference;
    }
}
