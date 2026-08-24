// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IMessageHandlerV2} from "../../src/interfaces/IMessageHandlerV2.sol";
import {IMessageTransmitterV2} from "../../src/interfaces/IMessageTransmitterV2.sol";

contract MockMessageTransmitterV2 is IMessageTransmitterV2 {
    struct SentMessage {
        address sender;
        uint32 destinationDomain;
        bytes32 recipient;
        bytes32 destinationCaller;
        uint32 minFinalityThreshold;
        bytes messageBody;
    }

    SentMessage private _lastMessage;
    uint256 public sentCount;
    bool public sendsRevert;

    error MockSendFailure();

    function setSendsRevert(bool value) external {
        sendsRevert = value;
    }

    function sendMessage(
        uint32 destinationDomain,
        bytes32 recipient,
        bytes32 destinationCaller,
        uint32 minFinalityThreshold,
        bytes calldata messageBody
    ) external {
        if (sendsRevert) revert MockSendFailure();
        _lastMessage = SentMessage({
            sender: msg.sender,
            destinationDomain: destinationDomain,
            recipient: recipient,
            destinationCaller: destinationCaller,
            minFinalityThreshold: minFinalityThreshold,
            messageBody: messageBody
        });
        ++sentCount;
    }

    function lastMessage() external view returns (SentMessage memory message) {
        return _lastMessage;
    }

    function deliverFinalized(
        IMessageHandlerV2 recipient,
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool) {
        return recipient.handleReceiveFinalizedMessage(sourceDomain, sender, finalityThresholdExecuted, messageBody);
    }

    function deliverUnfinalized(
        IMessageHandlerV2 recipient,
        uint32 sourceDomain,
        bytes32 sender,
        uint32 finalityThresholdExecuted,
        bytes calldata messageBody
    ) external returns (bool) {
        return recipient.handleReceiveUnfinalizedMessage(sourceDomain, sender, finalityThresholdExecuted, messageBody);
    }
}
