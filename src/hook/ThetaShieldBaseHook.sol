// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title ThetaShieldBaseHook
/// @notice Minimal Uniswap v4 hook dispatcher with permission-bit validation.
/// @dev Adapted from Uniswap's MIT-licensed v4-hooks-public BaseHook to avoid
///      importing unrelated periphery and hook-template dependencies.
abstract contract ThetaShieldBaseHook is IHooks {
    IPoolManager public immutable poolManager;

    error NotPoolManager(address caller);
    error HookNotImplemented();
    error ZeroPoolManager();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager(msg.sender);
        _;
    }

    constructor(IPoolManager poolManager_) {
        if (address(poolManager_) == address(0)) revert ZeroPoolManager();
        poolManager = poolManager_;
        _validateHookAddress(this);
    }

    /// @notice Declares the callbacks encoded in the deployed hook address.
    function getHookPermissions() public pure virtual returns (Hooks.Permissions memory);

    function beforeInitialize(address, PoolKey calldata, uint160)
        external
        virtual
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24)
        external
        virtual
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        virtual
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external virtual override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external virtual override onlyPoolManager returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external virtual override onlyPoolManager returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        return _beforeSwap(sender, key, params, hookData);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, int128) {
        return _afterSwap(sender, key, params, delta, hookData);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        virtual
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        virtual
        override
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) internal virtual returns (bytes4, BeforeSwapDelta, uint24);

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal virtual returns (bytes4, int128);

    /// @dev Virtual to permit test harnesses that etch bytecode to a permissioned address.
    function _validateHookAddress(ThetaShieldBaseHook self) internal pure virtual {
        Hooks.validateHookPermissions(IHooks(address(self)), getHookPermissions());
    }
}
