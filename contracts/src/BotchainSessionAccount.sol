// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Minimal ERC-4337 account for Botchain session-key operations.
/// @dev The owner can configure or revoke sessions, but owner signatures and owner execution are
///      deliberately absent from the normal UserOperation path.
contract BotchainSessionAccount is IAccount, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Session {
        address key;
        uint48 validAfter;
        uint48 validUntil;
        bool active;
    }

    struct TokenBudget {
        uint256 limit;
        uint256 spent;
        bool enabled;
    }

    struct CallPermission {
        uint64 maxCalls;
        uint64 callsUsed;
        bool enabled;
    }

    uint256 private constant SIG_VALIDATION_FAILED = 1;

    address public immutable owner;
    address public immutable entryPoint;

    mapping(bytes32 sessionId => Session) public sessions;
    mapping(bytes32 sessionId => bool) private _usedSessionIds;
    mapping(bytes32 sessionId => mapping(address token => TokenBudget)) public tokenBudgets;
    mapping(bytes32 sessionId => mapping(address target => mapping(bytes4 selector => CallPermission)))
        public callPermissions;
    mapping(bytes32 actionId => bool) public executedActions;

    event SessionAuthorized(
        bytes32 indexed sessionId,
        address indexed key,
        uint48 validAfter,
        uint48 validUntil
    );
    event SessionRevoked(bytes32 indexed sessionId, address indexed key);
    event TokenBudgetSet(bytes32 indexed sessionId, address indexed token, uint256 limit);
    event CallPermissionSet(
        bytes32 indexed sessionId,
        address indexed target,
        bytes4 indexed selector,
        uint64 maxCalls
    );
    event SessionTokenTransferred(
        bytes32 indexed sessionId,
        bytes32 indexed actionId,
        address indexed token,
        address recipient,
        uint256 amount
    );
    event SessionCallExecuted(
        bytes32 indexed sessionId,
        bytes32 indexed actionId,
        address indexed target,
        bytes4 selector
    );

    error OnlyOwner();
    error OnlyEntryPoint();
    error ZeroAddress();
    error InvalidSessionId();
    error SessionIdAlreadyUsed();
    error SessionNotActive();
    error InvalidTimeRange();
    error InvalidBudget();
    error InvalidCallPermission();
    error TokenBudgetExceeded();
    error CallLimitExceeded();
    error InvalidActionId();
    error ActionAlreadyExecuted();
    error CallExecutionFailed(bytes returndata);
    error PrefundFailed();

    constructor(address owner_, address entryPoint_) {
        if (owner_ == address(0) || entryPoint_ == address(0)) revert ZeroAddress();
        owner = owner_;
        entryPoint = entryPoint_;
    }

    function authorizeSession(
        bytes32 sessionId,
        address key,
        uint48 validAfter,
        uint48 validUntil
    ) external onlyOwner {
        if (sessionId == bytes32(0)) revert InvalidSessionId();
        if (key == address(0)) revert ZeroAddress();
        if (_usedSessionIds[sessionId]) revert SessionIdAlreadyUsed();
        if (validUntil != 0 && validUntil <= validAfter) revert InvalidTimeRange();

        _usedSessionIds[sessionId] = true;
        sessions[sessionId] = Session({
            key: key,
            validAfter: validAfter,
            validUntil: validUntil,
            active: true
        });
        emit SessionAuthorized(sessionId, key, validAfter, validUntil);
    }

    function revokeSession(bytes32 sessionId) external onlyOwner {
        Session storage session = sessions[sessionId];
        if (!session.active) revert SessionNotActive();
        session.active = false;
        emit SessionRevoked(sessionId, session.key);
    }

    function setTokenBudget(
        bytes32 sessionId,
        address token,
        uint256 limit
    ) external onlyOwner {
        _requireActiveSession(sessionId);
        if (token == address(0)) revert ZeroAddress();
        TokenBudget storage budget = tokenBudgets[sessionId][token];
        if (limit == 0 || limit < budget.spent) revert InvalidBudget();
        budget.limit = limit;
        budget.enabled = true;
        emit TokenBudgetSet(sessionId, token, limit);
    }

    function setCallPermission(
        bytes32 sessionId,
        address target,
        bytes4 selector,
        uint64 maxCalls
    ) external onlyOwner {
        _requireActiveSession(sessionId);
        if (target == address(0)) revert ZeroAddress();
        CallPermission storage permission = callPermissions[sessionId][target][selector];
        if (selector == bytes4(0) || maxCalls == 0 || maxCalls < permission.callsUsed) {
            revert InvalidCallPermission();
        }
        permission.maxCalls = maxCalls;
        permission.enabled = true;
        emit CallPermissionSet(sessionId, target, selector, maxCalls);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override onlyEntryPoint returns (uint256 validationData) {
        (bool allowed, bytes32 sessionId) = _isAllowedOperation(userOp);
        if (!allowed) return SIG_VALIDATION_FAILED;

        Session storage session = sessions[sessionId];
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(
            digest,
            userOp.signature
        );
        if (error != ECDSA.RecoverError.NoError || recovered != session.key) {
            return SIG_VALIDATION_FAILED;
        }

        if (missingAccountFunds > 0) {
            (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
            if (!success) revert PrefundFailed();
        }
        return _packValidationData(session.validUntil, session.validAfter);
    }

    function executeTokenTransfer(
        bytes32 sessionId,
        address token,
        address recipient,
        uint256 amount,
        bytes32 actionId
    ) external onlyEntryPoint nonReentrant {
        _requireUsableSession(sessionId);
        _requireUnusedAction(actionId);
        if (token == address(0) || recipient == address(0) || amount == 0) revert InvalidBudget();

        TokenBudget storage budget = tokenBudgets[sessionId][token];
        if (!budget.enabled || budget.spent + amount > budget.limit) revert TokenBudgetExceeded();

        executedActions[actionId] = true;
        budget.spent += amount;
        IERC20(token).safeTransfer(recipient, amount);
        emit SessionTokenTransferred(sessionId, actionId, token, recipient, amount);
    }

    function executeCall(
        bytes32 sessionId,
        address target,
        bytes calldata data,
        bytes32 actionId
    ) external onlyEntryPoint nonReentrant {
        _requireUsableSession(sessionId);
        _requireUnusedAction(actionId);
        if (target == address(0) || data.length < 4) revert InvalidCallPermission();

        bytes4 selector = _selectorOfCalldata(data);
        CallPermission storage permission = callPermissions[sessionId][target][selector];
        if (!permission.enabled || permission.callsUsed >= permission.maxCalls) {
            revert CallLimitExceeded();
        }

        executedActions[actionId] = true;
        permission.callsUsed += 1;
        (bool success, bytes memory returndata) = target.call(data);
        if (!success) revert CallExecutionFailed(returndata);
        emit SessionCallExecuted(sessionId, actionId, target, selector);
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert OnlyEntryPoint();
        _;
    }

    function _isAllowedOperation(
        PackedUserOperation calldata userOp
    ) private view returns (bool allowed, bytes32 sessionId) {
        if (userOp.sender != address(this) || userOp.callData.length < 36) {
            return (false, bytes32(0));
        }

        bytes4 outerSelector = _selectorOfCalldata(userOp.callData);
        if (outerSelector == this.executeTokenTransfer.selector) {
            (
                bytes32 decodedSessionId,
                address token,
                address recipient,
                uint256 amount,
                bytes32 actionId
            ) = abi.decode(userOp.callData[4:], (bytes32, address, address, uint256, bytes32));
            sessionId = decodedSessionId;
            if (!_isSessionConfigured(sessionId) || executedActions[actionId]) return (false, sessionId);
            TokenBudget storage budget = tokenBudgets[sessionId][token];
            allowed =
                token != address(0) &&
                recipient != address(0) &&
                amount > 0 &&
                actionId != bytes32(0) &&
                budget.enabled &&
                budget.spent + amount <= budget.limit;
            return (allowed, sessionId);
        }

        if (outerSelector == this.executeCall.selector) {
            (
                bytes32 decodedSessionId,
                address target,
                bytes memory data,
                bytes32 actionId
            ) = abi.decode(
                userOp.callData[4:],
                (bytes32, address, bytes, bytes32)
            );
            sessionId = decodedSessionId;
            if (
                !_isSessionConfigured(sessionId) ||
                target == address(0) ||
                data.length < 4 ||
                actionId == bytes32(0) ||
                executedActions[actionId]
            ) return (false, sessionId);
            bytes4 innerSelector = _selectorOfMemory(data);
            CallPermission storage permission = callPermissions[sessionId][target][innerSelector];
            allowed = permission.enabled && permission.callsUsed < permission.maxCalls;
            return (allowed, sessionId);
        }

        return (false, bytes32(0));
    }

    function _isSessionConfigured(bytes32 sessionId) private view returns (bool) {
        Session storage session = sessions[sessionId];
        return session.active && session.key != address(0);
    }

    function _requireActiveSession(bytes32 sessionId) private view {
        if (!_isSessionConfigured(sessionId)) revert SessionNotActive();
    }

    function _requireUsableSession(bytes32 sessionId) private view {
        Session storage session = sessions[sessionId];
        if (
            !session.active ||
            session.key == address(0) ||
            block.timestamp < session.validAfter ||
            (session.validUntil != 0 && block.timestamp > session.validUntil)
        ) revert SessionNotActive();
    }

    function _requireUnusedAction(bytes32 actionId) private view {
        if (actionId == bytes32(0)) revert InvalidActionId();
        if (executedActions[actionId]) revert ActionAlreadyExecuted();
    }

    function _packValidationData(
        uint48 validUntil,
        uint48 validAfter
    ) private pure returns (uint256) {
        return (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }

    function _selectorOfCalldata(bytes calldata data) private pure returns (bytes4 selector) {
        assembly ("memory-safe") {
            selector := calldataload(data.offset)
        }
    }

    function _selectorOfMemory(bytes memory data) private pure returns (bytes4 selector) {
        assembly ("memory-safe") {
            selector := mload(add(data, 32))
        }
    }
}
