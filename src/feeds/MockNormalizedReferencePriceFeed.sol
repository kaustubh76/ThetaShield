// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {INormalizedReferencePriceFeed} from "../interfaces/INormalizedReferencePriceFeed.sol";
import {OwnedTwoStep} from "../security/OwnedTwoStep.sol";

/// @title MockNormalizedReferencePriceFeed
/// @notice Owner-published development feed. It is not decentralized or production-safe.
contract MockNormalizedReferencePriceFeed is INormalizedReferencePriceFeed, OwnedTwoStep {
    mapping(bytes32 marketId => mapping(bytes32 sourceId => uint64 sequence)) public latestSequence;
    mapping(bytes32 marketId => mapping(bytes32 sourceId => Reading reading)) private _latestReadings;

    error InvalidMarketOrSource();
    error InvalidPriceOrConfidence();

    constructor(address initialOwner) OwnedTwoStep(initialOwner) {}

    /// @notice Publishes a normalized mock observation for deterministic tests and demos.
    function publish(bytes32 marketId, bytes32 sourceId, uint256 priceWad, uint256 confidenceWad, uint64 observedAt)
        external
        onlyOwner
        returns (uint64 sequence)
    {
        if (marketId == bytes32(0) || sourceId == bytes32(0)) revert InvalidMarketOrSource();
        if (priceWad == 0 || confidenceWad == 0 || confidenceWad > ThetaShieldUnits.WAD) {
            revert InvalidPriceOrConfidence();
        }

        sequence = latestSequence[marketId][sourceId] + 1;
        latestSequence[marketId][sourceId] = sequence;
        _latestReadings[marketId][sourceId] =
            Reading({sequence: sequence, priceWad: priceWad, confidenceWad: confidenceWad, observedAt: observedAt});
        emit ReferencePricePublished(marketId, sourceId, sequence, priceWad, confidenceWad, observedAt);
    }

    /// @inheritdoc INormalizedReferencePriceFeed
    function latestReading(bytes32 marketId, bytes32 sourceId) external view returns (Reading memory reading) {
        return _latestReadings[marketId][sourceId];
    }
}
