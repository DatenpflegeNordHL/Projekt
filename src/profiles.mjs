import { isAbsolute } from "node:path";
import { buildChildEnv, resolveRealCodex } from "./launcher.mjs";

const ALLOWED_REASONING = new Set(["low", "medium", "high"]);
const ALLOWED_SANDBOXES = new Set(["read-only"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function profileValues(profile, sourceEnv) {
  switch (profile) {
    case "builder":
      return {
        model: sourceEnv.CODEXLOOPER_BUILDER_MODEL || "openai/gpt-5.6-terra",
        reasoning: sourceEnv.CODEXLOOPER_BUILDER_REASONING || "medium",
      };
    case "reviewer":
      return {
        model: sourceEnv.CODEXLOOPER_REVIEW_MODEL || "openai/gpt-5.6-sol",
        reasoning: sourceEnv.CODEXLOOPER_REVIEW_REASONING || "medium",
      };
    default:
      fail("CODEXLOOPER_PROFILE_REJECTED", `Unknown model profile: ${profile}`);
  }
}

export function prepareProfileLaunch(
  profile,
  {
    json = false,
    multiAgent = false,
    sandbox = "read-only",
    outputSchema,
    sourceEnv = process.env,
    projectRoot = process.cwd(),
  } = {},
) {
  const values = profileValues(profile, sourceEnv);
  if (!ALLOWED_REASONING.has(values.reasoning)) {
    fail("CODEXLOOPER_REASONING_REJECTED", `Reasoning effort is not allowed: ${values.reasoning}`);
  }
  if (!ALLOWED_SANDBOXES.has(sandbox)) {
    fail("CODEXLOOPER_SANDBOX_REJECTED", `Sandbox is not allowed: ${sandbox}`);
  }
  if (
    outputSchema !== undefined &&
    (typeof outputSchema !== "string" || !isAbsolute(outputSchema) || outputSchema.includes("\0"))
  ) {
    fail("CODEXLOOPER_OUTPUT_SCHEMA_REJECTED", "Output schema must be an absolute path");
  }

  const allowedModels = new Set(
    (sourceEnv.CODEXLOOPER_ALLOWED_MODELS || "openai/gpt-5.6-terra,openai/gpt-5.6-sol")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedModels.has(values.model)) {
    fail("CODEXLOOPER_MODEL_REJECTED", `Model is not allowed: ${values.model}`);
  }

  const args = ["exec"];
  if (json) args.push("--json");
  if (outputSchema) args.push("--output-schema", outputSchema);
  args.push("--ephemeral", "--sandbox", sandbox);
  if (multiAgent) {
    args.push("-c", "features.multi_agent=true");
  }
  args.push(
    "-c",
    `model=${JSON.stringify(values.model)}`,
    "-c",
    `model_reasoning_effort=${values.reasoning}`,
    "-c",
    "stream_idle_timeout_ms=3600000",
  );

  return {
    command: resolveRealCodex(sourceEnv),
    args,
    env: buildChildEnv(sourceEnv, projectRoot),
    metadata: {
      profile,
      model: values.model,
      reasoning: values.reasoning,
      sandbox,
      json,
      multi_agent: multiAgent,
      output_schema: outputSchema || null,
    },
  };
}
