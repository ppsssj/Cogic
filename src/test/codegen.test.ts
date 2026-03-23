import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildPatchPreview } from "../codegen";

suite("Codegen Test Suite", () => {
  test("buildPatchPreview creates new file scaffolds", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-codegen-"));

    const result = buildPatchPreview({
      workspaceRoot: root,
      design: {
        nodes: [
          {
            id: "service",
            kind: "class",
            name: "UserService",
            exported: true,
            members: [{ kind: "method", name: "execute", returnType: "void" }],
          },
          {
            id: "repo",
            kind: "interface",
            name: "UserRepository",
            exported: true,
            members: [{ kind: "method", name: "findById", returnType: "Promise<unknown>" }],
          },
        ],
        edges: [
          {
            id: "dependsOn",
            kind: "dependsOn",
            source: "service",
            target: "repo",
          },
        ],
      },
    });

    assert.strictEqual(result.patches.length, 2);

    const servicePatch = result.patches.find((patch) =>
      patch.preview.filePath.endsWith("user-service.ts"),
    );
    const repoPatch = result.patches.find((patch) =>
      patch.preview.filePath.endsWith("user-repository.ts"),
    );

    assert.ok(servicePatch);
    assert.ok(repoPatch);
    assert.ok(
      servicePatch?.preview.diffText.includes("class UserService"),
      "service scaffold should include class declaration",
    );
    assert.ok(
      servicePatch?.preview.diffText.includes("UserRepository"),
      "service scaffold should include repository dependency",
    );
  });

  test("buildPatchPreview appends into existing file when filePath is explicit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-codegen-"));
    const targetFile = path.join(root, "existing.ts");
    fs.writeFileSync(targetFile, "export const sentinel = true;\n", "utf8");

    const result = buildPatchPreview({
      workspaceRoot: root,
      design: {
        nodes: [
          {
            id: "fn",
            kind: "function",
            name: "makeUser",
            filePath: targetFile,
            exported: true,
            signature: {
              params: [{ name: "input", type: "unknown" }],
              returnType: "void",
            },
          },
        ],
        edges: [],
      },
    });

    assert.strictEqual(result.patches.length, 1);
    assert.strictEqual(result.patches[0]?.preview.kind, "update");
    assert.ok(result.patches[0]?.preview.diffText.includes("function makeUser"));
  });

  test("buildPatchPreview rejects duplicate declarations in an existing file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-codegen-"));
    const targetFile = path.join(root, "existing.ts");
    fs.writeFileSync(
      targetFile,
      "export class UserService {}\n",
      "utf8",
    );

    assert.throws(
      () =>
        buildPatchPreview({
          workspaceRoot: root,
          design: {
            nodes: [
              {
                id: "service",
                kind: "class",
                name: "UserService",
                filePath: targetFile,
                exported: true,
              },
            ],
            edges: [],
          },
        }),
      /Duplicate declaration blocked/,
    );
  });
});
