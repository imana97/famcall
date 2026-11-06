import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";

// Optional live relay access is read into memory only. Emulator users and data
// always stay in a demo-* project, never the production Firebase project.
const env = { ...process.env };
if (process.argv.includes("--live-turn")) {
  for (const name of ["CLOUDFLARE_TURN_KEY_ID", "CLOUDFLARE_TURN_API_TOKEN"]) {
    env[name] = execFileSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret=" + name,
        "--project=famcall",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  }
}
const child = spawn(
  "firebase",
  [
    "emulators:start",
    "--project",
    "demo-famcall",
    "--only",
    "auth,firestore,functions",
    "--non-interactive",
  ],
  {
    cwd: resolve(import.meta.dirname, ".."),
    env,
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
