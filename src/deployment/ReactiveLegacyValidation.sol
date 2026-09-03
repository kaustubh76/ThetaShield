// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DeploymentValidation} from "./DeploymentValidation.sol";
import {ReactiveLegacy} from "../reactive/ReactiveLegacy.sol";

/// @title ReactiveLegacyValidation
/// @notice Fail-closed validation for ThetaShield's Legacy Lasna automation deployment.
library ReactiveLegacyValidation {
    struct ProcessorConfig {
        uint256 expectedChainId;
        address callbackProxy;
        address sampler;
        address processor;
        address deployer;
        uint256 initialExecutorFundingWei;
    }

    struct ReactiveConfig {
        uint256 expectedChainId;
        uint256 processorChainId;
        address systemContract;
        address processor;
        address executor;
        address deployer;
        uint256 cronTopic;
        uint256 initialRscFundingWei;
    }

    error WrongLegacyChain(uint256 actual, uint256 expected);
    error LegacyLasnaRequired(uint256 supplied);
    error EthereumSepoliaProcessorRequired(uint256 supplied);
    error InvalidLegacyCallbackProxy(address supplied, address expected);
    error InvalidLegacySystemContract(address supplied, address expected);
    error InvalidLegacySystemCodeHash(bytes32 supplied, bytes32 expected);
    error LegacyReleaseCronRequired(uint256 supplied, uint256 expected);
    error ZeroAddress(bytes32 field);
    error InitialFundingRequired(bytes32 field);

    function validateProcessor(ProcessorConfig memory config, uint256 actualChainId)
        internal
        view
        returns (bytes32 fingerprint)
    {
        if (actualChainId != config.expectedChainId) {
            revert WrongLegacyChain(actualChainId, config.expectedChainId);
        }
        if (config.expectedChainId != ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID) {
            revert EthereumSepoliaProcessorRequired(config.expectedChainId);
        }
        if (config.callbackProxy != ReactiveLegacy.ETHEREUM_SEPOLIA_CALLBACK_PROXY) {
            revert InvalidLegacyCallbackProxy(config.callbackProxy, ReactiveLegacy.ETHEREUM_SEPOLIA_CALLBACK_PROXY);
        }
        _requireAddress(config.sampler, "sampler");
        _requireAddress(config.processor, "processor");
        _requireAddress(config.deployer, "deployer");
        DeploymentValidation.requireCode(config.callbackProxy);
        DeploymentValidation.requireCode(config.sampler);
        DeploymentValidation.requireCode(config.processor);
        if (config.initialExecutorFundingWei == 0) revert InitialFundingRequired("executorFunding");
        return keccak256(abi.encode(config));
    }

    function validateReactive(ReactiveConfig memory config, uint256 actualChainId)
        internal
        view
        returns (bytes32 fingerprint)
    {
        if (actualChainId != config.expectedChainId) {
            revert WrongLegacyChain(actualChainId, config.expectedChainId);
        }
        if (config.expectedChainId != ReactiveLegacy.LASNA_CHAIN_ID) {
            revert LegacyLasnaRequired(config.expectedChainId);
        }
        if (config.processorChainId != ReactiveLegacy.ETHEREUM_SEPOLIA_CHAIN_ID) {
            revert EthereumSepoliaProcessorRequired(config.processorChainId);
        }
        if (config.systemContract != ReactiveLegacy.SYSTEM_CONTRACT) {
            revert InvalidLegacySystemContract(config.systemContract, ReactiveLegacy.SYSTEM_CONTRACT);
        }
        if (config.cronTopic != ReactiveLegacy.RELEASE_CRON_TOPIC) {
            revert LegacyReleaseCronRequired(config.cronTopic, ReactiveLegacy.RELEASE_CRON_TOPIC);
        }
        _requireAddress(config.processor, "processor");
        _requireAddress(config.executor, "executor");
        _requireAddress(config.deployer, "deployer");
        DeploymentValidation.requireCode(config.systemContract);
        bytes32 systemCodeHash = config.systemContract.codehash;
        if (systemCodeHash != ReactiveLegacy.LASNA_SYSTEM_CODE_HASH) {
            revert InvalidLegacySystemCodeHash(systemCodeHash, ReactiveLegacy.LASNA_SYSTEM_CODE_HASH);
        }
        if (config.initialRscFundingWei == 0) revert InitialFundingRequired("rscFunding");
        return keccak256(abi.encode(config));
    }

    function _requireAddress(address value, bytes32 field) private pure {
        if (value == address(0)) revert ZeroAddress(field);
    }
}
