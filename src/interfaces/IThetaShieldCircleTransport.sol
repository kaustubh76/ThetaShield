// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CircleMessages} from "../circle/CircleMessages.sol";

/// @notice Origin transport surface used by the hook after recording a swap.
interface IThetaShieldCircleTransport {
    function sendObservation(CircleMessages.Observation calldata observation) external;
}
