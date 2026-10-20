import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";

it("the Next build process respects the caller's memory limit", () => {
  const directory = mkdtempSync(join(tmpdir(), "autogpt-build-memory-"));
  try {
    const resultPath = join(directory, "result.json");
    const preloadPath = join(directory, "probe.cjs");
    writeFileSync(
      preloadPath,
      `if (process.argv[1].replaceAll('\\\\', '/').endsWith('/next/dist/bin/next')) {
        require('node:fs').writeFileSync(process.env.BUILD_MEMORY_PROBE, JSON.stringify({
          heapLimit: require('node:v8').getHeapStatistics().heap_size_limit,
          options: process.env.NODE_OPTIONS,
          arguments: process.argv.slice(2),
        }));
      }`,
    );
    const options = `--max-old-space-size=128 --max-semi-space-size=8 --require=${JSON.stringify(preloadPath)}`;
    const result = spawnSync(
      process.platform === "win32" ? "pnpm.cmd run build --help" : "pnpm",
      process.platform === "win32" ? [] : ["run", "build", "--help"],
      {
        encoding: "utf8",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          NODE_OPTIONS: options,
          BUILD_MEMORY_PROBE: resultPath,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(readFileSync(resultPath, "utf8")) as {
      options: string;
      heapLimit: number;
      arguments: string[];
    };
    assert.equal(probe.options, options);
    assert.ok(probe.heapLimit < 200 * 1024 * 1024);
    assert.deepEqual(probe.arguments, ["build", "--help"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
