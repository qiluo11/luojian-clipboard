import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Opt-in test server only. Production vite.config.ts never loads these aliases.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@tauri-apps\/.+$/,
        replacement: fileURLToPath(new URL("./mock.ts", import.meta.url)),
      },
    ],
  },
  server: { host: "0.0.0.0", port: 5175, strictPort: true, allowedHosts: true },
});
