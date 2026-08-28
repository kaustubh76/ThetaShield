// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReactiveLegacyValidation} from "../../src/deployment/ReactiveLegacyValidation.sol";
import {ReactiveLegacy} from "../../src/reactive/ReactiveLegacy.sol";

contract ReactiveLegacyCodeStub {}

contract ReactiveLegacyValidationHarness {
    function validateProcessor(ReactiveLegacyValidation.ProcessorConfig memory config, uint256 actualChainId)
        external
        view
        returns (bytes32)
    {
        return ReactiveLegacyValidation.validateProcessor(config, actualChainId);
    }

    function validateReactive(ReactiveLegacyValidation.ReactiveConfig memory config, uint256 actualChainId)
        external
        view
        returns (bytes32)
    {
        return ReactiveLegacyValidation.validateReactive(config, actualChainId);
    }
}

contract ReactiveLegacyValidationTest is Test {
    bytes32 private constant RSC_FUNDING_FIELD = "rscFunding";

    ReactiveLegacyValidationHarness private harness;
    ReactiveLegacyCodeStub private sampler;
    ReactiveLegacyCodeStub private processor;

    function setUp() public {
        harness = new ReactiveLegacyValidationHarness();
        sampler = new ReactiveLegacyCodeStub();
        processor = new ReactiveLegacyCodeStub();
        vm.etch(ReactiveLegacy.ETHEREUM_SEPOLIA_CALLBACK_PROXY, address(new ReactiveLegacyCodeStub()).code);
        vm.etch(ReactiveLegacy.SYSTEM_CONTRACT, _legacySystemRuntime());
    }

    function test_officialLegacyConfigurationsProduceStableDistinctFingerprints() external view {
        bytes32 processorFingerprint =
            harness.validateProcessor(_processorConfig(), ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID);
        bytes32 reactiveFingerprint = harness.validateReactive(_reactiveConfig(), ReactiveLegacy.LASNA_CHAIN_ID);

        assertNotEq(processorFingerprint, bytes32(0));
        assertNotEq(reactiveFingerprint, bytes32(0));
        assertNotEq(processorFingerprint, reactiveFingerprint);
        assertEq(reactiveFingerprint, harness.validateReactive(_reactiveConfig(), ReactiveLegacy.LASNA_CHAIN_ID));
    }

    function test_omniSystemBytecodeFailsClosedEvenWhenChainIdMatches() external {
        vm.etch(ReactiveLegacy.SYSTEM_CONTRACT, address(new ReactiveLegacyCodeStub()).code);
        bytes32 actualCodeHash = ReactiveLegacy.SYSTEM_CONTRACT.codehash;

        vm.expectRevert(
            abi.encodeWithSelector(
                ReactiveLegacyValidation.InvalidLegacySystemCodeHash.selector,
                actualCodeHash,
                ReactiveLegacy.LASNA_SYSTEM_CODE_HASH
            )
        );
        harness.validateReactive(_reactiveConfig(), ReactiveLegacy.LASNA_CHAIN_ID);
    }

    function test_wrongCallbackProxyCronAndFundingFailClosed() external {
        ReactiveLegacyValidation.ProcessorConfig memory processorConfig = _processorConfig();
        processorConfig.callbackProxy = address(0x1234);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReactiveLegacyValidation.InvalidLegacyCallbackProxy.selector,
                address(0x1234),
                ReactiveLegacy.ETHEREUM_SEPOLIA_CALLBACK_PROXY
            )
        );
        harness.validateProcessor(processorConfig, ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID);

        ReactiveLegacyValidation.ReactiveConfig memory reactiveConfig = _reactiveConfig();
        reactiveConfig.cronTopic = uint256(keccak256("simulator-placeholder-cron10"));
        vm.expectRevert(
            abi.encodeWithSelector(
                ReactiveLegacyValidation.LegacyReleaseCronRequired.selector,
                reactiveConfig.cronTopic,
                ReactiveLegacy.RELEASE_CRON_TOPIC
            )
        );
        harness.validateReactive(reactiveConfig, ReactiveLegacy.LASNA_CHAIN_ID);

        reactiveConfig = _reactiveConfig();
        reactiveConfig.initialRscFundingWei = 0;
        vm.expectRevert(
            abi.encodeWithSelector(ReactiveLegacyValidation.InitialFundingRequired.selector, RSC_FUNDING_FIELD)
        );
        harness.validateReactive(reactiveConfig, ReactiveLegacy.LASNA_CHAIN_ID);
    }

    function _processorConfig() private view returns (ReactiveLegacyValidation.ProcessorConfig memory) {
        return ReactiveLegacyValidation.ProcessorConfig({
            expectedChainId: ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID,
            callbackProxy: ReactiveLegacy.ETHEREUM_SEPOLIA_CALLBACK_PROXY,
            sampler: address(sampler),
            processor: address(processor),
            deployer: address(0xD3E10),
            initialExecutorFundingWei: 0.01 ether
        });
    }

    function _reactiveConfig() private view returns (ReactiveLegacyValidation.ReactiveConfig memory) {
        return ReactiveLegacyValidation.ReactiveConfig({
            expectedChainId: ReactiveLegacy.LASNA_CHAIN_ID,
            processorChainId: ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID,
            systemContract: ReactiveLegacy.SYSTEM_CONTRACT,
            processor: address(processor),
            executor: address(0xE0EC),
            deployer: address(0xD3E10),
            cronTopic: ReactiveLegacy.RELEASE_CRON_TOPIC,
            initialRscFundingWei: 0.1 ether
        });
    }

    function _legacySystemRuntime() private pure returns (bytes memory) {
        return hex"6080604052600061000e610037565b905036600060013760006001366001845af43d600060013e808015610032573d6001f35b600080fd5b600080600060646001600160a01b03164360405160200161005a91815260200190565b60408051601f19818403018152908290526100749161011e565b6000604051808303816000865af19150503d80600081146100b1576040519150601f19603f3d011682016040523d82523d6000602084013e6100b6565b606091505b50915091508180156100c9575080516020145b6101035760405162461bcd60e51b81526020600482015260076024820152664661696c75726560c81b604482015260640160405180910390fd5b80806020019051810190610117919061014d565b9250505090565b6000825160005b8181101561013f5760208186018101518583015201610125565b506000920191825250919050565b60006020828403121561015f57600080fd5b81516001600160a01b038116811461017657600080fd5b939250505056fea2646970667358221220c5c4c80877de89843c74c1ec61f40cf134b51d7ab38ed96e8c5564e0eafad7fc64736f6c634300081c0033";
    }
}
