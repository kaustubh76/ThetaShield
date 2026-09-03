// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {IMessageTransmitterV2} from "../src/interfaces/IMessageTransmitterV2.sol";

/// @title RelayCircleMessage
/// @notice Permissionless delivery of a Circle-attested message on its destination chain.
contract RelayCircleMessage is Script {
    error CircleDeliveryFailed();

    event CircleMessageRelayed(address indexed transmitter, bytes32 indexed messageHash);

    function run() external {
        address relayer = vm.envAddress("DEPLOYER_ADDRESS");
        IMessageTransmitterV2 transmitter =
            IMessageTransmitterV2(vm.envAddress("DESTINATION_CIRCLE_MESSAGE_TRANSMITTER"));
        DeploymentValidation.requireCode(address(transmitter));
        bytes memory message = vm.envBytes("CIRCLE_MESSAGE");
        bytes memory attestation = vm.envBytes("CIRCLE_ATTESTATION");
        vm.startBroadcast(relayer);
        bool success = transmitter.receiveMessage(message, attestation);
        vm.stopBroadcast();
        if (!success) revert CircleDeliveryFailed();
        emit CircleMessageRelayed(address(transmitter), keccak256(message));
    }
}
