// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {CircleMessages} from "./CircleMessages.sol";
import {IMessageTransmitterV2} from "../interfaces/IMessageTransmitterV2.sol";
import {IThetaShieldCircleTransport} from "../interfaces/IThetaShieldCircleTransport.sol";
import {OwnedTwoStep} from "../security/OwnedTwoStep.sol";

/// @title ThetaShieldCircleTransport
/// @notice Sends hook observations as finalized Circle CCTP V2 messages.
contract ThetaShieldCircleTransport is IThetaShieldCircleTransport, OwnedTwoStep {
    uint32 public constant FINALIZED_THRESHOLD = 2_000;

    IMessageTransmitterV2 public immutable messageTransmitter;
    uint32 public immutable processorDomain;
    address public hook;
    bytes32 public processor;
    bool public peersSealed;

    error InvalidCircleConfiguration();
    error InvalidPeerConfiguration();
    error PeersAlreadySealed();
    error OnlyHook(address caller);
    error PoolMismatch(bytes32 supplied, bytes32 expected);

    event PeersConfigured(address indexed hook, bytes32 indexed processor, uint32 indexed processorDomain);
    event ObservationDispatched(bytes32 indexed poolId, uint64 indexed observationId, bytes32 indexed processor);

    constructor(address initialOwner, IMessageTransmitterV2 messageTransmitter_, uint32 processorDomain_)
        OwnedTwoStep(initialOwner)
    {
        if (address(messageTransmitter_) == address(0)) revert InvalidCircleConfiguration();
        messageTransmitter = messageTransmitter_;
        processorDomain = processorDomain_;
    }

    /// @notice One-time peer configuration after the CREATE2 hook and remote processor exist.
    function configurePeers(address hook_, bytes32 processor_) external onlyOwner {
        if (peersSealed) revert PeersAlreadySealed();
        if (hook_ == address(0) || processor_ == bytes32(0)) revert InvalidPeerConfiguration();
        hook = hook_;
        processor = processor_;
        peersSealed = true;
        emit PeersConfigured(hook_, processor_, processorDomain);
    }

    /// @inheritdoc IThetaShieldCircleTransport
    function sendObservation(CircleMessages.Observation calldata observation) external {
        if (msg.sender != hook) revert OnlyHook(msg.sender);
        bytes32 destination = processor;
        if (!peersSealed || destination == bytes32(0)) revert InvalidPeerConfiguration();

        messageTransmitter.sendMessage(
            processorDomain, destination, bytes32(0), FINALIZED_THRESHOLD, CircleMessages.encodeObservation(observation)
        );
        emit ObservationDispatched(observation.poolId, observation.observationId, destination);
    }
}
