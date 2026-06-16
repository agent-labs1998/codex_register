import {defineConfig} from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs"],
    outDir: "bundle",
    clean: true,
    splitting: false,
    sourcemap: false,
    dts: false,
    minify: false,
    target: "node18",
    platform: "node",
    external: [],
    noExternal: [],
    banner: {},
    footer: {},
    esbuildOptions(options) {
        options.conditions = ["node"];
    },
});
