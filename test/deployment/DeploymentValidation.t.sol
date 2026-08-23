// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DeploymentValidation} from "../../src/deployment/DeploymentValidation.sol";

contract DeploymentCodeStub {}

contract DeploymentValidationHarness {
    function validateOrigin(DeploymentValidation.OriginConfig memory config, uint256 actualChainId)
        external
        view
        returns (bytes32)
    {
        return DeploymentValidation.validateOrigin(config, actualChainId);
    }

    function validateReactive(DeploymentValidation.ReactiveConfig memory config, uint256 actualChainId)
        external
        view
        returns (bytes32)
    {
        return DeploymentValidation.validateReactive(config, actualChainId);
    }
}

contract DeploymentValidationTest is Test {
    uint256 private constant ORIGIN_CHAIN_ID = 11_155_111;
    uint256 private constant REACTIVE_CHAIN_ID = 5_318_007;
    address private constant REACTIVE_SYSTEM = 0x0000000000000000000000000000000000fffFfF;
    bytes32 private constant POOL_ID_FIELD = "poolId";
    bytes32 private constant OWNER_FIELD = "owner";
    bytes32 private constant POOL_MANAGER_FIELD = "poolManager";
    bytes32 private constant CALLBACK_PROXY_FIELD = "callbackProxy";
    bytes32 private constant HOOK_FIELD = "hook";
    bytes32 private constant REFERENCE_FEED_FIELD = "referenceFeed";

    DeploymentCodeStub private poolManager;
    DeploymentCodeStub private callbackProxy;
    DeploymentValidationHarness private harness;

    function setUp() public {
        poolManager = new DeploymentCodeStub();
        callbackProxy = new DeploymentCodeStub();
        harness = new DeploymentValidationHarness();
        vm.etch(REACTIVE_SYSTEM, hex"00");
    }

    function test_validConfigurationsProduceStableDistinctFingerprints() external view {
        bytes32 originFingerprint = harness.validateOrigin(_originConfig(), ORIGIN_CHAIN_ID);
        bytes32 reactiveFingerprint = harness.validateReactive(_reactiveConfig(), REACTIVE_CHAIN_ID);

        assertNotEq(originFingerprint, bytes32(0));
        assertNotEq(reactiveFingerprint, bytes32(0));
        assertNotEq(originFingerprint, reactiveFingerprint);
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

    function test_wrongReactiveSystemAndMatchingOriginChainFailClosed() external {
        DeploymentValidation.ReactiveConfig memory config = _reactiveConfig();
        config.systemContract = address(callbackProxy);
        vm.expectRevert(
            abi.encodeWithSelector(
                DeploymentValidation.InvalidReactiveSystemContract.selector, address(callbackProxy), REACTIVE_SYSTEM
            )
        );
        harness.validateReactive(config, REACTIVE_CHAIN_ID);

        config = _reactiveConfig();
        config.originChainId = REACTIVE_CHAIN_ID;
        vm.expectRevert(
            abi.encodeWithSelector(DeploymentValidation.ReactiveAndOriginChainMatch.selector, REACTIVE_CHAIN_ID)
        );
        harness.validateReactive(config, REACTIVE_CHAIN_ID);
    }

    function test_zeroIdentifiersAndOversizedCallbackGasFailClosed() external {
        DeploymentValidation.ReactiveConfig memory config = _reactiveConfig();
        config.poolId = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.InvalidIdentifier.selector, POOL_ID_FIELD));
        harness.validateReactive(config, REACTIVE_CHAIN_ID);

        config = _reactiveConfig();
        config.callbackGasLimit = uint256(type(uint64).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                DeploymentValidation.CallbackGasLimitOutOfBounds.selector, uint256(type(uint64).max) + 1
            )
        );
        harness.validateReactive(config, REACTIVE_CHAIN_ID);
    }

    function test_zeroAndDuplicateAddressesFailClosed() external {
        DeploymentValidation.OriginConfig memory origin = _originConfig();
        origin.owner = address(0);
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.ZeroAddress.selector, OWNER_FIELD));
        harness.validateOrigin(origin, ORIGIN_CHAIN_ID);

        origin = _originConfig();
        origin.callbackProxy = origin.poolManager;
        vm.expectRevert(
            abi.encodeWithSelector(
                DeploymentValidation.DuplicateAddress.selector, POOL_MANAGER_FIELD, CALLBACK_PROXY_FIELD
            )
        );
        harness.validateOrigin(origin, ORIGIN_CHAIN_ID);

        DeploymentValidation.ReactiveConfig memory reactive = _reactiveConfig();
        reactive.referenceFeed = reactive.hook;
        vm.expectRevert(
            abi.encodeWithSelector(DeploymentValidation.DuplicateAddress.selector, HOOK_FIELD, REFERENCE_FEED_FIELD)
        );
        harness.validateReactive(reactive, REACTIVE_CHAIN_ID);

        reactive = _reactiveConfig();
        reactive.callbackGasLimit = 0;
        vm.expectRevert(abi.encodeWithSelector(DeploymentValidation.CallbackGasLimitOutOfBounds.selector, uint256(0)));
        harness.validateReactive(reactive, REACTIVE_CHAIN_ID);
    }

    function _originConfig() private view returns (DeploymentValidation.OriginConfig memory) {
        return DeploymentValidation.OriginConfig({
            expectedChainId: ORIGIN_CHAIN_ID,
            poolManager: address(poolManager),
            callbackProxy: address(callbackProxy),
            owner: address(0xA11CE),
            deployer: address(0xD3E10),
            expectedRvmId: address(0xBEEF)
        });
    }

    function _reactiveConfig() private pure returns (DeploymentValidation.ReactiveConfig memory) {
        return DeploymentValidation.ReactiveConfig({
            expectedChainId: REACTIVE_CHAIN_ID,
            originChainId: ORIGIN_CHAIN_ID,
            referenceChainId: ORIGIN_CHAIN_ID,
            systemContract: REACTIVE_SYSTEM,
            hook: address(0x1001),
            referenceFeed: address(0x1002),
            controller: address(0x1003),
            poolId: keccak256("phase7-pool"),
            marketId: keccak256("ETH-USD"),
            cronTopic: uint256(keccak256("Cron1")),
            callbackGasLimit: 1_000_000
        });
    }
}
