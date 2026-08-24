// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

/// @title DeploymentValidation
/// @notice Fail-closed validation shared by deployment preflight scripts and tests.
library DeploymentValidation {
    address internal constant REACTIVE_SYSTEM_CONTRACT = 0x0000000000000000000000000000000000fffFfF;
    uint256 internal constant MINIMUM_CALLBACK_GAS_LIMIT = 100_000;

    struct OriginConfig {
        uint256 expectedChainId;
        address poolManager;
        address callbackProxy;
        address owner;
        address deployer;
        address expectedRvmId;
    }

    struct ReactiveConfig {
        uint256 expectedChainId;
        uint256 originChainId;
        uint256 referenceChainId;
        address systemContract;
        bytes32 expectedSystemCodeHash;
        address hook;
        address referenceFeed;
        address controller;
        bytes32 poolId;
        bytes32 marketId;
        uint256 cronTopic;
        uint256 callbackGasLimit;
    }

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroChainId();
    error ZeroAddress(bytes32 field);
    error DuplicateAddress(bytes32 leftField, bytes32 rightField);
    error MissingCode(address target);
    error InvalidIdentifier(bytes32 field);
    error InvalidReactiveSystemContract(address supplied, address expected);
    error ReactiveSystemCodeHashMismatch(bytes32 actual, bytes32 expected);
    error ReactiveAndOriginChainMatch(uint256 chainId);
    error CallbackGasLimitOutOfBounds(uint256 supplied);

    function validateOrigin(OriginConfig memory config, uint256 actualChainId) internal view returns (bytes32) {
        _validateChain(actualChainId, config.expectedChainId);
        _requireAddress(config.poolManager, "poolManager");
        _requireAddress(config.callbackProxy, "callbackProxy");
        _requireAddress(config.owner, "owner");
        _requireAddress(config.deployer, "deployer");
        _requireAddress(config.expectedRvmId, "expectedRvmId");
        if (config.poolManager == config.callbackProxy) {
            revert DuplicateAddress("poolManager", "callbackProxy");
        }
        requireCode(config.poolManager);
        requireCode(config.callbackProxy);
        return keccak256(abi.encode(config));
    }

    function validateReactive(ReactiveConfig memory config, uint256 actualChainId) internal view returns (bytes32) {
        _validateChain(actualChainId, config.expectedChainId);
        if (config.originChainId == 0 || config.referenceChainId == 0) revert ZeroChainId();
        if (config.originChainId == config.expectedChainId) {
            revert ReactiveAndOriginChainMatch(config.expectedChainId);
        }
        _requireAddress(config.systemContract, "systemContract");
        if (config.systemContract != REACTIVE_SYSTEM_CONTRACT) {
            revert InvalidReactiveSystemContract(config.systemContract, REACTIVE_SYSTEM_CONTRACT);
        }
        requireCode(config.systemContract);
        bytes32 actualSystemCodeHash = config.systemContract.codehash;
        if (actualSystemCodeHash != config.expectedSystemCodeHash) {
            revert ReactiveSystemCodeHashMismatch(actualSystemCodeHash, config.expectedSystemCodeHash);
        }
        _requireAddress(config.hook, "hook");
        _requireAddress(config.referenceFeed, "referenceFeed");
        _requireAddress(config.controller, "controller");
        if (config.hook == config.referenceFeed) revert DuplicateAddress("hook", "referenceFeed");
        if (config.hook == config.controller) revert DuplicateAddress("hook", "controller");
        if (config.referenceFeed == config.controller) revert DuplicateAddress("referenceFeed", "controller");
        if (config.poolId == bytes32(0)) revert InvalidIdentifier("poolId");
        if (config.marketId == bytes32(0)) revert InvalidIdentifier("marketId");
        if (config.cronTopic == 0) revert InvalidIdentifier("cronTopic");
        if (config.callbackGasLimit < MINIMUM_CALLBACK_GAS_LIMIT || config.callbackGasLimit > type(uint64).max) {
            revert CallbackGasLimitOutOfBounds(config.callbackGasLimit);
        }
        return keccak256(abi.encode(config));
    }

    function requireCode(address target) internal view {
        if (target.code.length == 0) revert MissingCode(target);
    }

    function _validateChain(uint256 actualChainId, uint256 expectedChainId) private pure {
        if (expectedChainId == 0) revert ZeroChainId();
        if (actualChainId != expectedChainId) revert WrongChain(actualChainId, expectedChainId);
    }

    function _requireAddress(address value, bytes32 field) private pure {
        if (value == address(0)) revert ZeroAddress(field);
    }
}
