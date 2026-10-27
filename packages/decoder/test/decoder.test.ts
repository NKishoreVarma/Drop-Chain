import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeSimulationOutput,
  decodeTransferLog,
  decodeApprovalLog,
  TRANSFER_EVENT_TOPIC,
  APPROVAL_EVENT_TOPIC,
} from "../src/index.ts";
import { MAX_UINT256_STRING } from "@drop/effect-schema";

const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SUPPLIER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ATTACKER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

function padAddressToTopic(addr: string): `0x${string}` {
  const clean = addr.toLowerCase().replace("0x", "");
  return ("0x" + clean.padStart(64, "0")) as `0x${string}`;
}

function padUint256ToData(val: bigint): `0x${string}` {
  const hex = val.toString(16);
  return ("0x" + hex.padStart(64, "0")) as `0x${string}`;
}

describe("Effect Decoder — ERC-20 Events & Simulation Output", () => {
  it("decodes a standard Transfer event log", () => {
    const rawLog = {
      address: TOKEN,
      topics: [
        TRANSFER_EVENT_TOPIC,
        padAddressToTopic(SENDER),
        padAddressToTopic(SUPPLIER),
      ],
      data: padUint256ToData(400_000_000n), // 400 USDC
      logIndex: 0,
    };

    const effect = decodeTransferLog(rawLog);
    assert.equal(effect.type, "ERC20_TRANSFER");
    assert.equal(effect.token.toLowerCase(), TOKEN.toLowerCase());
    assert.equal(effect.from.toLowerCase(), SENDER.toLowerCase());
    assert.equal(effect.to.toLowerCase(), SUPPLIER.toLowerCase());
    assert.equal(effect.amount, "400000000");
    assert.equal(effect.evidence?.source, "EVENT_LOG");
  });

  it("decodes a bounded Approval event log", () => {
    const rawLog = {
      address: TOKEN,
      topics: [
        APPROVAL_EVENT_TOPIC,
        padAddressToTopic(SENDER),
        padAddressToTopic(SUPPLIER),
      ],
      data: padUint256ToData(1_000_000n), // 1 USDC
      logIndex: 1,
    };

    const effect = decodeApprovalLog(rawLog);
    assert.equal(effect.type, "ERC20_APPROVAL");
    assert.equal(effect.owner.toLowerCase(), SENDER.toLowerCase());
    assert.equal(effect.spender.toLowerCase(), SUPPLIER.toLowerCase());
    assert.equal(effect.amount, "1000000");
    assert.equal(effect.isUnlimited, false);
  });

  it("decodes an unlimited Approval event log (MAX_UINT256)", () => {
    const maxUint256 = (2n ** 256n) - 1n;
    const rawLog = {
      address: TOKEN,
      topics: [
        APPROVAL_EVENT_TOPIC,
        padAddressToTopic(SENDER),
        padAddressToTopic(ATTACKER),
      ],
      data: padUint256ToData(maxUint256),
      logIndex: 2,
    };

    const effect = decodeApprovalLog(rawLog);
    assert.equal(effect.type, "ERC20_APPROVAL");
    assert.equal(effect.owner.toLowerCase(), SENDER.toLowerCase());
    assert.equal(effect.spender.toLowerCase(), ATTACKER.toLowerCase());
    assert.equal(effect.amount, MAX_UINT256_STRING);
    assert.equal(effect.isUnlimited, true);
  });

  it("decodes multiple logs into ActualEffectManifest with complete status", () => {
    const maxUint256 = (2n ** 256n) - 1n;
    const simOutput = {
      success: true,
      logs: [
        {
          address: TOKEN,
          topics: [
            TRANSFER_EVENT_TOPIC,
            padAddressToTopic(SENDER),
            padAddressToTopic(SUPPLIER),
          ],
          data: padUint256ToData(400_000_000n),
          logIndex: 0,
        },
        {
          address: TOKEN,
          topics: [
            APPROVAL_EVENT_TOPIC,
            padAddressToTopic(SENDER),
            padAddressToTopic(ATTACKER),
          ],
          data: padUint256ToData(maxUint256),
          logIndex: 1,
        },
      ],
      isComplete: true,
    };

    const manifest = decodeSimulationOutput(simOutput);
    assert.equal(manifest.version, "1");
    assert.equal(manifest.isComplete, true);
    assert.equal(manifest.effects.length, 2);

    assert.equal(manifest.effects[0].type, "ERC20_TRANSFER");
    assert.equal(manifest.effects[1].type, "ERC20_APPROVAL");
    if (manifest.effects[1].type === "ERC20_APPROVAL") {
      assert.equal(manifest.effects[1].isUnlimited, true);
    }
  });

  it("fail-closed: marks manifest as incomplete when simulation reverted", () => {
    const simOutput = {
      success: false,
      logs: [],
      revertReason: "ERC20: transfer amount exceeds balance",
    };

    const manifest = decodeSimulationOutput(simOutput);
    assert.equal(manifest.isComplete, false);
    assert.equal(manifest.effects.length, 0);
  });

  it("fail-closed: marks manifest as incomplete when log is corrupted", () => {
    const simOutput = {
      success: true,
      logs: [
        {
          address: TOKEN,
          topics: [TRANSFER_EVENT_TOPIC], // Missing topics 1 and 2
          data: "0x123", // Malformed data
        },
      ],
      isComplete: true,
    };

    const manifest = decodeSimulationOutput(simOutput);
    assert.equal(manifest.isComplete, false);
  });
});
