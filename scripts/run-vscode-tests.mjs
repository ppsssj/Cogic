import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const ROOT_DIR = process.cwd();
const TEST_OUTPUT_DIR = path.join(ROOT_DIR, "out", "test");
const TEST_RUNNER_PATH = path.join(
  ROOT_DIR,
  "node_modules",
  "@vscode",
  "test-cli",
  "out",
  "runner.cjs",
);
const TEST_VERSION = process.env.VSCODE_TEST_VERSION ?? "stable";

async function collectTestFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(fullPath);
      }

      return entry.name.endsWith(".test.js") ? [fullPath] : [];
    }),
  );

  return files.flat().sort((a, b) => a.localeCompare(b));
}

async function findProductJson(vscodeExecutablePath) {
  const installDir = path.dirname(vscodeExecutablePath);
  const directCandidate = path.join(installDir, "resources", "app", "product.json");

  try {
    await fs.access(directCandidate);
    return directCandidate;
  } catch {
    // Fall through to commit-directory layout used by Windows archive builds.
  }

  const entries = await fs.readdir(installDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const candidate = path.join(
      installDir,
      entry.name,
      "resources",
      "app",
      "product.json",
    );

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep searching.
    }
  }

  throw new Error(`Unable to locate product.json under ${installDir}`);
}

async function patchWindowsUpdateMutexCheck(vscodeExecutablePath) {
  if (process.platform !== "win32") return;

  const productJsonPath = await findProductJson(vscodeExecutablePath);
  const productJson = JSON.parse(await fs.readFile(productJsonPath, "utf8"));
  const desiredMutexName = productJson.win32MutexName?.endsWith("-vscode-test")
    ? productJson.win32MutexName
    : `${productJson.win32MutexName}-vscode-test`;

  if (
    productJson.win32VersionedUpdate === false &&
    productJson.win32MutexName === desiredMutexName
  ) {
    return;
  }

  productJson.win32VersionedUpdate = false;
  if (typeof productJson.win32MutexName === "string" && productJson.win32MutexName.length > 0) {
    productJson.win32MutexName = desiredMutexName;
  }
  await fs.writeFile(productJsonPath, `${JSON.stringify(productJson, null, "\t")}\n`, "utf8");
  console.log(`[vscode-test] patched update mutex check in ${productJsonPath}`);
}

async function main() {
  const testFiles = await collectTestFiles(TEST_OUTPUT_DIR);
  if (testFiles.length === 0) {
    throw new Error(`No compiled test files found under ${TEST_OUTPUT_DIR}`);
  }

  const vscodeExecutablePath = await downloadAndUnzipVSCode(TEST_VERSION);
  await patchWindowsUpdateMutexCheck(vscodeExecutablePath);

  const exitCode = await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: ROOT_DIR,
    extensionTestsPath: TEST_RUNNER_PATH,
    extensionTestsEnv: {
      ELECTRON_RUN_AS_NODE: undefined,
      VSCODE_TEST_OPTIONS: JSON.stringify({
        colorDefault: true,
        files: testFiles,
        mochaOpts: {
          timeout: 20000,
          ui: "tdd",
        },
        preload: [],
      }),
    },
  });

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
