import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and surfaces build failures through stderr.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Keep Rust-side errors visible: never swallow the terminal.
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // src-tauri is watched by cargo, not by Vite.
      ignored: ["**/src-tauri/**"],
    },
  },

  envPrefix: ["VITE_", "TAURI_ENV_"],

  build: {
    // WebView2 (Windows) and WebKitGTK (Linux) both handle modern syntax.
    target: "es2022",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Mermaid is heavy and only needed once a diagram appears.
          mermaid: ["mermaid"],
          shiki: ["shiki"],
          katex: ["katex", "rehype-katex"],
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/language",
            "@codemirror/commands",
            "@codemirror/search",
            "@codemirror/autocomplete",
            "@codemirror/lang-markdown",
          ],
          react: ["react", "react-dom"],
        },
      },
    },
  },

  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // `?raw` CSS imports have to keep their content: the HTML export embeds the
    // real stylesheets, and stubbing them would make the export tests vacuous.
    css: true,
  },
});
