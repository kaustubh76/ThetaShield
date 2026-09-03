// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {ThetaShieldCircleTransport} from "../src/circle/ThetaShieldCircleTransport.sol";
import {ThetaShieldController} from "../src/controller/ThetaShieldController.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";

/// @title ConfigureCirclePeers
/// @notice One-time sealing of the origin contracts after both chain deployments exist.
contract ConfigureCirclePeers is Script {
    event CirclePeersSealed(address indexed transport, address indexed controller, address indexed processor);

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address hook = vm.envAddress("THETASHIELD_HOOK");
        address processor = vm.envAddress("THETASHIELD_CIRCLE_PROCESSOR");
        ThetaShieldCircleTransport transport = ThetaShieldCircleTransport(vm.envAddress("THETASHIELD_CIRCLE_TRANSPORT"));
        ThetaShieldController controller = ThetaShieldController(vm.envAddress("THETASHIELD_CONTROLLER"));
        DeploymentValidation.requireCode(address(transport));
        DeploymentValidation.requireCode(address(controller));
        DeploymentValidation.requireCode(hook);

        bytes32 processorPeer = bytes32(uint256(uint160(processor)));
        vm.startBroadcast(deployer);
        transport.configurePeers(hook, processorPeer);
        controller.configureCirclePeer(_uint32Env("PROCESSOR_CIRCLE_DOMAIN"), processorPeer);
        vm.stopBroadcast();

        emit CirclePeersSealed(address(transport), address(controller), processor);
    }

    function _uint32Env(string memory name) private view returns (uint32 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint32).max, "Circle domain does not fit uint32");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(supplied);
    }
}
