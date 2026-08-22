// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @title PersistenceWindow
/// @notice Maintains a bounded n-of-k toxicity history in a bitmap.
library PersistenceWindow {
    error InvalidWindow(uint16 requiredToxicEpochs, uint16 windowLength);

    /// @notice Pushes the newest epoch into bit zero and discards epochs older than k.
    function push(uint256 bitmap, bool toxic, uint16 windowLength) internal pure returns (uint256 updatedBitmap) {
        _validateWindow(1, windowLength);
        uint256 mask = _mask(windowLength);
        updatedBitmap = ((bitmap << 1) | (toxic ? 1 : 0)) & mask;
    }

    /// @notice Returns true when at least n of the most recent k epochs are toxic.
    function isActive(uint256 bitmap, uint16 requiredToxicEpochs, uint16 windowLength) internal pure returns (bool) {
        _validateWindow(requiredToxicEpochs, windowLength);
        return count(bitmap & _mask(windowLength)) >= requiredToxicEpochs;
    }

    /// @notice Counts set bits using Kernighan's bounded popcount algorithm.
    function count(uint256 bitmap) internal pure returns (uint16 setBits) {
        while (bitmap != 0) {
            bitmap &= bitmap - 1;
            ++setBits;
        }
    }

    function _validateWindow(uint16 requiredToxicEpochs, uint16 windowLength) private pure {
        if (windowLength == 0 || requiredToxicEpochs == 0 || requiredToxicEpochs > windowLength) {
            revert InvalidWindow(requiredToxicEpochs, windowLength);
        }
    }

    function _mask(uint16 windowLength) private pure returns (uint256) {
        return windowLength == 256 ? type(uint256).max : (uint256(1) << windowLength) - 1;
    }
}
