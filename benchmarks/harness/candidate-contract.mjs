const CONTRACTS = Object.freeze({
  "logic-bug": Object.freeze({ entry: "src/logic.mjs", paths: Object.freeze(["src/logic.mjs"]) }),
  "syntax-build": Object.freeze({ entry: "src/entry.mjs", paths: Object.freeze(["src/entry.mjs"]) }),
  "cross-file-cause": Object.freeze({ entry: "src/consumer.mjs", paths: Object.freeze(["src/consumer.mjs", "src/producer.mjs"]) }),
});

export function candidateContract(fixture) {
  const contract = CONTRACTS[fixture];
  if (!contract) throw new Error(`BENCHMARK_CANDIDATE_CONTRACT_INVALID: ${fixture}`);
  return contract;
}
