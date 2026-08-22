// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @title INormalizedReferencePriceFeed
/// @notice Event surface consumed by the per-pool Reactive scheduler.
interface INormalizedReferencePriceFeed {
    /// @notice Publishes a source-specific price normalized to 1e18 quote per base.
    event ReferencePricePublished(
        bytes32 indexed marketId,
        bytes32 indexed sourceId,
        uint64 indexed sequence,
        uint256 priceWad,
        uint256 confidenceWad,
        uint64 observedAt
    );
}
