import { execFileSync } from "node:child_process";

// Initialize fresh clones without resetting submodules already being worked on.
const status = execFileSync("git", ["submodule", "status"], {
  encoding: "utf8",
});
const missing = status
  .split(/\r?\n/)
  .filter((line) => line.startsWith("-"))
  .map((line) => line.trim().split(/\s+/)[1]);

if (missing.length) {
  execFileSync("git", ["submodule", "update", "--init", "--", ...missing], {
    stdio: "inherit",
  });
}
