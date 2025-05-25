
pragma solidity ^0.8.0;

contract Ballot {
    address chairperson;

    constructor() {
        chairperson = msg.sender;
    }

    function getChairPersonAddress() public view returns (address) {
        return chairperson;
    }
} 