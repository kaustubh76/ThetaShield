// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeploymentValidation} from "../../src/deployment/DeploymentValidation.sol";
import {MockMessageTransmitterV2} from "../mocks/MockMessageTransmitterV2.sol";

contract DeploymentCodeStub {}

contract DeploymentValidationHarness {
    function validateOrigin(DeploymentValidation.OriginConfig memory config, uint256 actualChainId)
        external
        view
        returns (bytes32)
    {
        return DeploymentValidation.validateOrigin(config, actualChainId);
    }

    function validateProcessor(DeploymentValidation.ProcessorConfig memory config, uint256 actualChainId)
        external
        view
        returns (bytes32)
    {
        return DeploymentValidation.validateProcessor(config, actualChainId);
    }
}

contract DeploymentValidationTest is Test {
    uint256 private constant ORIGIN_CHAIN_ID = 1_301;
    uint256 private constant PROCESSOR_CHAIN_ID = 11_155_111;
    uint32 private constant ORIGIN_DOMAIN = 10;
    uint32 private constant PROCESSOR_DOMAIN = 0;
    bytes32 private constant OWNER_FIELD = "owner";
    bytes32 private constant SWAP_ROUTER_FIELD = "swapRouter";
    bytes32 private constant LIQUIDITY_ROUTER_FIELD = "modifyLiquidityRouter";
    bytes32 private constant POOL_ID_FIELD = "poolId";

    DeploymentCodeStub private poolManager;
    DeploymentCodeStub private swapRouter;
    DeploymentCodeStub private liquidityRouter;
    DeploymentCodeStub private referenceFeed;
    MockMessageTransmitterV2 private originTransmitter;
    MockMessageTransmitterV2 private processorTransmitter;
    DeploymentValidationHarness private harness;

    function setUp() public {
        poolManager = new DeploymentCodeStub();
        swapRouter = new DeploymentCodeStub();
        liquidityRouter = new DeploymentCodeStub();
        referenceFeed = new DeploymentCodeStub();
        originTransmitter = new MockMessageTransmitterV2();
        processorTransmitter = new MockMessageTransmitterV2();
        originTransmitter.setLocalDomain(ORIGIN_DOMAIN);
        processorTransmitter.setLocalDomain(PROCESSOR_DOMAIN);
        harness = new DeploymentValidationHarness();
    }

    function test_validCircleConfigurationsProduceStableDistinctFingerprints() external view {
        bytes32 originFingerprint = harness.validateOrigin(_originConfig(), ORIGIN_CHAIN_ID);
        bytes32 processorFingerprint = harness.validateProcessor(_processorConfig(), PROCESSOR_CHAIN_ID);

        assertNotEq(originFingerprint, bytes32(0));
        assertNotEq(processorFingerprint, bytes32(0));
        assertNotEq(originFingerprint, processorFingerprint);
        assertEq(originFingerprint, harness.validateOrigin(_originConfig(), ORIGIN_CHAIN_ID));
    }

    function test_wrongChainAndMissingInfrastructureCodeFailClosed() external {
        vm.expectRevert(
            abi.encodeWithSelector(DeploymentValidation.WrongChain.selector, ORIGIN_CHAIN_ID + 1, ORIGIN_CHAIN_ID)
        );
        harness.validateOrigin(_originConfig(), ORIGIN_CHAIN_ID + 1);

        DeploymentValidation.OriginConfig memory config = _originConfig();
        config.poolManager = address(0x1234);
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.MissingCode.selector, address(0x1234)));
        harness.validateOrigin(config, ORIGIN_CHAIN_ID);
    }

    function test_wrongTransmitterAndWrongDomainFailClosed() external {
        DeploymentValidation.OriginConfig memory config = _originConfig();
        config.expectedMessageTransmitter = address(processorTransmitter);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeploymentValidation.InvalidCircleMessageTransmitter.selector,
                address(originTransmitter),
                address(processorTransmitter)
            )
        );
        harness.validateOrigin(config, ORIGIN_CHAIN_ID);

        config = _originConfig();
        config.expectedCircleDomain = 9;
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.CircleDomainMismatch.selector, ORIGIN_DOMAIN, 9));
        harness.validateOrigin(config, ORIGIN_CHAIN_ID);
    }

    function test_localAndRemoteDomainMatchFailsClosed() external {
        DeploymentValidation.ProcessorConfig memory config = _processorConfig();
        config.originDomain = PROCESSOR_DOMAIN;
        vm.expectRevert(
            abi.encodeWithSelector(DeploymentValidation.LocalAndRemoteCircleDomainMatch.selector, PROCESSOR_DOMAIN)
        );
        harness.validateProcessor(config, PROCESSOR_CHAIN_ID);

        config = _processorConfig();
        config.controllerDomain = PROCESSOR_DOMAIN;
        vm.expectRevert(
            abi.encodeWithSelector(DeploymentValidation.LocalAndRemoteCircleDomainMatch.selector, PROCESSOR_DOMAIN)
        );
        harness.validateProcessor(config, PROCESSOR_CHAIN_ID);
    }

    function test_zeroAndDuplicateAddressesFailClosed() external {
        DeploymentValidation.OriginConfig memory origin = _originConfig();
        origin.owner = address(0);
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.ZeroAddress.selector, OWNER_FIELD));
        harness.validateOrigin(origin, ORIGIN_CHAIN_ID);

        origin = _originConfig();
        origin.swapRouter = origin.modifyLiquidityRouter;
        vm.expectRevert(
            abi.encodeWithSelector(
                DeploymentValidation.DuplicateAddress.selector, SWAP_ROUTER_FIELD, LIQUIDITY_ROUTER_FIELD
            )
        );
        harness.validateOrigin(origin, ORIGIN_CHAIN_ID);

        DeploymentValidation.ProcessorConfig memory processor = _processorConfig();
        processor.poolId = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.InvalidIdentifier.selector, POOL_ID_FIELD));
        harness.validateProcessor(processor, PROCESSOR_CHAIN_ID);
    }

    function _originConfig() private view returns (DeploymentValidation.OriginConfig memory) {
        return DeploymentValidation.OriginConfig({
            expectedChainId: ORIGIN_CHAIN_ID,
            expectedCircleDomain: ORIGIN_DOMAIN,
            poolManager: address(poolManager),
            messageTransmitter: address(originTransmitter),
            expectedMessageTransmitter: address(originTransmitter),
            swapRouter: address(swapRouter),
            modifyLiquidityRouter: address(liquidityRouter),
            owner: address(0xA11CE),
            deployer: address(0xD3E10)
        });
    }

    function _processorConfig() private view returns (DeploymentValidation.ProcessorConfig memory) {
        return DeploymentValidation.ProcessorConfig({
            expectedChainId: PROCESSOR_CHAIN_ID,
            expectedCircleDomain: PROCESSOR_DOMAIN,
            messageTransmitter: address(processorTransmitter),
            expectedMessageTransmitter: address(processorTransmitter),
            referenceFeed: address(referenceFeed),
            originDomain: ORIGIN_DOMAIN,
            originTransport: bytes32(uint256(uint160(address(0x1001)))),
            controllerDomain: ORIGIN_DOMAIN,
            controller: bytes32(uint256(uint160(address(0x1002)))),
            poolId: keccak256("circle-pool"),
            marketId: keccak256("ETH-USD")
        });
    }
}
