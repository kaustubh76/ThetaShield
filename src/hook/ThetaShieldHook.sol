// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldBaseHook} from "./ThetaShieldBaseHook.sol";
import {CircleMessages} from "../circle/CircleMessages.sol";
import {IThetaShieldController} from "../interfaces/IThetaShieldController.sol";
import {IThetaShieldCircleTransport} from "../interfaces/IThetaShieldCircleTransport.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title ThetaShieldHook
/// @notice Applies bounded directional fees and emits observations for delayed scoring.
contract ThetaShieldHook is ThetaShieldBaseHook {
    using BalanceDeltaLibrary for BalanceDelta;
    using LPFeeLibrary for uint24;
    using StateLibrary for IPoolManager;

    IThetaShieldController public immutable controller;
    IThetaShieldCircleTransport public immutable circleTransport;
    mapping(bytes32 poolId => uint64 count) public observationCount;

    error ZeroController();
    error ZeroCircleTransport();
    error StaticFeePoolNotSupported();
    error ObservationSequenceOverflow(bytes32 poolId);

    event SwapObserved(
        bytes32 indexed poolId,
        uint64 indexed observationId,
        bool indexed zeroForOne,
        int128 amount0,
        int128 amount1,
        uint160 sqrtPriceX96After,
        uint24 appliedFeePips,
        bool usedBaseline,
        uint64 observedAt
    );
    event ObservationTransportFailed(bytes32 indexed poolId, uint64 indexed observationId, bytes reason);

    constructor(
        IPoolManager poolManager_,
        IThetaShieldController controller_,
        IThetaShieldCircleTransport circleTransport_
    ) ThetaShieldBaseHook(poolManager_) {
        if (address(controller_) == address(0)) revert ZeroController();
        if (address(circleTransport_) == address(0)) revert ZeroCircleTransport();
        controller = controller_;
        circleTransport = circleTransport_;
    }

    /// @inheritdoc ThetaShieldBaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    /// @inheritdoc ThetaShieldBaseHook
    function _beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireDynamicFeePool(key);
        bytes32 poolId = PoolId.unwrap(key.toId());
        (uint24 feePips,) = controller.feeForSwap(poolId, params.zeroForOne);

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feePips | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @inheritdoc ThetaShieldBaseHook
    function _afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        _requireDynamicFeePool(key);
        _recordObservation(key, params.zeroForOne, delta);
        return (IHooks.afterSwap.selector, 0);
    }

    function _recordObservation(PoolKey calldata key, bool zeroForOne, BalanceDelta delta) private {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        if (amount0 == 0 || amount1 == 0) return;

        PoolId typedPoolId = key.toId();
        bytes32 poolId = PoolId.unwrap(typedPoolId);
        uint64 previousCount = observationCount[poolId];
        if (previousCount == type(uint64).max) revert ObservationSequenceOverflow(poolId);
        uint64 observationId = previousCount + 1;
        observationCount[poolId] = observationId;

        (uint160 sqrtPriceX96After,,,) = poolManager.getSlot0(typedPoolId);
        (uint24 appliedFeePips, bool usedBaseline) = controller.feeForSwap(poolId, zeroForOne);
        // A block timestamp cannot realistically approach the uint64 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 observedAt = uint64(block.timestamp);

        emit SwapObserved(
            poolId,
            observationId,
            zeroForOne,
            amount0,
            amount1,
            sqrtPriceX96After,
            appliedFeePips,
            usedBaseline,
            observedAt
        );

        CircleMessages.Observation memory observation = CircleMessages.Observation({
            poolId: poolId,
            observationId: observationId,
            zeroForOne: zeroForOne,
            amount0: amount0,
            amount1: amount1,
            sqrtPriceX96After: sqrtPriceX96After,
            appliedFeePips: appliedFeePips,
            usedBaseline: usedBaseline,
            observedAt: observedAt
        });
        // Circle availability must never make the PoolManager's swap fail. The
        // observation event remains available for monitoring and recovery.
        try circleTransport.sendObservation(observation) {}
        catch (bytes memory reason) {
            emit ObservationTransportFailed(poolId, observationId, reason);
        }
    }

    function _requireDynamicFeePool(PoolKey calldata key) private pure {
        if (!key.fee.isDynamicFee()) revert StaticFeePoolNotSupported();
    }
}
