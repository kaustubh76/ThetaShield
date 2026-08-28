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
    SentMessage[] private _sentMessages;
    uint32 public localDomain;
    uint256 public sentCount;
    bool public sendsRevert;

    error MockSendFailure();

    function setLocalDomain(uint32 value) external {
        localDomain = value;
    }

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
        SentMessage memory sent = SentMessage({
            sender: msg.sender,
            destinationDomain: destinationDomain,
            recipient: recipient,
            destinationCaller: destinationCaller,
            minFinalityThreshold: minFinalityThreshold,
            messageBody: messageBody
        });
        _lastMessage = sent;
        _sentMessages.push(sent);
        ++sentCount;
    }

    function receiveMessage(bytes calldata, bytes calldata) external pure returns (bool success) {
        return true;
    }

    function lastMessage() external view returns (SentMessage memory message) {
        return _lastMessage;
    }

    function sentMessage(uint256 index) external view returns (SentMessage memory message) {
        return _sentMessages[index];
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
