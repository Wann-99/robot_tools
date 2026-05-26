import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import obfuscator from "vite-plugin-javascript-obfuscator";

// Obfuscation runs on every production build by default.
// To skip it locally:  $env:NO_OBFUSCATE=1; npm run build
const ENABLE_OBFUSCATION = process.env.NO_OBFUSCATE !== "1";

// Settings tuned to leave Rollup's dynamic-import paths and asset URLs intact.
// Anything string-related that could break module resolution is OFF.
const obfuscatorOptions = {
  compact: true,
  simplify: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: "mangled-shuffled",
  numbersToExpressions: true,
  // String obfuscation: kept, but encoded to keep them recognisable as strings;
  // splitStrings & stringArrayCallsTransform are OFF because they break ESM
  // dynamic-import URL rewrites done by Vite/Rollup.
  stringArray: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.7,
  stringArrayEncoding: ["base64"],
  stringArrayCallsTransform: false,
  splitStrings: false,
  transformObjectKeys: false,
  // Patterns the obfuscator MUST leave alone.
  reservedStrings: [
    "^\\./", "^\\.\\./", "^/assets/", "^https?://",
    "\\.js$", "\\.mjs$", "\\.css$", "\\.svg$", "\\.png$", "\\.json$", "\\.wasm$",
  ],
  unicodeEscapeSequence: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  target: "browser",
};

export default defineConfig(({ mode }) => ({
  base: "/",
  plugins: [
    react(),
    (mode === "production" && ENABLE_OBFUSCATION) && obfuscator({
      include: ["src/**/*.js", "src/**/*.jsx"],
      exclude: ["node_modules/**"],
      apply: "build",
      debugger: false,
      options: obfuscatorOptions,
    }),
  ].filter(Boolean),

  build: {
    sourcemap: false,
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.info", "console.debug"],
      },
      format: { comments: false },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          "react-core": ["react", "react-dom"],
          "antd": ["antd", "dayjs", "date-fns"],
          "echarts": ["echarts", "echarts-for-react"],
          "recharts": ["recharts"],
          "motion": ["framer-motion"],
          "icons": ["lucide-react"],
          "datepicker": ["react-datepicker"],
        },
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1000,
  },

  server: {
    port: 5173,
    strictPort: false,
    hmr: { host: "localhost" },
  },
}));
