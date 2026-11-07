import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Private evidence archives contain historical source snapshots, not live tests.
    exclude: [...configDefaults.exclude, "**/.local/**"],
  },
});
