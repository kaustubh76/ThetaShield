// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ThetaShieldCircleTransport} from "../src/circle/ThetaShieldCircleTransport.sol";
import {ThetaShieldController} from "../src/controller/ThetaShieldController.sol";
import {HookAddressMiner} from "../src/deployment/HookAddressMiner.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {ThetaShieldHookFactory} from "../src/deployment/ThetaShieldHookFactory.sol";
import {ThetaShieldTestToken} from "../src/demo/ThetaShieldTestToken.sol";
import {ThetaShieldHook} from "../src/hook/ThetaShieldHook.sol";
import {IMessageTransmitterV2} from "../src/interfaces/IMessageTransmitterV2.sol";
import {IThetaShieldCircleTransport} from "../src/interfaces/IThetaShieldCircleTransport.sol";
import {IThetaShieldController} from "../src/interfaces/IThetaShieldController.sol";
import {ThetaShieldProfiles} from "./profiles/ThetaShieldProfiles.sol";

interface IRouterWithManager {
    function manager() external view returns (IPoolManager);
}

/// @title DeployCircleOrigin
/// @notice Deploys the Unichain Sepolia half. Simulate before any approved broadcast.
contract DeployCircleOrigin is Script {
    using PoolIdLibrary for PoolKey;

    uint160 private constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;
    int24 private constant TICK_SPACING = 60;
    int24 private constant TICK_LOWER = -600;
    int24 private constant TICK_UPPER = 600;

    error InitialOwnerMustBeDeployer(address owner, address deployer);
    error RouterManagerMismatch(address router, address suppliedManager, address routerManager);
    error ValueTooLarge(bytes32 field, uint256 supplied);
    error ApprovalFailed(address token, address spender);

    event CircleOriginDeploymentComplete(
        address indexed transport,
        address indexed controller,
        address indexed hook,
        address hookFactory,
        address token0,
        address token1,
        bytes32 poolId,
        bytes32 hookSalt,
        bytes32 preflightFingerprint,
        bytes32 profileId
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("THETASHIELD_OWNER");
        IPoolManager poolManager = IPoolManager(vm.envAddress("ORIGIN_POOL_MANAGER"));
        IMessageTransmitterV2 transmitter = IMessageTransmitterV2(vm.envAddress("ORIGIN_CIRCLE_MESSAGE_TRANSMITTER"));
        address modifyLiquidityRouter = vm.envAddress("ORIGIN_MODIFY_LIQUIDITY_ROUTER");
        address swapRouter = vm.envAddress("ORIGIN_SWAP_ROUTER");
        uint256 tokenSupply = vm.envUint("DEMO_TOKEN_SUPPLY_WEI");
        uint256 initialLiquidity = vm.envUint("DEMO_INITIAL_LIQUIDITY");
        ThetaShieldProfiles.Profile memory profile = _selectedProfile();
        if (owner != deployer) revert InitialOwnerMustBeDeployer(owner, deployer);
        if (initialLiquidity == 0 || initialLiquidity > uint256(uint128(type(int128).max))) {
            revert ValueTooLarge("initialLiquidity", initialLiquidity);
        }

        bytes32 fingerprint = DeploymentValidation.validateOrigin(
            DeploymentValidation.OriginConfig({
                expectedChainId: vm.envUint("ORIGIN_CHAIN_ID"),
                expectedCircleDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
                poolManager: address(poolManager),
                messageTransmitter: address(transmitter),
                expectedMessageTransmitter: vm.envAddress("ORIGIN_EXPECTED_CIRCLE_MESSAGE_TRANSMITTER"),
                swapRouter: swapRouter,
                modifyLiquidityRouter: modifyLiquidityRouter,
                owner: owner,
                deployer: deployer
            }),
            block.chainid
        );
        _validateRouter(modifyLiquidityRouter, poolManager);
        _validateRouter(swapRouter, poolManager);

        vm.startBroadcast(deployer);
        ThetaShieldCircleTransport transport =
            new ThetaShieldCircleTransport(owner, transmitter, _uint32Env("PROCESSOR_CIRCLE_DOMAIN"));
        ThetaShieldController controller = new ThetaShieldController(owner, transmitter);
        ThetaShieldTestToken firstToken =
            new ThetaShieldTestToken("ThetaShield Test Alpha", "tsALPHA", deployer, tokenSupply);
        ThetaShieldTestToken secondToken =
            new ThetaShieldTestToken("ThetaShield Test Beta", "tsBETA", deployer, tokenSupply);
        ThetaShieldHookFactory factory = new ThetaShieldHookFactory(deployer);

        (address expectedHook, bytes32 salt) = HookAddressMiner.find(
            address(factory),
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG,
            type(ThetaShieldHook).creationCode,
            abi.encode(
                poolManager,
                IThetaShieldController(address(controller)),
                IThetaShieldCircleTransport(address(transport))
            )
        );
        ThetaShieldHook hook = factory.deploy(
            salt,
            poolManager,
            IThetaShieldController(address(controller)),
            IThetaShieldCircleTransport(address(transport)),
            expectedHook
        );

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
        controller.configurePool(poolId, profile.controller);

        _approve(token0, modifyLiquidityRouter);
        _approve(token1, modifyLiquidityRouter);
        _approve(token0, swapRouter);
        _approve(token1, swapRouter);
        PoolModifyLiquidityTest(modifyLiquidityRouter)
            .modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                // The explicit bound above proves this conversion is exact.
                // forge-lint: disable-next-line(unsafe-typecast)
                liquidityDelta: int256(initialLiquidity),
                salt: bytes32(0)
            }),
                bytes("")
            );
        vm.stopBroadcast();

        emit CircleOriginDeploymentComplete(
            address(transport),
            address(controller),
            address(hook),
            address(factory),
            address(token0),
            address(token1),
            poolId,
            salt,
            fingerprint,
            profile.id
        );
    }

    function _validateRouter(address router, IPoolManager poolManager) private view {
        address routerManager = address(IRouterWithManager(router).manager());
        if (routerManager != address(poolManager)) {
            revert RouterManagerMismatch(router, address(poolManager), routerManager);
        }
    }

    function _approve(ThetaShieldTestToken token, address spender) private {
        if (!token.approve(spender, type(uint256).max)) revert ApprovalFailed(address(token), spender);
    }

    function _selectedProfile() private view returns (ThetaShieldProfiles.Profile memory profile) {
        string memory name = vm.envOr("THETASHIELD_PROFILE", string("RESEARCH_V1"));
        profile = ThetaShieldProfiles.resolve(name);
        if (profile.id == ThetaShieldProfiles.demoV1().id) {
            console2.log("WARNING: DEMO_V1 disables the researched filtering and persistence defaults");
        }
    }

    function _uint32Env(string memory name) private view returns (uint32 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint32).max, "Circle domain does not fit uint32");
        // The explicit bound above proves this conversion is exact.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(supplied);
    }
}
