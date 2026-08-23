// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ThetaShieldController} from "../src/controller/ThetaShieldController.sol";
import {HookAddressMiner} from "../src/deployment/HookAddressMiner.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {ThetaShieldHookFactory} from "../src/deployment/ThetaShieldHookFactory.sol";
import {ThetaShieldTestToken} from "../src/demo/ThetaShieldTestToken.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {ThetaShieldHook} from "../src/hook/ThetaShieldHook.sol";
import {IThetaShieldController} from "../src/interfaces/IThetaShieldController.sol";

interface IRouterWithManager {
    function manager() external view returns (IPoolManager);
}

interface ICallbackProxyFunding {
    function depositTo(address beneficiary) external payable;
}

/// @title DeployOrigin
/// @notice Broadcast-capable Phase 8 origin deployment. Simulate first; never broadcast without approval.
contract DeployOrigin is Script {
    using PoolIdLibrary for PoolKey;

    uint160 private constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;
    int24 private constant TICK_SPACING = 60;
    int24 private constant TICK_LOWER = -600;
    int24 private constant TICK_UPPER = 600;

    error InitialOwnerMustBeDeployer(address owner, address deployer);
    error ExpectedRvmIdMustBeDeployer(address expectedRvmId, address deployer);
    error RouterManagerMismatch(address router, address suppliedManager, address routerManager);
    error ValueTooLarge(bytes32 field, uint256 supplied);
    error ApprovalFailed(address token, address spender);

    event OriginDeploymentComplete(
        address indexed controller,
        address indexed hook,
        address indexed referenceFeed,
        address hookFactory,
        address token0,
        address token1,
        bytes32 poolId,
        bytes32 hookSalt,
        bytes32 preflightFingerprint,
        uint256 callbackReserveWei
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("THETASHIELD_OWNER");
        address expectedRvmId = vm.envAddress("EXPECTED_RVM_ID");
        IPoolManager poolManager = IPoolManager(vm.envAddress("ORIGIN_POOL_MANAGER"));
        address callbackProxy = vm.envAddress("ORIGIN_CALLBACK_PROXY");
        address modifyLiquidityRouter = vm.envAddress("ORIGIN_MODIFY_LIQUIDITY_ROUTER");
        address swapRouter = vm.envAddress("ORIGIN_SWAP_ROUTER");
        uint256 tokenSupply = vm.envUint("DEMO_TOKEN_SUPPLY_WEI");
        uint256 initialLiquidity = vm.envUint("DEMO_INITIAL_LIQUIDITY");
        uint256 callbackReserve = vm.envUint("ORIGIN_CALLBACK_RESERVE_WEI");

        if (owner != deployer) revert InitialOwnerMustBeDeployer(owner, deployer);
        if (expectedRvmId != deployer) revert ExpectedRvmIdMustBeDeployer(expectedRvmId, deployer);
        if (initialLiquidity == 0 || initialLiquidity > uint256(uint128(type(int128).max))) {
            revert ValueTooLarge("initialLiquidity", initialLiquidity);
        }

        bytes32 fingerprint = DeploymentValidation.validateOrigin(
            DeploymentValidation.OriginConfig({
                expectedChainId: vm.envUint("ORIGIN_CHAIN_ID"),
                poolManager: address(poolManager),
                callbackProxy: callbackProxy,
                owner: owner,
                deployer: deployer,
                expectedRvmId: expectedRvmId
            }),
            block.chainid
        );
        _validateRouter(modifyLiquidityRouter, poolManager);
        _validateRouter(swapRouter, poolManager);

        vm.startBroadcast(deployer);

        MockNormalizedReferencePriceFeed referenceFeed = new MockNormalizedReferencePriceFeed(owner);
        ThetaShieldTestToken firstToken =
            new ThetaShieldTestToken("ThetaShield Test Alpha", "tsALPHA", deployer, tokenSupply);
        ThetaShieldTestToken secondToken =
            new ThetaShieldTestToken("ThetaShield Test Beta", "tsBETA", deployer, tokenSupply);
        ThetaShieldController controller = new ThetaShieldController(owner, callbackProxy, expectedRvmId);
        ThetaShieldHookFactory factory = new ThetaShieldHookFactory(deployer);

        uint160 flags = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        (address expectedHook, bytes32 salt) = HookAddressMiner.find(
            address(factory),
            flags,
            type(ThetaShieldHook).creationCode,
            abi.encode(poolManager, IThetaShieldController(address(controller)))
        );
        ThetaShieldHook hook =
            factory.deploy(salt, poolManager, IThetaShieldController(address(controller)), expectedHook);

        (ThetaShieldTestToken token0, ThetaShieldTestToken token1) =
            address(firstToken) < address(secondToken) ? (firstToken, secondToken) : (secondToken, firstToken);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        bytes32 poolId = PoolId.unwrap(key.toId());
        poolManager.initialize(key, SQRT_PRICE_1_1);
        controller.configurePool(poolId, _controllerConfig());

        _approve(token0, modifyLiquidityRouter);
        _approve(token1, modifyLiquidityRouter);
        _approve(token0, swapRouter);
        _approve(token1, swapRouter);

        IPoolManager.ModifyLiquidityParams memory liquidityParams = IPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            // The explicit bound above proves this conversion is exact.
            // forge-lint: disable-next-line(unsafe-typecast)
            liquidityDelta: int256(initialLiquidity),
            salt: bytes32(0)
        });
        PoolModifyLiquidityTest(modifyLiquidityRouter).modifyLiquidity(key, liquidityParams, bytes(""));
        if (callbackReserve != 0) {
            ICallbackProxyFunding(callbackProxy).depositTo{value: callbackReserve}(address(controller));
        }

        vm.stopBroadcast();

        emit OriginDeploymentComplete(
            address(controller),
            address(hook),
            address(referenceFeed),
            address(factory),
            address(token0),
            address(token1),
            poolId,
            salt,
            fingerprint,
            callbackReserve
        );
    }

    function _validateRouter(address router, IPoolManager poolManager) private view {
        DeploymentValidation.requireCode(router);
        address routerManager = address(IRouterWithManager(router).manager());
        if (routerManager != address(poolManager)) {
            revert RouterManagerMismatch(router, address(poolManager), routerManager);
        }
    }

    function _approve(ThetaShieldTestToken token, address spender) private {
        if (!token.approve(spender, type(uint256).max)) revert ApprovalFailed(address(token), spender);
    }

    function _controllerConfig() private pure returns (ThetaShieldController.PoolFeeConfig memory) {
        return ThetaShieldController.PoolFeeConfig({
            baselineFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            confidenceFloorBps: 5_000,
            maximumRecommendationLifetime: 300,
            minimumRecommendationInterval: 30,
            paused: false
        });
    }
}
