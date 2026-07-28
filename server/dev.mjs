import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["server/index.mjs"], {
    stdio: "inherit",
    env: process.env,
  }),
  spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev:web"],
    {
      stdio: "inherit",
      env: process.env,
    },
  ),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`개발 프로세스가 종료됐어요. (${signal ?? code})`);
      stop(code ?? 1);
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

