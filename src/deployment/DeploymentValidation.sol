// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {IMessageTransmitterV2} from "../interfaces/IMessageTransmitterV2.sol";

/// @title DeploymentValidation
/// @notice Fail-closed Circle and Uniswap validation shared by deployment scripts and tests.
library DeploymentValidation {
    struct OriginConfig {
        uint256 expectedChainId;
        uint32 expectedCircleDomain;
        address poolManager;
        address messageTransmitter;
        address expectedMessageTransmitter;
        address swapRouter;
        address modifyLiquidityRouter;
        address owner;
        address deployer;
    }

    struct ProcessorConfig {
        uint256 expectedChainId;
        uint32 expectedCircleDomain;
        address messageTransmitter;
        address expectedMessageTransmitter;
        address referenceFeed;
        uint32 originDomain;
        bytes32 originTransport;
        uint32 controllerDomain;
        bytes32 controller;
        bytes32 poolId;
        bytes32 marketId;
    }

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroChainId();
    error ZeroAddress(bytes32 field);
    error DuplicateAddress(bytes32 leftField, bytes32 rightField);
    error MissingCode(address target);
    error InvalidIdentifier(bytes32 field);
    error InvalidCircleMessageTransmitter(address supplied, address expected);
    error CircleDomainQueryFailed(address transmitter);
    error CircleDomainMismatch(uint32 actual, uint32 expected);
    error LocalAndRemoteCircleDomainMatch(uint32 domain);

    function validateOrigin(OriginConfig memory config, uint256 actualChainId) internal view returns (bytes32) {
        _validateChain(actualChainId, config.expectedChainId);
        _requireAddress(config.poolManager, "poolManager");
        _requireAddress(config.messageTransmitter, "messageTransmitter");
        _requireAddress(config.expectedMessageTransmitter, "expectedMessageTransmitter");
        _requireAddress(config.swapRouter, "swapRouter");
        _requireAddress(config.modifyLiquidityRouter, "modifyLiquidityRouter");
        _requireAddress(config.owner, "owner");
        _requireAddress(config.deployer, "deployer");
        _requireDistinct(config.poolManager, "poolManager", config.messageTransmitter, "messageTransmitter");
        _requireDistinct(config.swapRouter, "swapRouter", config.modifyLiquidityRouter, "modifyLiquidityRouter");
        requireCode(config.poolManager);
        requireCode(config.swapRouter);
        requireCode(config.modifyLiquidityRouter);
        _validateCircleTransmitter(
            config.messageTransmitter, config.expectedMessageTransmitter, config.expectedCircleDomain
        );
        return keccak256(abi.encode(config));
    }

    function validateProcessor(ProcessorConfig memory config, uint256 actualChainId) internal view returns (bytes32) {
        _validateChain(actualChainId, config.expectedChainId);
        _requireAddress(config.messageTransmitter, "messageTransmitter");
        _requireAddress(config.expectedMessageTransmitter, "expectedMessageTransmitter");
        _requireAddress(config.referenceFeed, "referenceFeed");
        requireCode(config.referenceFeed);
        _validateCircleTransmitter(
            config.messageTransmitter, config.expectedMessageTransmitter, config.expectedCircleDomain
        );
        if (config.originDomain == config.expectedCircleDomain) {
            revert LocalAndRemoteCircleDomainMatch(config.originDomain);
        }
        if (config.controllerDomain == config.expectedCircleDomain) {
            revert LocalAndRemoteCircleDomainMatch(config.controllerDomain);
        }
        if (config.originTransport == bytes32(0)) revert InvalidIdentifier("originTransport");
        if (config.controller == bytes32(0)) revert InvalidIdentifier("controller");
        if (config.poolId == bytes32(0)) revert InvalidIdentifier("poolId");
        if (config.marketId == bytes32(0)) revert InvalidIdentifier("marketId");
        return keccak256(abi.encode(config));
    }

    function requireCode(address target) internal view {
        if (target.code.length == 0) revert MissingCode(target);
    }

    function _validateCircleTransmitter(address supplied, address expected, uint32 expectedDomain) private view {
        if (supplied != expected) revert InvalidCircleMessageTransmitter(supplied, expected);
        requireCode(supplied);
        try IMessageTransmitterV2(supplied).localDomain() returns (uint32 actualDomain) {
            if (actualDomain != expectedDomain) revert CircleDomainMismatch(actualDomain, expectedDomain);
        } catch {
            revert CircleDomainQueryFailed(supplied);
        }
    }

    function _validateChain(uint256 actualChainId, uint256 expectedChainId) private pure {
        if (expectedChainId == 0) revert ZeroChainId();
        if (actualChainId != expectedChainId) revert WrongChain(actualChainId, expectedChainId);
    }

    function _requireAddress(address value, bytes32 field) private pure {
        if (value == address(0)) revert ZeroAddress(field);
    }

    function _requireDistinct(address left, bytes32 leftField, address right, bytes32 rightField) private pure {
        if (left == right) revert DuplicateAddress(leftField, rightField);
    }
}
