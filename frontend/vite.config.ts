import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// The backend checks `Origin` on every non-GET request, so the proxy keeps the
// browser's origin (changeOrigin: false). /api/stream is Server-Sent Events and
// must not be buffered.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyRes", (res) => {
            if (res.headers["content-type"]?.startsWith("text/event-stream")) {
              res.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
