// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {ThetaShieldHook} from "../../src/hook/ThetaShieldHook.sol";
import {IThetaShieldController} from "../../src/interfaces/IThetaShieldController.sol";
import {HookMiner} from "../utils/HookMiner.sol";

contract ThetaShieldHookGasTest is Deployers {
    address private constant CALLBACK_PROXY = address(0xCA11BAC);
    address private constant RVM_ID = address(0xBEEF);

    ThetaShieldController private controller;
    ThetaShieldHook private hook;
    bytes32 private poolId;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        controller = new ThetaShieldController(address(this), CALLBACK_PROXY, RVM_ID);
        uint160 flags = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        (address expectedAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(ThetaShieldHook).creationCode,
            abi.encode(manager, IThetaShieldController(address(controller)))
        );
        hook = new ThetaShieldHook{salt: salt}(manager, IThetaShieldController(address(controller)));
        assertEq(address(hook), expectedAddress);

        PoolId typedPoolId;
        (key, typedPoolId) = initPoolAndAddLiquidity(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1
        );
        poolId = PoolId.unwrap(typedPoolId);
        controller.configurePool(poolId, _controllerConfig());
    }

    function test_measureHookOperationGas() external {
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1e15, sqrtPriceLimitX96: MIN_PRICE_LIMIT});
        BalanceDelta delta = toBalanceDelta(-1e15, int128(999e12));

        vm.startSnapshotGas("phase5_before_swap");
        vm.prank(address(manager));
        hook.beforeSwap(address(this), key, params, ZERO_BYTES);
        uint256 beforeSwapGas = vm.stopSnapshotGas("phase5_before_swap");

        vm.prank(address(manager));
        hook.afterSwap(address(this), key, params, delta, ZERO_BYTES);

        vm.startSnapshotGas("phase5_after_swap_warm");
        vm.prank(address(manager));
        hook.afterSwap(address(this), key, params, delta, ZERO_BYTES);
        uint256 afterSwapWarmGas = vm.stopSnapshotGas("phase5_after_swap_warm");

        emit log_named_uint("PHASE5_BEFORE_SWAP_GAS", beforeSwapGas);
        emit log_named_uint("PHASE5_AFTER_SWAP_WARM_GAS", afterSwapWarmGas);
        emit log_named_uint("PHASE5_HOOK_GAS_PER_SWAP", beforeSwapGas + afterSwapWarmGas);

        assertGt(beforeSwapGas, 0);
        assertGt(afterSwapWarmGas, 0);
        assertLt(beforeSwapGas, 100_000);
        assertLt(afterSwapWarmGas, 150_000);
    }

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 300,
            minimumRecommendationInterval: 0,
            paused: false
        });
    }
}
