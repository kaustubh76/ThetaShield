// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @title IReferencePriceAdapter
/// @notice Common pull interface for a production feed adapter selected in a later phase.
interface IReferencePriceAdapter {
    struct Reading {
        bytes32 sourceId;
        uint256 priceWad;
        uint256 confidenceWad;
        uint64 observedAt;
    }

    function latestReading(bytes32 marketId) external view returns (Reading memory reading);
}
