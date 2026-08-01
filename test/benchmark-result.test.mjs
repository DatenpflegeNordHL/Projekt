import test from "node:test";
import assert from "node:assert/strict";
import { getFixture } from "../benchmarks/harness/fixture-manifest.mjs";
import * as fixtureValidator from "../benchmarks/harness/validate-fixtures.mjs";
import { parseUntrustedBenchmarkResult } from "../benchmarks/schema/benchmark-result.v1.mjs";

function validResult() { return JSON.parse(JSON.stringify(fixtureValidator.validateFixture(getFixture("logic-bug")))); }
function parse(input) { return parseUntrustedBenchmarkResult(input).data; }

test("strict result schema freezes a validated ordinary-data copy", () => {
  const result = parse(validResult());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.usage.cost), true);
  assert.throws(() => { result.fixture.id = "changed"; }, TypeError);
});

test("schema rejects unknown, missing, prototype, accessor, unsafe-path, and hash attacks", () => {
  const unknown = validResult(); unknown.extra = true;
  assert.throws(() => parse(unknown), /unknown or missing/);
  const missing = validResult(); delete missing.fixture.id;
  assert.throws(() => parse(missing), /unknown or missing/);
  const prototype = validResult(); Object.setPrototypeOf(prototype, { injected: true });
  assert.throws(() => parse(prototype), /ordinary object/);
  const accessor = validResult(); Object.defineProperty(accessor, "schema", { enumerable: true, get: () => "codexlooper.benchmark-result.v1" });
  assert.throws(() => parse(accessor), /enumerable data property/);
  const symbol = validResult(); symbol[Symbol("hidden")] = true;
  assert.throws(() => parse(symbol), /must not contain symbols/);
  const hidden = validResult(); Object.defineProperty(hidden, "hidden", { value: true, enumerable: false });
  assert.throws(() => parse(hidden), /enumerable data property/);
  const unsafe = validResult(); unsafe.changes.entries = [{ path: "../verifier.mjs", kind: "modify" }];
  assert.throws(() => parse(unsafe), /safe POSIX/);
  const controlPath = validResult(); controlPath.changes.entries = [{ path: "src/logic\n.mjs", kind: "modify" }];
  assert.throws(() => parse(controlPath), /safe POSIX/);
  const badHash = validResult(); badHash.source.initial_tree_sha256 = "A".repeat(64);
  assert.throws(() => parse(badHash), /lowercase SHA-256/);
  const arrayAccessor = validResult(); Object.defineProperty(arrayAccessor.changes.entries, "0", { enumerable: true, get: () => ({ path: "src/logic.mjs", kind: "modify" }) });
  assert.throws(() => parse(arrayAccessor), /ordinary array|enumerable data entries/);
  const arrayPrototype = validResult(); Object.setPrototypeOf(arrayPrototype.changes.entries, { injected: true });
  assert.throws(() => parse(arrayPrototype), /ordinary array/);
  const sparse = validResult(); sparse.changes.entries = new Array(1);
  assert.throws(() => parse(sparse), /dense/);
});

test("schema accepts null source commit but requires a canonical full Git SHA when present", () => {
  const absent = validResult(); absent.source.commit = null;
  assert.equal(parse(absent).source.commit, null);
  const present = validResult(); present.source.commit = "a".repeat(40);
  assert.equal(parse(present).source.commit, "a".repeat(40));
  const malformed = validResult(); malformed.source.commit = "a".repeat(64);
  assert.throws(() => parse(malformed), /full lowercase Git SHA/);
});

test("offline usage cannot forge observed zero token or cost values", () => {
  const tokens = validResult(); tokens.usage.input_tokens = 0;
  assert.throws(() => parse(tokens), /unobserved usage values/);
  const cost = validResult(); cost.usage.cost = { status: "not_applicable", amount: 0, currency: "USD", pricing_snapshot_sha256: "a".repeat(64) };
  assert.throws(() => parse(cost), /unobserved cost/);
  const contradictory = validResult(); contradictory.usage.status = "observed";
  assert.throws(() => parse(contradictory), /non-offline source/);
  const unavailable = validResult(); unavailable.usage.status = "unavailable"; unavailable.usage.input_tokens = 1;
  assert.throws(() => parse(unavailable), /unobserved usage values/);
});

test("schema enforces the outcome matrix and rejects invalid numeric bounds", () => {
  const passed = validResult(); assert.equal(parse(passed).outcome.status, "passed");
  const failed = validResult(); failed.outcome.status = "failed"; failed.outcome.test.exit_code = 1;
  assert.equal(parse(failed).outcome.status, "failed");
  const blocked = validResult(); blocked.outcome.status = "blocked"; blocked.outcome.termination = "not_started"; blocked.outcome.test.exit_code = 1;
  assert.equal(parse(blocked).outcome.status, "blocked");
  const invalid = validResult(); invalid.outcome.status = "invalid"; invalid.outcome.test.exit_code = 1;
  assert.equal(parse(invalid).outcome.status, "invalid");
  const forgedFailed = validResult(); forgedFailed.outcome.status = "failed";
  assert.throws(() => parse(forgedFailed), /failed requires/);
  const forgedBlocked = validResult(); forgedBlocked.outcome.status = "blocked"; forgedBlocked.outcome.termination = "completed"; forgedBlocked.outcome.test.exit_code = 0;
  assert.throws(() => parse(forgedBlocked), /blocked requires/);
  const forgedInvalid = validResult(); forgedInvalid.outcome.status = "invalid";
  assert.throws(() => parse(forgedInvalid), /invalid requires/);
  const negative = validResult(); negative.timing.total_ms = -1;
  assert.throws(() => parse(negative), /non-negative/);
  const oversized = validResult(); oversized.fixture.id = "é".repeat(3000);
  assert.throws(() => parse(oversized), /bounded string/);
  const surrogate = validResult(); surrogate.fixture.id = "\ud800";
  assert.throws(() => parse(surrogate), /bounded string/);
});

test("offline validation permits only strictly not-applicable offline usage", () => {
  const wrongStatus = validResult(); wrongStatus.usage.status = "unavailable";
  assert.throws(() => parse(wrongStatus), /offline (validation )?usage/);
  const wrongSource = validResult(); wrongSource.usage.source = "provider_receipt";
  assert.throws(() => parse(wrongSource), /offline (validation )?usage/);
  const wrongCost = validResult(); wrongCost.usage.cost.status = "unavailable";
  assert.throws(() => parse(wrongCost), /offline (validation )?usage/);
});

test("public format parsing is explicitly untrusted and cannot finalize a harness result", () => {
  const wrapped = parseUntrustedBenchmarkResult(validResult());
  assert.equal(wrapped.kind, "untrusted_benchmark_result");
  assert.equal(Object.isFrozen(wrapped.data), true);
  assert.equal(Object.hasOwn(fixtureValidator, "finalMeasuredResult"), false);
  assert.throws(() => fixtureValidator.validateFixture(wrapped), /MANIFEST_UNTRUSTED/);
});
