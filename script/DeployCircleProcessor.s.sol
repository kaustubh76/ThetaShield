// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {ThetaShieldCircleProcessor} from "../src/circle/ThetaShieldCircleProcessor.sol";
import {DeploymentValidation} from "../src/deployment/DeploymentValidation.sol";
import {MockNormalizedReferencePriceFeed} from "../src/feeds/MockNormalizedReferencePriceFeed.sol";
import {FeeCurve} from "../src/libraries/FeeCurve.sol";

/// @title DeployCircleProcessor
/// @notice Deploys the Ethereum Sepolia reference feed and Circle processor.
contract DeployCircleProcessor is Script {
    bytes32 public constant DEMO_PROFILE_ID = keccak256("THETASHIELD_CIRCLE_SINGLE_SOURCE_TESTNET_DEMO_V1");

    error InitialOwnerMustBeDeployer(address owner, address deployer);

    event CircleProcessorDeploymentComplete(
        address indexed processor,
        address indexed referenceFeed,
        bytes32 indexed poolId,
        bytes32 marketId,
        bytes32 preflightFingerprint,
        bytes32 profileId
    );

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("THETASHIELD_OWNER");
        if (owner != deployer) revert InitialOwnerMustBeDeployer(owner, deployer);

        vm.startBroadcast(deployer);
        MockNormalizedReferencePriceFeed feed = new MockNormalizedReferencePriceFeed(owner);
        vm.stopBroadcast();

        ThetaShieldCircleProcessor.NetworkConfig memory network = ThetaShieldCircleProcessor.NetworkConfig({
            messageTransmitter: vm.envAddress("PROCESSOR_CIRCLE_MESSAGE_TRANSMITTER"),
            originDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            originTransport: _addressToBytes32(vm.envAddress("THETASHIELD_CIRCLE_TRANSPORT")),
            referenceFeed: address(feed),
            controllerDomain: _uint32Env("ORIGIN_CIRCLE_DOMAIN"),
            controller: _addressToBytes32(vm.envAddress("THETASHIELD_CONTROLLER")),
            poolId: vm.envBytes32("THETASHIELD_POOL_ID"),
            marketId: vm.envBytes32("REFERENCE_MARKET_ID")
        });
        bytes32 fingerprint = DeploymentValidation.validateProcessor(
            DeploymentValidation.ProcessorConfig({
                expectedChainId: vm.envUint("PROCESSOR_CHAIN_ID"),
                expectedCircleDomain: _uint32Env("PROCESSOR_CIRCLE_DOMAIN"),
                messageTransmitter: network.messageTransmitter,
                expectedMessageTransmitter: vm.envAddress("PROCESSOR_EXPECTED_CIRCLE_MESSAGE_TRANSMITTER"),
                referenceFeed: network.referenceFeed,
                originDomain: network.originDomain,
                originTransport: network.originTransport,
                controllerDomain: network.controllerDomain,
                controller: network.controller,
                poolId: network.poolId,
                marketId: network.marketId
            }),
            block.chainid
        );
        bytes32[] memory sources = new bytes32[](1);
        sources[0] = vm.envBytes32("REFERENCE_SOURCE_ID");

        vm.startBroadcast(deployer);
        ThetaShieldCircleProcessor processor =
            new ThetaShieldCircleProcessor(network, _tokenConfig(), _schedulerConfig(), _feeCurveConfig(), sources);
        vm.stopBroadcast();

        emit CircleProcessorDeploymentComplete(
            address(processor), address(feed), network.poolId, network.marketId, fingerprint, DEMO_PROFILE_ID
        );
    }

    function _tokenConfig() private pure returns (ThetaShieldCircleProcessor.TokenConfig memory) {
        return ThetaShieldCircleProcessor.TokenConfig({token0Decimals: 18, token1Decimals: 18, baseIsToken0: true});
    }

    function _schedulerConfig() private pure returns (ThetaShieldCircleProcessor.SchedulerConfig memory) {
        return ThetaShieldCircleProcessor.SchedulerConfig({
            markoutHorizon: 60,
            observationLifetime: 7_200,
            referenceSelectionWindow: 3_600,
            epochDuration: 60,
            recommendationLifetime: 3_600,
            callbackClockSkew: 60,
            maximumEventFutureSkew: 30,
            maximumPendingObservations: 8,
            maximumProcessPerCall: 8,
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
            coverageGainFeePips: 50,
            maximumIncreasePips: 2_000,
            maximumDecreasePips: 2_000,
            confidenceFloorWad: 0.5e18,
            targetCoverageWad: 1.25e18,
            minimumEstimatedLossWad: 0.001e18
        });
    }

    function _uint32Env(string memory name) private view returns (uint32 value) {
        uint256 supplied = vm.envUint(name);
        require(supplied <= type(uint32).max, "Circle domain does not fit uint32");
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(supplied);
    }

    function _addressToBytes32(address account) private pure returns (bytes32) {
        return bytes32(uint256(uint160(account)));
    }
}
