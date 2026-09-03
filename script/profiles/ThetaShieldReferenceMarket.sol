// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title ThetaShieldReferenceMarket
/// @notice Locked identifiers and pool tiers for the self-contained G10 reference market.
library ThetaShieldReferenceMarket {
    address internal constant ETHEREUM_SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant ETHEREUM_SEPOLIA_MODIFY_LIQUIDITY_ROUTER = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
    address internal constant ETHEREUM_SEPOLIA_SWAP_ROUTER = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;

    bytes32 internal constant MARKET_ID = 0x56c48850281d506ec35fd133ed0ea59e62ee69ee1231b757f2045efd33404fe3;
    bytes32 internal constant SOURCE_ID_0 = 0xc747bb9e807253c4ccaf8aadb189ab0c711fabb226ae069054f3dfe67d239a56;
    bytes32 internal constant SOURCE_ID_1 = 0xcd75737e198163982bf205f8ee2fd2c22cc253c1995b51d23b8ae20c4d63a4ef;
    bytes32 internal constant SOURCE_ID_2 = 0x2e44aa136bb8c35838d2797737aa0168f25fff8127fb150960a0439094ebbba3;

    uint24 internal constant FEE_0 = 500;
    uint24 internal constant FEE_1 = 3_000;
    uint24 internal constant FEE_2 = 10_000;
    int24 internal constant TICK_SPACING_0 = 10;
    int24 internal constant TICK_SPACING_1 = 60;
    int24 internal constant TICK_SPACING_2 = 200;

    uint160 internal constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;
    int24 internal constant TICK_LOWER = -600;
    int24 internal constant TICK_UPPER = 600;

    function sourceId(uint256 index) internal pure returns (bytes32) {
        if (index == 0) return SOURCE_ID_0;
        if (index == 1) return SOURCE_ID_1;
        if (index == 2) return SOURCE_ID_2;
        revert("reference source index");
    }

    function fee(uint256 index) internal pure returns (uint24) {
        if (index == 0) return FEE_0;
        if (index == 1) return FEE_1;
        if (index == 2) return FEE_2;
        revert("reference fee index");
    }

    function tickSpacing(uint256 index) internal pure returns (int24) {
        if (index == 0) return TICK_SPACING_0;
        if (index == 1) return TICK_SPACING_1;
        if (index == 2) return TICK_SPACING_2;
        revert("reference tick index");
    }

    function poolKey(address token0, address token1, uint256 index) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: fee(index),
            tickSpacing: tickSpacing(index),
            hooks: IHooks(address(0))
        });
    }
}
