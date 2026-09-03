// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title INormalizedReferencePriceFeed
/// @notice Event and pull surface consumed by the per-pool Circle processor.
interface INormalizedReferencePriceFeed {
    struct Reading {
        uint64 sequence;
        uint256 priceWad;
        uint256 confidenceWad;
        uint64 observedAt;
    }

    /// @notice Publishes a source-specific price normalized to 1e18 quote per base.
    event ReferencePricePublished(
        bytes32 indexed marketId,
        bytes32 indexed sourceId,
        uint64 indexed sequence,
        uint256 priceWad,
        uint256 confidenceWad,
        uint64 observedAt
    );

    function latestReading(bytes32 marketId, bytes32 sourceId) external view returns (Reading memory reading);
}
