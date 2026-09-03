// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CircleMessages} from "../../src/circle/CircleMessages.sol";
import {IThetaShieldCircleTransport} from "../../src/interfaces/IThetaShieldCircleTransport.sol";

contract MockThetaShieldCircleTransport is IThetaShieldCircleTransport {
    CircleMessages.Observation private _lastObservation;
    uint256 public sentCount;
    bool public sendsRevert;

    error MockTransportFailure();

    function setSendsRevert(bool value) external {
        sendsRevert = value;
    }

    function sendObservation(CircleMessages.Observation calldata observation) external {
        if (sendsRevert) revert MockTransportFailure();
        _lastObservation = observation;
        ++sentCount;
    }

    function lastObservation() external view returns (CircleMessages.Observation memory observation) {
        return _lastObservation;
    }
}
