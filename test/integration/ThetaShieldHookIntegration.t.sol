// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IThetaShieldController} from "../../src/interfaces/IThetaShieldController.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {ThetaShieldBaseHook} from "../../src/hook/ThetaShieldBaseHook.sol";
import {ThetaShieldHook} from "../../src/hook/ThetaShieldHook.sol";
import {HookAddressMiner} from "../../src/deployment/HookAddressMiner.sol";

contract ThetaShieldHookIntegrationTest is Deployers {
    address private constant CALLBACK_PROXY = address(0xCA11BAC);
    address private constant RVM_ID = address(0xBEEF);
    bytes32 private constant POOL_SWAP_TOPIC =
        keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 private constant OBSERVATION_TOPIC =
        keccak256("SwapObserved(bytes32,uint64,bool,int128,int128,uint160,uint24,bool,uint64)");

    ThetaShieldController private controller;
    ThetaShieldHook private hook;
    bytes32 private poolId;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        controller = new ThetaShieldController(address(this), CALLBACK_PROXY, RVM_ID);
        uint160 flags = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        (address expectedAddress, bytes32 salt) = HookAddressMiner.find(
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
        controller.configurePool(poolId, _config());
    }

    function test_localV4PoolExecutesBothDirectionsWithDistinctFees() external {
        _apply(_validRecommendation(1, 180));

        vm.recordLogs();
        swap(key, true, -100_000, ZERO_BYTES);
        Vm.Log[] memory zeroForOneLogs = vm.getRecordedLogs();

        vm.recordLogs();
        swap(key, false, -100_000, ZERO_BYTES);
        Vm.Log[] memory oneForZeroLogs = vm.getRecordedLogs();

        assertEq(_poolSwapFee(zeroForOneLogs), 2_500);
        assertEq(_poolSwapFee(oneForZeroLogs), 900);
        assertEq(_observationFee(zeroForOneLogs), 2_500);
        assertEq(_observationFee(oneForZeroLogs), 900);
        assertEq(hook.observationCount(poolId), 2);
    }

    function test_observationIncludesAmountsPostSwapPriceAndFallbackStatus() external {
        _apply(_validRecommendation(1, 180));

        vm.recordLogs();
        swap(key, true, -100_000, ZERO_BYTES);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        Vm.Log memory observation = _observation(entries);

        assertEq(observation.topics[1], poolId);
        assertEq(uint256(observation.topics[2]), 1);
        assertEq(uint256(observation.topics[3]), 1);
        (
            int128 amount0,
            int128 amount1,
            uint160 sqrtPriceX96After,
            uint24 appliedFeePips,
            bool usedBaseline,
            uint64 observedAt
        ) = abi.decode(observation.data, (int128, int128, uint160, uint24, bool, uint64));

        assertLt(amount0, 0);
        assertGt(amount1, 0);
        assertGt(sqrtPriceX96After, 0);
        assertEq(appliedFeePips, 2_500);
        assertFalse(usedBaseline);
        assertEq(observedAt, block.timestamp);
    }

    function test_staleRecommendationExecutesWithBaselineFee() external {
        ThetaShieldController.FeeRecommendation memory supplied = _validRecommendation(1, 10);
        _apply(supplied);
        vm.warp(supplied.validUntil);

        vm.recordLogs();
        swap(key, true, -100_000, ZERO_BYTES);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        assertEq(_poolSwapFee(entries), 500);
        assertEq(_observationFee(entries), 500);
        assertTrue(_observationUsedBaseline(entries));
    }

    function test_directHookCallFromNonManagerReverts() external {
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100_000, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        vm.expectRevert(abi.encodeWithSelector(ThetaShieldBaseHook.NotPoolManager.selector, address(this)));
        hook.beforeSwap(address(this), key, params, ZERO_BYTES);
    }

    function test_staticFeePoolIsRejectedBeforeControllerLookup() external {
        PoolKey memory staticFeeKey = key;
        staticFeeKey.fee = 3_000;
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100_000, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        vm.prank(address(manager));
        vm.expectRevert(ThetaShieldHook.StaticFeePoolNotSupported.selector);
        hook.beforeSwap(address(this), staticFeeKey, params, ZERO_BYTES);
    }

    function test_hookAddressEncodesOnlyBeforeAndAfterSwapPermissions() external view {
        uint160 expectedFlags = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        assertEq(uint160(address(hook)) & uint160((1 << 14) - 1), expectedFlags);

        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertFalse(permissions.beforeSwapReturnDelta);
        assertFalse(permissions.afterSwapReturnDelta);
    }

    function _poolSwapFee(Vm.Log[] memory entries) private view returns (uint24 feePips) {
        for (uint256 index; index < entries.length; ++index) {
            Vm.Log memory entry = entries[index];
            if (entry.emitter == address(manager) && entry.topics[0] == POOL_SWAP_TOPIC) {
                (,,,,, feePips) = abi.decode(entry.data, (int128, int128, uint160, uint128, int24, uint24));
                return feePips;
            }
        }
        revert("PoolManager Swap event not found");
    }

    function _observationFee(Vm.Log[] memory entries) private view returns (uint24 appliedFeePips) {
        Vm.Log memory entry = _observation(entries);
        (,,, appliedFeePips,,) = abi.decode(entry.data, (int128, int128, uint160, uint24, bool, uint64));
    }

    function _observationUsedBaseline(Vm.Log[] memory entries) private view returns (bool usedBaseline) {
        Vm.Log memory entry = _observation(entries);
        (,,,, usedBaseline,) = abi.decode(entry.data, (int128, int128, uint160, uint24, bool, uint64));
    }

    function _observation(Vm.Log[] memory entries) private view returns (Vm.Log memory) {
        for (uint256 index; index < entries.length; ++index) {
            Vm.Log memory entry = entries[index];
            if (entry.emitter == address(hook) && entry.topics[0] == OBSERVATION_TOPIC) return entry;
        }
        revert("ThetaShield SwapObserved event not found");
    }

    function _apply(ThetaShieldController.FeeRecommendation memory supplied) private {
        vm.prank(CALLBACK_PROXY);
        controller.applyRecommendation(RVM_ID, poolId, supplied);
    }

    function _config() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 6_000,
            maximumRecommendationLifetime: 300,
            minimumRecommendationInterval: 0,
            paused: false
        });
    }

    function _validRecommendation(uint64 sequence, uint64 lifetime)
        private
        view
        returns (ThetaShieldController.FeeRecommendation memory)
    {
        return ThetaShieldController.FeeRecommendation({
            zeroForOneFee: 2_500,
            oneForZeroFee: 900,
            zeroForOneRiskWad: 4e18,
            oneForZeroRiskWad: 2e18,
            confidenceBps: 8_000,
            validAfter: uint64(block.timestamp),
            validUntil: uint64(block.timestamp) + lifetime,
            sequence: sequence
        });
    }
}
