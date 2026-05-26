import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import obfuscator from "vite-plugin-javascript-obfuscator";

// Production-only JavaScript obfuscation.
// Heavy settings tuned to stay correct + tolerable runtime cost.
const obfuscatorOptions = {
  compact: true,
  simplify: true,
  // Control-flow flattening — the big one. Set <1 so not every block is wrapped.
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  // Dead code injection bloats the bundle. Keep it moderate.
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  // Identifier mangling — short scrambled names.
  identifierNamesGenerator: "mangled-shuffled",
  numbersToExpressions: true,
  // Self-defending wraps code so it breaks if reformatted/beautified.
  selfDefending: true,
  // String obfuscation
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.75,
  stringArrayEncoding: ["base64"],
  stringArrayShuffle: true,
  stringArrayThreshold: 0.85,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  // Do NOT enable debugProtection — it freezes browsers when DevTools open
  // and breaks ordinary users behind a corporate proxy.
  debugProtection: false,
  disableConsoleOutput: false,
  target: "browser",
};

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [
    react(),
    // Apply heavy obfuscation only to OUR source files in production.
    // Dependencies (in node_modules) are left alone — they're already minified
    // and re-obfuscating them slows the runtime a lot.
    mode === "production" && obfuscator({
      include: ["src/**/*.js", "src/**/*.jsx"],
      exclude: ["node_modules/**"],
      apply: "build",
      debugger: false,
      options: obfuscatorOptions,
    }),
  ].filter(Boolean),

  build: {
    sourcemap: false,
    // Terser gives smaller output than esbuild + we control dead-code removal.
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
        // Split big dependencies into separate chunks so each tool only loads
        // what it needs and updates to one lib don't invalidate everything.
        manualChunks: {
          "react-core": ["react", "react-dom"],
          "antd": ["antd", "dayjs", "date-fns"],
          "echarts": ["echarts", "echarts-for-react"],
          "recharts": ["recharts"],
          "motion": ["framer-motion"],
          "icons": ["lucide-react"],
          "datepicker": ["react-datepicker"],
        },
        // Cache-busting hashes
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
  },

  server: {
    port: 5173,
    strictPort: false,
  },
}));
