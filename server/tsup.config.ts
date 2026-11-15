import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source; bundle it into the server output.
  noExternal: ["@aoh/shared"],
});
