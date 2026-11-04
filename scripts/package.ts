import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";

export async function packageFiles(root: string): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  async function collect(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const name = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Cannot package a symbolic link: ${name}`);
      if (entry.isDirectory()) await collect(name);
      else if (/\.(ts|js|json|ps1)$/i.test(name)) files[name] = await readFile(join(root, name));
    }
  }
  for (const path of ["dist", "src", "tests", "scripts"]) await collect(path);
  for (const path of ["spindle.json", "package.json", "bun.lock", "bunfig.toml", "tsconfig.json", "README.md", "LICENSE", "CREDITS.md"]) files[path] = await readFile(join(root, path));
  return zipSync(files, { level: 6 });
}
if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const build = Bun.spawnSync([process.execPath, "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (build.exitCode) process.exit(build.exitCode);
  const manifest = await Bun.file(join(root, "spindle.json")).json(), path = join(root, "local", `LumiCache-${manifest.version}.zip`);
  await mkdir(join(root, "local"), { recursive: true }); await writeFile(path, await packageFiles(root)); console.log(`Package: ${path}`);
}
