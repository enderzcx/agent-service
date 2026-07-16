// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {BotchainSessionAccount} from "./BotchainSessionAccount.sol";

/// @notice Permissionless direct CREATE2 factory for BotchainSessionAccount.
contract BotchainSessionAccountFactory {
    address public immutable entryPoint;

    event AccountCreated(address indexed owner, uint256 indexed salt, address indexed account);

    error ZeroAddress();

    constructor(address entryPoint_) {
        if (entryPoint_ == address(0)) revert ZeroAddress();
        entryPoint = entryPoint_;
    }

    function createAccount(
        address owner,
        uint256 salt
    ) external returns (BotchainSessionAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) return BotchainSessionAccount(payable(predicted));

        account = new BotchainSessionAccount{salt: _derivedSalt(owner, salt)}(owner, entryPoint);
        emit AccountCreated(owner, salt, address(account));
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        if (owner == address(0)) revert ZeroAddress();
        bytes memory creationCode = abi.encodePacked(
            type(BotchainSessionAccount).creationCode,
            abi.encode(owner, entryPoint)
        );
        return
            Create2.computeAddress(
                _derivedSalt(owner, salt),
                keccak256(creationCode),
                address(this)
            );
    }

    function _derivedSalt(address owner, uint256 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
