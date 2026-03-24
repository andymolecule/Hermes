// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {AgoraFactory} from "../../src/AgoraFactory.sol";
import {AgoraChallenge} from "../../src/AgoraChallenge.sol";
import {IAgoraChallenge} from "../../src/interfaces/IAgoraChallenge.sol";
import {BaseSepoliaForkTest} from "./BaseSepoliaForkTest.t.sol";

contract BaseSepoliaCreateChallengeForkTest is BaseSepoliaForkTest {
    uint256 private constant REWARD_AMOUNT = 5e6;
    uint256 private constant MAX_SUBMISSIONS = 100;
    uint256 private constant MAX_SUBMISSIONS_PER_SOLVER = 3;

    function testCreateChallengeAgainstLiveUsdcProxy() public {
        IERC20 usdc = IERC20(usdcAddress);
        AgoraFactory deployedFactory = AgoraFactory(factoryAddress);

        AgoraFactory forkFactory = new AgoraFactory(
            usdc,
            deployedFactory.oracle(),
            deployedFactory.treasury()
        );

        address poster = makeAddr("forkPoster");
        deal(usdcAddress, poster, REWARD_AMOUNT);

        vm.startPrank(poster);
        usdc.approve(address(forkFactory), REWARD_AMOUNT);
        (, address challengeAddress) = forkFactory.createChallenge(
            "fork-spec-cid",
            REWARD_AMOUNT,
            uint64(block.timestamp + 1 days),
            168,
            0,
            uint8(IAgoraChallenge.DistributionType.WinnerTakeAll),
            address(0),
            MAX_SUBMISSIONS,
            MAX_SUBMISSIONS_PER_SOLVER
        );
        vm.stopPrank();

        AgoraChallenge challenge = AgoraChallenge(challengeAddress);

        assertGt(challengeAddress.code.length, 0, "challenge must be deployed");
        assertEq(address(challenge.usdc()), usdcAddress, "challenge must point at live USDC");
        assertEq(challenge.poster(), poster, "poster must match challenge creator");
        assertEq(challenge.oracle(), deployedFactory.oracle(), "oracle must inherit from factory");
        assertEq(challenge.treasury(), deployedFactory.treasury(), "treasury must inherit from factory");
        assertEq(usdc.balanceOf(challengeAddress), REWARD_AMOUNT, "challenge must be fully funded");
    }
}
