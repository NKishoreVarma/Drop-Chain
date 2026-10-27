import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LocalEvmSimulator,
  MockSimulationAdapter,
} from "../src/index.ts";
import type { RawLog } from "@drop/decoder";

const FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("Simulator — Local Adapter & Fail-Closed Invariants", () => {
  it("returns successful simulation result when dry-run succeeds", async () => {
    const mockProvider = {
      async call() {
        return { data: "0x" as `0x${string}` };
      },
      async getLogs() {
        return [] as RawLog[];
      },
    };

    const simulator = new LocalEvmSimulator(mockProvider);
    const result = await simulator.simulate({
      from: FROM,
      to: TO,
      data: "0xa9059cbb",
    });

    assert.equal(result.success, true);
    assert.equal(result.isComplete, true);
    assert.equal(result.logs.length, 0);
  });

  it("fail-closed: returns success: false and isComplete: false when execution reverts", async () => {
    const mockProvider = {
      async call() {
        throw new Error("execution reverted: DropValidator: policy exceeded");
      },
    };

    const simulator = new LocalEvmSimulator(mockProvider);
    const result = await simulator.simulate({
      from: FROM,
      to: TO,
      data: "0xa9059cbb",
    });

    assert.equal(result.success, false);
    assert.equal(result.isComplete, false);
    assert.ok(result.revertReason?.includes("policy exceeded"));
  });

  it("fail-closed: returns isComplete: false when getLogs throws", async () => {
    const mockProvider = {
      async call() {
        return { data: "0x" as `0x${string}` };
      },
      async getLogs() {
        throw new Error("RPC error fetching logs");
      },
    };

    const simulator = new LocalEvmSimulator(mockProvider);
    const result = await simulator.simulate({
      from: FROM,
      to: TO,
      data: "0xa9059cbb",
    });

    assert.equal(result.success, true);
    assert.equal(result.isComplete, false);
  });

  it("MockSimulationAdapter produces configured result", async () => {
    const adapter = new MockSimulationAdapter();
    adapter.setNextResult({
      success: true,
      gasUsed: 42000n,
      logs: [
        {
          address: TO,
          topics: ["0xddf252ad1be2c89b69c2b068fc378d5359a9e2973778f73443b1b8845821b3f7"],
          data: "0x",
        },
      ],
      isComplete: true,
    });

    const res = await adapter.simulate({
      from: FROM,
      to: TO,
      data: "0x",
    });

    assert.equal(res.success, true);
    assert.equal(res.gasUsed, 42000n);
    assert.equal(res.logs.length, 1);
  });
});
