// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {HookAddressMiner} from "../../src/deployment/HookAddressMiner.sol";
import {ThetaShieldHookFactory} from "../../src/deployment/ThetaShieldHookFactory.sol";
import {ThetaShieldHook} from "../../src/hook/ThetaShieldHook.sol";
import {IThetaShieldController} from "../../src/interfaces/IThetaShieldController.sol";
import {IThetaShieldCircleTransport} from "../../src/interfaces/IThetaShieldCircleTransport.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";
import {MockThetaShieldCircleTransport} from "../mocks/MockThetaShieldCircleTransport.sol";

contract ThetaShieldHookFactoryTest is Test, Deployers {
    ThetaShieldController private controller;
    ThetaShieldHookFactory private factory;
    MockThetaShieldCircleTransport private transport;

    function setUp() public {
        deployFreshManagerAndRouters();
        controller = new ThetaShieldController(address(this), new MockMessageTransmitterV2());
        transport = new MockThetaShieldCircleTransport();
        factory = new ThetaShieldHookFactory(address(this));
    }

    function test_ownerDeploysExactMinedHook() external {
        (address expectedHook, bytes32 salt) = _mine();
        ThetaShieldHook hook = factory.deploy(
            salt,
            manager,
            IThetaShieldController(address(controller)),
            IThetaShieldCircleTransport(address(transport)),
            expectedHook
        );

        assertEq(address(hook), expectedHook);
        assertEq(address(hook.poolManager()), address(manager));
        assertEq(address(hook.controller()), address(controller));
        assertEq(address(hook.circleTransport()), address(transport));
        assertEq(
            factory.predict(
                salt,
                manager,
                IThetaShieldController(address(controller)),
                IThetaShieldCircleTransport(address(transport))
            ),
            expectedHook
        );
    }

    function test_nonOwnerCannotDeploy() external {
        (address expectedHook, bytes32 salt) = _mine();
        address outsider = address(0xBAD);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(ThetaShieldHookFactory.NotOwner.selector, outsider));
        factory.deploy(
            salt,
            manager,
            IThetaShieldController(address(controller)),
            IThetaShieldCircleTransport(address(transport)),
            expectedHook
        );
    }

    function _mine() private view returns (address expectedHook, bytes32 salt) {
        return HookAddressMiner.find(
            address(factory),
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG,
            type(ThetaShieldHook).creationCode,
            abi.encode(
                IPoolManager(address(manager)),
                IThetaShieldController(address(controller)),
                IThetaShieldCircleTransport(address(transport))
            )
        );
    }
}
