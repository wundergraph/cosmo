import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "./run_suite";

test("parseArgs returns defaults when no flags are passed", () => {
  assert.deepEqual(parseArgs([]), {
    scenario: undefined,
    all: false,
    vus: 20,
    duration: "2m",
    rampUp: "30s",
    rampDown: "10s",
  });
});

test("parseArgs accepts a complete set of valid flags", () => {
  assert.deepEqual(
    parseArgs([
      "--scenario", "cache-demo",
      "--vus", "50",
      "--duration", "90s",
      "--ramp-up", "10s",
      "--ramp-down", "5s",
    ]),
    {
      scenario: "cache-demo",
      all: false,
      vus: 50,
      duration: "90s",
      rampUp: "10s",
      rampDown: "5s",
    },
  );
});

test("parseArgs rejects --vus that is not a positive integer", () => {
  for (const bad of ["abc", "0", "-1", "1.5", ""]) {
    assert.throws(
      () => parseArgs(["--vus", bad]),
      new RegExp(`--vus must be a positive integer, got "${bad}"`),
      `expected --vus="${bad}" to fail`,
    );
  }
});

test("parseArgs rejects malformed durations", () => {
  for (const flag of ["--duration", "--ramp-up", "--ramp-down"]) {
    assert.throws(
      () => parseArgs([flag, "thirty-seconds"]),
      new RegExp(`${flag} must look like 30s / 2m / 1h / 500ms, got "thirty-seconds"`),
    );
  }
});

test("parseArgs rejects flags with no value", () => {
  for (const flag of ["--scenario", "--vus", "--duration", "--ramp-up", "--ramp-down"]) {
    assert.throws(
      () => parseArgs([flag]),
      new RegExp(`missing value for ${flag}`),
    );
    // Also rejects when the next token is another flag
    assert.throws(
      () => parseArgs([flag, "--all"]),
      new RegExp(`missing value for ${flag}`),
    );
  }
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument: --bogus/);
});

test("parseArgs accepts integer-millisecond duration like 500ms", () => {
  assert.equal(parseArgs(["--ramp-down", "500ms"]).rampDown, "500ms");
});

test("parseArgs accepts plain integer (raw milliseconds) for duration", () => {
  assert.equal(parseArgs(["--duration", "1000"]).duration, "1000");
});
