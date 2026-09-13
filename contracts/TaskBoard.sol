// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// A deliberately small local experiment, not a production task management service.
contract TaskBoard {
    mapping(uint256 => bool) public completed;
    uint256 public completedCount;
    event TaskChanged(uint256 indexed taskId, bool wasCompleted, bool isCompleted);

    function setCompleted(uint256 taskId, bool value) external {
        bool previous = completed[taskId];
        require(previous != value, "unchanged");
        completed[taskId] = value;
        if (value) completedCount += 1;
        else completedCount -= 1;
        emit TaskChanged(taskId, previous, value);
    }
}
