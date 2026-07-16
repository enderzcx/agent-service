// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {BotchainSessionAccount} from "../src/BotchainSessionAccount.sol";
import {BotchainSessionAccountFactory} from "../src/BotchainSessionAccountFactory.sol";

contract MockEntryPoint {
    function validate(
        BotchainSessionAccount account,
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        return account.validateUserOp(userOp, userOpHash, 0);
    }

    function executeTokenTransfer(
        BotchainSessionAccount account,
        bytes32 sessionId,
        address token,
        address recipient,
        uint256 amount,
        bytes32 actionId
    ) external {
        account.executeTokenTransfer(sessionId, token, recipient, amount, actionId);
    }

    function executeCall(
        BotchainSessionAccount account,
        bytes32 sessionId,
        address target,
        bytes calldata data,
        bytes32 actionId
    ) external {
        account.executeCall(sessionId, target, data, actionId);
    }
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract MockTarget {
    uint256 public lastValue;

    function perform(uint256 value) external {
        lastValue = value;
    }
}

contract NonOwnerCaller {
    function authorize(
        BotchainSessionAccount account,
        bytes32 sessionId,
        address key
    ) external {
        account.authorizeSession(sessionId, key, 0, 0);
    }
}

contract BotchainSessionAccountTest {
    bytes32 private constant SESSION_ID = keccak256("session-001");
    bytes32 private constant USER_OP_HASH =
        0x4582efc898a293ee41a97094b99cbb4acf9bda3e02300857929de6be98ba89b9;
    address private constant SESSION_KEY = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    bytes private constant SESSION_SIGNATURE =
        hex"8ace7e1abf8afea416863e65785131184e824336fab7516b390fb50407d7d6c90606c18c61dbd38ae757a91b232da79865163211f9adeb9d44c8c9de4e086ab21c";

    MockEntryPoint private entryPoint;
    BotchainSessionAccountFactory private factory;
    BotchainSessionAccount private account;
    MockToken private token;
    MockTarget private target;

    function setUp() public {
        entryPoint = new MockEntryPoint();
        factory = new BotchainSessionAccountFactory(address(entryPoint));
        account = factory.createAccount(address(this), 0);
        token = new MockToken();
        target = new MockTarget();
    }

    function testFactoryAddressIsDeterministicAndIdempotent() public {
        address predicted = factory.getAddress(address(this), 7);
        BotchainSessionAccount deployed = factory.createAccount(address(this), 7);
        BotchainSessionAccount repeated = factory.createAccount(address(this), 7);

        require(address(deployed) == predicted, "factory prediction mismatch");
        require(address(repeated) == predicted, "factory should return existing account");
        require(deployed.owner() == address(this), "wrong owner");
        require(deployed.entryPoint() == address(entryPoint), "wrong EntryPoint");
    }

    function testOnlyOwnerCanAuthorizeSession() public {
        NonOwnerCaller caller = new NonOwnerCaller();
        (bool success,) = address(caller).call(
            abi.encodeCall(NonOwnerCaller.authorize, (account, SESSION_ID, SESSION_KEY))
        );
        require(!success, "non-owner authorization must fail");

        account.authorizeSession(SESSION_ID, SESSION_KEY, 0, 0);
        (address key,,, bool active) = account.sessions(SESSION_ID);
        require(key == SESSION_KEY && active, "owner authorization missing");
    }

    function testSessionIdCannotBeReusedAfterRevocation() public {
        account.authorizeSession(SESSION_ID, SESSION_KEY, 0, 0);
        account.revokeSession(SESSION_ID);

        (bool success,) = address(account).call(
            abi.encodeCall(
                BotchainSessionAccount.authorizeSession,
                (SESSION_ID, SESSION_KEY, 0, 0)
            )
        );
        require(!success, "revoked session ID must not be reusable");
    }

    function testValidationBindsSignatureAndReturnsSessionTimeRange() public {
        account.authorizeSession(SESSION_ID, SESSION_KEY, 5, 10);
        account.setTokenBudget(SESSION_ID, address(token), 1_000_000);
        bytes memory callData = abi.encodeCall(
            BotchainSessionAccount.executeTokenTransfer,
            (SESSION_ID, address(token), address(0xBEEF), 1, keccak256("time-range"))
        );

        uint256 expectedValidationData = (uint256(10) << 160) | (uint256(5) << 208);
        require(
            entryPoint.validate(account, _userOp(callData, SESSION_SIGNATURE), USER_OP_HASH) ==
                expectedValidationData,
            "session time range not packed"
        );
        require(
            entryPoint.validate(
                account,
                _userOp(callData, SESSION_SIGNATURE),
                bytes32(uint256(USER_OP_HASH) + 1)
            ) == 1,
            "signature must be bound to UserOperation hash"
        );
    }

    function testSessionSignatureTransfersOnlyWithinCumulativeTokenBudget() public {
        account.authorizeSession(SESSION_ID, SESSION_KEY, 0, 0);
        account.setTokenBudget(SESSION_ID, address(token), 1_000_000);
        token.mint(address(account), 2_000_000);

        bytes memory firstCall = abi.encodeCall(
            BotchainSessionAccount.executeTokenTransfer,
            (SESSION_ID, address(token), address(0xBEEF), 600_000, keccak256("payment-1"))
        );
        require(entryPoint.validate(account, _userOp(firstCall, SESSION_SIGNATURE), USER_OP_HASH) == 0);
        entryPoint.executeTokenTransfer(
            account,
            SESSION_ID,
            address(token),
            address(0xBEEF),
            600_000,
            keccak256("payment-1")
        );
        require(token.balanceOf(address(0xBEEF)) == 600_000, "recipient amount mismatch");

        bytes memory overBudgetCall = abi.encodeCall(
            BotchainSessionAccount.executeTokenTransfer,
            (SESSION_ID, address(token), address(0xBEEF), 500_000, keccak256("payment-2"))
        );
        require(
            entryPoint.validate(account, _userOp(overBudgetCall, SESSION_SIGNATURE), USER_OP_HASH) == 1,
            "over-budget validation must fail"
        );
        (bool success,) = address(entryPoint).call(
            abi.encodeCall(
                MockEntryPoint.executeTokenTransfer,
                (
                    account,
                    SESSION_ID,
                    address(token),
                    address(0xBEEF),
                    500_000,
                    keccak256("payment-2")
                )
            )
        );
        require(!success, "over-budget execution must fail");
    }

    function testGenericCallRequiresPermissionAndConsumesCallLimit() public {
        account.authorizeSession(SESSION_ID, SESSION_KEY, 0, 0);
        account.setCallPermission(SESSION_ID, address(target), MockTarget.perform.selector, 1);
        bytes memory innerCall = abi.encodeCall(MockTarget.perform, (42));
        bytes memory outerCall = abi.encodeCall(
            BotchainSessionAccount.executeCall,
            (SESSION_ID, address(target), innerCall, keccak256("job-1"))
        );

        require(entryPoint.validate(account, _userOp(outerCall, SESSION_SIGNATURE), USER_OP_HASH) == 0);
        entryPoint.executeCall(
            account,
            SESSION_ID,
            address(target),
            innerCall,
            keccak256("job-1")
        );
        require(target.lastValue() == 42, "target call missing");
        require(
            entryPoint.validate(account, _userOp(outerCall, SESSION_SIGNATURE), USER_OP_HASH) == 1,
            "exhausted call permission must fail"
        );
    }

    function testOwnerCannotBypassEntryPointExecution() public {
        account.authorizeSession(SESSION_ID, SESSION_KEY, 0, 0);
        account.setTokenBudget(SESSION_ID, address(token), 1_000_000);
        (bool success,) = address(account).call(
            abi.encodeCall(
                BotchainSessionAccount.executeTokenTransfer,
                (SESSION_ID, address(token), address(0xBEEF), 1, keccak256("owner-bypass"))
            )
        );
        require(!success, "owner direct execution must fail");
    }

    function testInvalidOrRevokedSessionSignatureReturnsFailureWithoutFallback() public {
        account.authorizeSession(SESSION_ID, SESSION_KEY, 0, 0);
        account.setTokenBudget(SESSION_ID, address(token), 1_000_000);
        bytes memory callData = abi.encodeCall(
            BotchainSessionAccount.executeTokenTransfer,
            (SESSION_ID, address(token), address(0xBEEF), 1, keccak256("invalid-signature"))
        );
        require(entryPoint.validate(account, _userOp(callData, hex"1234"), USER_OP_HASH) == 1);

        account.revokeSession(SESSION_ID);
        require(entryPoint.validate(account, _userOp(callData, SESSION_SIGNATURE), USER_OP_HASH) == 1);
    }

    function _userOp(
        bytes memory callData,
        bytes memory signature
    ) private view returns (PackedUserOperation memory) {
        return
            PackedUserOperation({
                sender: address(account),
                nonce: 0,
                initCode: hex"",
                callData: callData,
                accountGasLimits: bytes32(0),
                preVerificationGas: 0,
                gasFees: bytes32(0),
                paymasterAndData: hex"",
                signature: signature
            });
    }
}
