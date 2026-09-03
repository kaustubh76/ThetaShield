// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldHook} from "../hook/ThetaShieldHook.sol";
import {IThetaShieldController} from "../interfaces/IThetaShieldController.sol";
import {IThetaShieldCircleTransport} from "../interfaces/IThetaShieldCircleTransport.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

/// @title ThetaShieldHookFactory
/// @notice Owner-gated CREATE2 deployer for deterministic Uniswap v4 hook addresses.
contract ThetaShieldHookFactory {
    address public immutable owner;

    error NotOwner(address caller);
    error ZeroAddress();
    error UnexpectedHookAddress(address deployed, address expected);

    event HookDeployed(address indexed hook, address indexed poolManager, address indexed controller, bytes32 salt);

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    function deploy(
        bytes32 salt,
        IPoolManager poolManager,
        IThetaShieldController controller,
        IThetaShieldCircleTransport circleTransport,
        address expectedAddress
    ) external returns (ThetaShieldHook hook) {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (
            address(poolManager) == address(0) || address(controller) == address(0)
                || address(circleTransport) == address(0) || expectedAddress == address(0)
        ) {
            revert ZeroAddress();
        }

        hook = new ThetaShieldHook{salt: salt}(poolManager, controller, circleTransport);
        if (address(hook) != expectedAddress) revert UnexpectedHookAddress(address(hook), expectedAddress);
        emit HookDeployed(address(hook), address(poolManager), address(controller), salt);
    }

    function predict(
        bytes32 salt,
        IPoolManager poolManager,
        IThetaShieldController controller,
        IThetaShieldCircleTransport circleTransport
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(ThetaShieldHook).creationCode, abi.encode(poolManager, controller, circleTransport))
        );
        bytes32 addressHash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash));
        return address(uint160(uint256(addressHash)));
    }
}
