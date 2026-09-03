// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title CircleMessages
/// @notice Versioned, fixed-size application messages carried by Circle CCTP V2.
library CircleMessages {
    bytes32 internal constant SCHEMA = keccak256("ThetaShield.CircleMessages.v1");
    uint8 internal constant OBSERVATION_KIND = 1;
    uint8 internal constant RECOMMENDATION_KIND = 2;

    uint256 internal constant OBSERVATION_MESSAGE_LENGTH = 352;
    uint256 internal constant RECOMMENDATION_MESSAGE_LENGTH = 352;

    struct Observation {
        bytes32 poolId;
        uint64 observationId;
        bool zeroForOne;
        int128 amount0;
        int128 amount1;
        uint160 sqrtPriceX96After;
        uint24 appliedFeePips;
        bool usedBaseline;
        uint64 observedAt;
    }

    struct Recommendation {
        bytes32 poolId;
        uint24 zeroForOneFee;
        uint24 oneForZeroFee;
        int128 zeroForOneRiskWad;
        int128 oneForZeroRiskWad;
        uint16 confidenceBps;
        uint64 validAfter;
        uint64 validUntil;
        uint64 sequence;
    }

    error InvalidMessageLength(uint256 supplied, uint256 expected);
    error InvalidSchema(bytes32 supplied);
    error InvalidMessageKind(uint8 supplied, uint8 expected);

    function encodeObservation(Observation memory observation) internal pure returns (bytes memory) {
        return abi.encode(SCHEMA, OBSERVATION_KIND, observation);
    }

    function decodeObservation(bytes memory messageBody) internal pure returns (Observation memory observation) {
        if (messageBody.length != OBSERVATION_MESSAGE_LENGTH) {
            revert InvalidMessageLength(messageBody.length, OBSERVATION_MESSAGE_LENGTH);
        }
        (bytes32 schema, uint8 kind, Observation memory decoded) =
            abi.decode(messageBody, (bytes32, uint8, Observation));
        if (schema != SCHEMA) revert InvalidSchema(schema);
        if (kind != OBSERVATION_KIND) revert InvalidMessageKind(kind, OBSERVATION_KIND);
        return decoded;
    }

    function encodeRecommendation(Recommendation memory recommendation) internal pure returns (bytes memory) {
        return abi.encode(SCHEMA, RECOMMENDATION_KIND, recommendation);
    }

    function decodeRecommendation(bytes memory messageBody)
        internal
        pure
        returns (Recommendation memory recommendation)
    {
        if (messageBody.length != RECOMMENDATION_MESSAGE_LENGTH) {
            revert InvalidMessageLength(messageBody.length, RECOMMENDATION_MESSAGE_LENGTH);
        }
        (bytes32 schema, uint8 kind, Recommendation memory decoded) =
            abi.decode(messageBody, (bytes32, uint8, Recommendation));
        if (schema != SCHEMA) revert InvalidSchema(schema);
        if (kind != RECOMMENDATION_KIND) revert InvalidMessageKind(kind, RECOMMENDATION_KIND);
        return decoded;
    }
}
