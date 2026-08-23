// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title HookAddressMiner
/// @notice Finds a CREATE2 salt whose address encodes exact Uniswap v4 hook flags.
/// @dev Implements the same deterministic search used by Uniswap's MIT-licensed
///      periphery utility, specialized to the 14 permission bits in v4.0.0.
library HookAddressMiner {
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint256 internal constant MAX_LOOP = 160_000;

    error HookAddressNotFound();

    function find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs)
        internal
        pure
        returns (address hookAddress, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(abi.encodePacked(creationCode, constructorArgs));

        for (uint256 index; index < MAX_LOOP; ++index) {
            salt = bytes32(index);
            bytes32 addressHash = keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash));
            // CREATE2 addresses are defined as the low 20 bytes of this hash.
            // forge-lint: disable-next-line(unsafe-typecast)
            hookAddress = address(uint160(uint256(addressHash)));
            if (uint160(hookAddress) & ALL_HOOK_MASK == flags) return (hookAddress, salt);
        }

        revert HookAddressNotFound();
    }
}
