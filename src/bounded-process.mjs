import { spawn } from "node:child_process";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail("CODEXLOOPER_PROCESS_BOUND_INVALID", `${label} must be a positive integer`);
  }
  return parsed;
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  }
}

export async function spawnBoundedProcess(command, args, {
  cwd,
  env,
  stdio = "inherit",
  timeoutMs,
  killGraceMs = 2_000,
  label = "Child process",
} = {}) {
  const timeout = positiveInteger(timeoutMs, "Process timeout");
  const grace = positiveInteger(killGraceMs, "Kill grace period");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio,
    detached: true,
  });
  let timedOut = false;
  let hardKillTimer = null;
  const signalHandlers = new Map();
  const forward = (signal) => signalProcessGroup(child, signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => forward(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    forward("SIGTERM");
    hardKillTimer = setTimeout(() => forward("SIGKILL"), grace);
    hardKillTimer.unref?.();
  }, timeout);
  timeoutTimer.unref?.();

  try {
    return await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        if (timedOut) {
          const error = new Error(`${label} exceeded its duration budget`);
          error.code = "CODEXLOOPER_BUDGET_DURATION_EXCEEDED";
          error.exit_code = code;
          error.signal = signal;
          rejectExit(error);
          return;
        }
        if (signal) {
          const error = new Error(`${label} terminated by ${signal}`);
          error.code = "CODEXLOOPER_CHILD_SIGNALLED";
          error.signal = signal;
          rejectExit(error);
          return;
        }
        resolveExit(code ?? 1);
      });
    });
  } finally {
    clearTimeout(timeoutTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}
