// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {DeployOrigin} from "../../script/DeployOrigin.s.sol";
import {Phase8Acceptance} from "../../script/Phase8Acceptance.s.sol";
import {ThetaShieldController} from "../../src/controller/ThetaShieldController.sol";
import {MockNormalizedReferencePriceFeed} from "../../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {ThetaShieldHook} from "../../src/hook/ThetaShieldHook.sol";

contract Phase8OriginForkTest is Test {
    using PoolIdLibrary for PoolKey;

    address private constant DEPLOYER = 0xd1DcAAFf9356d5a42f2eE6F90179C4509386a83f;
    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant CALLBACK_PROXY = 0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA;
    address private constant SWAP_ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;
    address private constant MODIFY_LIQUIDITY_ROUTER = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
    bytes32 private constant MARKET_ID = 0x89bb3034ed6c93af18c31f974e2534634117aed6abe0ac091544668629210722;
    bytes32 private constant SOURCE_ID = 0x223dd42fde9425cb408a23b5e0eda69e583c29a6b759a2d0ca7501d34db9a60a;

    function test_phase8OriginDeploymentAndAcceptanceOnCurrentFork() external {
        string memory rpcUrl = vm.envOr("ORIGIN_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true, "ORIGIN_RPC_URL is not configured; Phase 8 origin fork check skipped");
            return;
        }
        vm.createSelectFork(rpcUrl);
        assertEq(block.chainid, 11_155_111);
        assertGe(DEPLOYER.balance, 0.005 ether);

        uint256 startingNonce = vm.getNonce(DEPLOYER);
        address referenceFeed = vm.computeCreateAddress(DEPLOYER, startingNonce);
        address firstToken = vm.computeCreateAddress(DEPLOYER, startingNonce + 1);
        address secondToken = vm.computeCreateAddress(DEPLOYER, startingNonce + 2);
        address controller = vm.computeCreateAddress(DEPLOYER, startingNonce + 3);

        _setOriginEnvironment();
        vm.recordLogs();
        new DeployOrigin().run();

        address token0 = firstToken < secondToken ? firstToken : secondToken;
        address token1 = firstToken < secondToken ? secondToken : firstToken;
        address hook = _deployedHook(startingNonce);
        bytes32 poolId = PoolId.unwrap(
            PoolKey({
                currency0: Currency.wrap(token0),
                currency1: Currency.wrap(token1),
                fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
                tickSpacing: 60,
                hooks: IHooks(hook)
            }).toId()
        );

        _setAcceptanceEnvironment(referenceFeed, token0, token1, hook, poolId);
        Phase8Acceptance acceptance = new Phase8Acceptance();
        acceptance.runSwap();
        vm.warp(block.timestamp + 60);
        acceptance.runReference();

        assertEq(ThetaShieldHook(hook).observationCount(poolId), 1);
        assertEq(MockNormalizedReferencePriceFeed(referenceFeed).latestSequence(MARKET_ID, SOURCE_ID), 1);
        (uint24 feePips, bool usedBaseline) = ThetaShieldController(controller).feeForSwap(poolId, true);
        assertEq(feePips, 500);
        assertTrue(usedBaseline);
    }

    function _deployedHook(uint256 startingNonce) private view returns (address) {
        address factory = vm.computeCreateAddress(DEPLOYER, startingNonce + 4);
        bytes32 hookDeployedTopic = keccak256("HookDeployed(address,address,address,bytes32)");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 index; index < logs.length; ++index) {
            if (logs[index].emitter == factory && logs[index].topics[0] == hookDeployedTopic) {
                return address(uint160(uint256(logs[index].topics[1])));
            }
        }
        revert("HookDeployed event not found");
    }

    function _setOriginEnvironment() private {
        vm.setEnv("ORIGIN_CHAIN_ID", "11155111");
        vm.setEnv("ORIGIN_POOL_MANAGER", vm.toString(POOL_MANAGER));
        vm.setEnv("ORIGIN_CALLBACK_PROXY", vm.toString(CALLBACK_PROXY));
        vm.setEnv("ORIGIN_SWAP_ROUTER", vm.toString(SWAP_ROUTER));
        vm.setEnv("ORIGIN_MODIFY_LIQUIDITY_ROUTER", vm.toString(MODIFY_LIQUIDITY_ROUTER));
        vm.setEnv("THETASHIELD_OWNER", vm.toString(DEPLOYER));
        vm.setEnv("DEPLOYER_ADDRESS", vm.toString(DEPLOYER));
        vm.setEnv("EXPECTED_RVM_ID", vm.toString(DEPLOYER));
        vm.setEnv("DEMO_TOKEN_SUPPLY_WEI", "100000000000000000000");
        vm.setEnv("DEMO_INITIAL_LIQUIDITY", "1000000000000000000");
        vm.setEnv("ORIGIN_CALLBACK_RESERVE_WEI", "5000000000000000");
    }

    function _setAcceptanceEnvironment(
        address referenceFeed,
        address token0,
        address token1,
        address hook,
        bytes32 poolId
    ) private {
        vm.setEnv("REFERENCE_FEED", vm.toString(referenceFeed));
        vm.setEnv("DEMO_TOKEN0", vm.toString(token0));
        vm.setEnv("DEMO_TOKEN1", vm.toString(token1));
        vm.setEnv("THETASHIELD_HOOK", vm.toString(hook));
        vm.setEnv("THETASHIELD_POOL_ID", vm.toString(poolId));
        vm.setEnv("REFERENCE_MARKET_ID", vm.toString(MARKET_ID));
        vm.setEnv("REFERENCE_SOURCE_ID", vm.toString(SOURCE_ID));
        vm.setEnv("ACCEPTANCE_ZERO_FOR_ONE", "true");
        vm.setEnv("ACCEPTANCE_SWAP_AMOUNT", "-1000000000000000");
        vm.setEnv("ACCEPTANCE_REFERENCE_PRICE_WAD", "990000000000000000");
        vm.setEnv("ACCEPTANCE_REFERENCE_CONFIDENCE_WAD", "1000000000000000000");
    }
}
