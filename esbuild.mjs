import * as esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");

const context = await esbuild.context({
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  outfile: "dist/extension.js",
  sourcemap: true,
  target: "node20",
});

if (watchMode) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
