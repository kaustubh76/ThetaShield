// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/// @notice Minimal Circle CCTP V2 recipient interface used by ThetaShield.
/// @dev Matches Circle's IMessageHandlerV2 interface.
interface IMessageHandlerV2 {
    function handleReceiveFinalizedMessage(
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool);

    function handleReceiveUnfinalizedMessage(
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool);
}
