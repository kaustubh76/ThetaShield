// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.26;

/// @notice Minimal Circle CCTP V2 message-sending surface used by ThetaShield.
/// @dev Matches Circle's IMessageTransmitterV2.sendMessage interface.
interface IMessageTransmitterV2 {
    function sendMessage(
        uint32 destinationDomain,
        bytes32 recipient,
        bytes32 destinationCaller,
        uint32 minFinalityThreshold,
        bytes calldata messageBody
    ) external;
}
