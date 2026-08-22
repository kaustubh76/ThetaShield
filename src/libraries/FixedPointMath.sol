// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";

/// @title FixedPointMath
/// @notice Full-precision unsigned and signed helpers used by ThetaShield math.
/// @dev Signed division rounds toward zero. Unsigned division rounds down unless
///      the function name explicitly says otherwise.
library FixedPointMath {
    error DivisionByZero();
    error MulDivOverflow();
    error SignedOverflow();
    error InvalidClampBounds();

    /// @notice Multiplies `x` and `y`, then divides by `denominator` with full precision.
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        if (denominator == 0) revert DivisionByZero();

        unchecked {
            uint256 productLow;
            uint256 productHigh;
            assembly ("memory-safe") {
                let mm := mulmod(x, y, not(0))
                productLow := mul(x, y)
                productHigh := sub(sub(mm, productLow), lt(mm, productLow))
            }

            if (productHigh == 0) return productLow / denominator;
            if (denominator <= productHigh) revert MulDivOverflow();

            uint256 remainder;
            assembly ("memory-safe") {
                remainder := mulmod(x, y, denominator)
                productHigh := sub(productHigh, gt(remainder, productLow))
                productLow := sub(productLow, remainder)
            }

            uint256 powerOfTwo = denominator & (~denominator + 1);
            assembly ("memory-safe") {
                denominator := div(denominator, powerOfTwo)
                productLow := div(productLow, powerOfTwo)
                powerOfTwo := add(div(sub(0, powerOfTwo), powerOfTwo), 1)
            }

            productLow |= productHigh * powerOfTwo;

            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;

            result = productLow * inverse;
        }
    }

    /// @notice Full-precision multiplication and division rounded up.
    function mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        result = mulDivDown(x, y, denominator);
        if (mulmod(x, y, denominator) != 0) {
            if (result == type(uint256).max) revert MulDivOverflow();
            unchecked {
                ++result;
            }
        }
    }

    /// @notice Signed multiplication and unsigned division rounded toward zero.
    function mulDivSigned(int256 x, int256 y, uint256 denominator) internal pure returns (int256 result) {
        if (denominator == 0) revert DivisionByZero();

        bool negative = (x < 0) != (y < 0);
        uint256 magnitude = mulDivDown(abs(x), abs(y), denominator);
        uint256 signedLimit = uint256(type(int256).max) + (negative ? 1 : 0);
        if (magnitude > signedLimit) revert SignedOverflow();

        // Casting is safe because magnitude was checked against the positive signed limit.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (!negative) return int256(magnitude);
        if (magnitude == uint256(type(int256).max) + 1) return type(int256).min;
        // Casting is safe because the negative signed limit was checked above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return -int256(magnitude);
    }

    /// @notice Multiplies two WAD-scaled unsigned values, rounding down.
    function mulWadDown(uint256 xWad, uint256 yWad) internal pure returns (uint256) {
        return mulDivDown(xWad, yWad, ThetaShieldUnits.WAD);
    }

    /// @notice Returns the absolute magnitude of a signed integer.
    function abs(int256 value) internal pure returns (uint256 magnitude) {
        unchecked {
            // Non-negative values are representable as uint256 without truncation.
            // forge-lint: disable-next-line(unsafe-typecast)
            return value < 0 ? uint256(-(value + 1)) + 1 : uint256(value);
        }
    }

    /// @notice Safely converts an unsigned integer to a signed integer.
    function toInt256(uint256 value) internal pure returns (int256) {
        if (value > uint256(type(int256).max)) revert SignedOverflow();
        // The explicit upper-bound check makes this conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(value);
    }

    /// @notice Clamps an unsigned value to an inclusive range.
    function clamp(uint256 value, uint256 minimum, uint256 maximum) internal pure returns (uint256) {
        if (minimum > maximum) revert InvalidClampBounds();
        if (value < minimum) return minimum;
        if (value > maximum) return maximum;
        return value;
    }

    /// @notice Returns the floor of the square root of `value`.
    function sqrt(uint256 value) internal pure returns (uint256 result) {
        if (value == 0) return 0;

        uint256 estimate = 2 ** (_log2(value) >> 1);
        unchecked {
            estimate = (estimate + value / estimate) >> 1;
            estimate = (estimate + value / estimate) >> 1;
            estimate = (estimate + value / estimate) >> 1;
            estimate = (estimate + value / estimate) >> 1;
            estimate = (estimate + value / estimate) >> 1;
            estimate = (estimate + value / estimate) >> 1;
            estimate = (estimate + value / estimate) >> 1;
            result = estimate < value / estimate ? estimate : value / estimate;
        }
    }

    function _log2(uint256 value) private pure returns (uint256 result) {
        unchecked {
            if (value >> 128 > 0) {
                value >>= 128;
                result += 128;
            }
            if (value >> 64 > 0) {
                value >>= 64;
                result += 64;
            }
            if (value >> 32 > 0) {
                value >>= 32;
                result += 32;
            }
            if (value >> 16 > 0) {
                value >>= 16;
                result += 16;
            }
            if (value >> 8 > 0) {
                value >>= 8;
                result += 8;
            }
            if (value >> 4 > 0) {
                value >>= 4;
                result += 4;
            }
            if (value >> 2 > 0) {
                value >>= 2;
                result += 2;
            }
            if (value >> 1 > 0) result += 1;
        }
    }
}
