import { expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { resolve } from "node:path";
import { packageFiles } from "../scripts/package";
test("installable archive contains matching manifest, bundles, source and licenses, and excludes local data", async () => {
  const files = unzipSync(await packageFiles(resolve(import.meta.dir, "..")));
  const manifest = JSON.parse(strFromU8(files["spindle.json"])), pkg = JSON.parse(strFromU8(files["package.json"]));
  expect(manifest.identifier).toBe("lumicache"); expect(manifest.version).toBe(pkg.version);
  expect(manifest.permissions).toEqual(["interceptor", "generation", "chats", "chat_mutation", "presets", "characters", "personas", "world_books", "regex_scripts"]);
  for (const name of [manifest.entry_backend, manifest.entry_frontend, "src/backend.ts", "src/frontend.ts", "LICENSE", "CREDITS.md", "bun.lock", "scripts/deploy.ps1"]) expect(files[name]?.length).toBeGreaterThan(0);
  expect(Object.keys(files).some(path => path.startsWith("local/") || path.startsWith("node_modules/") || path.endsWith(".log") || path.includes(".env"))).toBe(false);
  expect(strFromU8(files["dist/backend.js"])).toContain("required: true");
});
