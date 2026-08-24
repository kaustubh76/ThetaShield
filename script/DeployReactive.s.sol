// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {FeeCurve} from "../src/libraries/FeeCurve.sol";
import {ThetaShieldReactive} from "../src/reactive/ThetaShieldReactive.sol";

/// @title DeployReactive
/// @notice Broadcast-capable Phase 8 Lasna deployment using the labeled testnet demo profile.
contract DeployReactive is Script {
    bytes32 public constant DEMO_PROFILE_ID = keccak256("THETASHIELD_PHASE8_SINGLE_SOURCE_TESTNET_DEMO_V1");

    error CallbackGasLimitTooLarge(uint256 supplied);

    event ReactiveDeploymentComplete(
        address indexed reactiveContract,
        bytes32 indexed poolId,
        bytes32 indexed marketId,
        bytes32 preflightFingerprint,
        bytes32 profileId,
        uint256 initialFundingWei
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        ThetaShieldReactive.NetworkConfig memory network = _networkConfig();
        uint256 initialFunding = vm.envUint("REACTIVE_INITIAL_FUNDING_WEI");

        bytes32 fingerprint = DeploymentValidation.validateReactive(
            DeploymentValidation.ReactiveConfig({
                expectedChainId: network.reactiveChainId,
                originChainId: network.originChainId,
                referenceChainId: network.referenceChainId,
                systemContract: vm.envAddress("REACTIVE_SYSTEM_CONTRACT"),
                expectedSystemCodeHash: vm.envBytes32("REACTIVE_SYSTEM_CODEHASH"),
                hook: network.hook,
                referenceFeed: network.referenceFeed,
                controller: network.controller,
                poolId: network.poolId,
                marketId: network.marketId,
                cronTopic: network.cronTopic,
                callbackGasLimit: network.callbackGasLimit
            }),
            block.chainid
        );

        bytes32[] memory sources = new bytes32[](1);
        sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID");

        vm.startBroadcast(deployer);
        ThetaShieldReactive reactiveContract = new ThetaShieldReactive{value: initialFunding}(
            network, _tokenConfig(), _schedulerConfig(), _feeCurveConfig(), sources
        );
        vm.stopBroadcast();

        emit ReactiveDeploymentComplete(
            address(reactiveContract), network.poolId, network.marketId, fingerprint, DEMO_PROFILE_ID, initialFunding
        );
    }

    function _networkConfig() private view returns (ThetaShieldReactive.NetworkConfig memory) {
        uint256 callbackGasLimit = vm.envUint("REACTIVE_CALLBACK_GAS_LIMIT");
        if (callbackGasLimit > type(uint64).max) revert CallbackGasLimitTooLarge(callbackGasLimit);
        return ThetaShieldReactive.NetworkConfig({
            originChainId: vm.envUint("ORIGIN_CHAIN_ID"),
            referenceChainId: vm.envUint("REFERENCE_CHAIN_ID"),
            reactiveChainId: vm.envUint("REACTIVE_CHAIN_ID"),
            hook: vm.envAddress("THETASHIELD_HOOK"),
            referenceFeed: vm.envAddress("REFERENCE_FEED"),
            controller: vm.envAddress("THETASHIELD_CONTROLLER"),
            poolId: vm.envBytes32("THETASHIELD_POOL_ID"),
            marketId: vm.envBytes32("REFERENCE_MARKET_ID"),
            cronTopic: vm.envUint("REACTIVE_CRON_TOPIC_1"),
            // The explicit bound above proves this conversion is exact.
            // forge-lint: disable-next-line(unsafe-typecast)
            callbackGasLimit: uint64(callbackGasLimit)
        });
    }

    function _tokenConfig() private pure returns (ThetaShieldReactive.TokenConfig memory) {
        return ThetaShieldReactive.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true});
    }

    function _schedulerConfig() private pure returns (ThetaShieldReactive.SchedulerConfig memory) {
        return ThetaShieldReactive.SchedulerConfig({
            markoutHorizon: 60,
            observationLifetime: 120,
            referenceSelectionWindow: 10,
            epochDuration: 30,
            recommendationLifetime: 180,
            callbackClockSkew: 5,
            maximumEventFutureSkew: 5,
            maximumPendingObservations: 8,
            maximumProcessPerCron: 8,
            maximumEpochObservations: 8,
            trailingWindow: 8,
            minimumTrailingObservations: 1,
            targetObservationCount: 1,
            requiredToxicEpochs: 1,
            persistenceWindow: 1,
            fastPathHoldEpochs: 0,
            maximumReferenceSamplesPerSource: 4,
            minimumReferenceSources: 1,
            fastPathEnabled: false,
            minimumObservationNotionalWad: 1,
            maximumTradeNotionalWad: 100e18,
            minimumEpochNotionalWad: 1,
            coldStartSigmaWad: 0,
            deadBandKWad: 0,
            maximumDispersionWad: 0.05e18,
            confidenceCapWad: 0.6e18,
            toxicThresholdWad: 0.001e18,
            alphaWad: 1e18,
            fastPathConfidenceFloorWad: 0,
            fastPathToxicThresholdWad: 0
        });
    }

    function _feeCurveConfig() private pure returns (FeeCurve.Config memory) {
        return FeeCurve.Config({
            baseFeePips: 500,
            minimumFeePips: 500,
            maximumFeePips: 10_000,
            gainFeePips: 100_000,
            maximumIncreasePips: 2_000,
            maximumDecreasePips: 2_000,
            confidenceFloorWad: 0.5e18
        });
    }
}
