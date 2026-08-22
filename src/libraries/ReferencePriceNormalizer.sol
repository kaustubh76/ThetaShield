// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title ReferencePriceNormalizer
/// @notice Converts positive decimal-scaled feed answers to ThetaShield WAD prices.
library ReferencePriceNormalizer {
    uint8 internal constant MAX_SUPPORTED_DECIMALS = 36;

    error ZeroPrice();
    error UnsupportedDecimals(uint8 decimals);

    function toWad(uint256 answer, uint8 decimals) internal pure returns (uint256 priceWad) {
        if (answer == 0) revert ZeroPrice();
        if (decimals > MAX_SUPPORTED_DECIMALS) revert UnsupportedDecimals(decimals);

        uint256 scale = 10 ** decimals;
        priceWad = FixedPointMath.mulDivDown(answer, ThetaShieldUnits.WAD, scale);
        if (priceWad == 0) revert ZeroPrice();
    }
}
