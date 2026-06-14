import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: {
    index: "src/index.ts",
  },
  clean: true,
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
      skipLibCheck: true,
      types: [],
    },
  },
  format: ["cjs", "esm"],
  ...options,
}));
