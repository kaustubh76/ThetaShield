// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ReactiveLegacy
/// @notice ThetaShield's pinned Reactive Network Legacy Lasna release constants.
/// @dev Values are sourced from the official Legacy network, CRON, and
///      origin/destination documentation. Deployment validation fails closed
///      when an environment attempts to mix these values with Omni settings.
library ReactiveLegacy {
    uint256 internal constant LASNA_CHAIN_ID = 5_318_007;
    address internal constant SYSTEM_CONTRACT = 0x0000000000000000000000000000000000fffFfF;
    bytes32 internal constant LASNA_SYSTEM_CODE_HASH =
        0x29fce405ff34f9c7a0bb44f9e6241ca21807dc47ac9b8c4f6bdd2eb748a67465;

    uint256 internal constant ETHEREUM_SEPOLIA_CHAIN_ID = 11_155_111;
    address internal constant ETHEREUM_SEPOLIA_CALLBACK_PROXY = 0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA;

    uint256 internal constant UNICHAIN_SEPOLIA_CHAIN_ID = 1_301;
    address internal constant UNICHAIN_SEPOLIA_CALLBACK_PROXY = 0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4;

    uint256 internal constant CRON_TOPIC_1 = 0xf02d6ea5c22a71cffe930a4523fcb4f129be6c804db50e4202fb4e0b07ccb514;
    uint256 internal constant CRON_TOPIC_10 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;
    uint256 internal constant CRON_TOPIC_100 = 0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;
    uint256 internal constant CRON_TOPIC_1000 = 0xe20b31294d84c3661ddc8f423abb9c70310d0cf172aa2714ead78029b325e3f4;
    uint256 internal constant CRON_TOPIC_10000 = 0xd214e1d84db704ed42d37f538ea9bf71e44ba28bc1cc088b2f5deca654677a56;

    /// @notice Cron10 is the release cadence: approximately one signal per minute.
    uint256 internal constant RELEASE_CRON_TOPIC = CRON_TOPIC_10;

    function isOfficialCronTopic(uint256 topic) internal pure returns (bool) {
        return topic == CRON_TOPIC_1 || topic == CRON_TOPIC_10 || topic == CRON_TOPIC_100 || topic == CRON_TOPIC_1000
            || topic == CRON_TOPIC_10000;
    }
}
