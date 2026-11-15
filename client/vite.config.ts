/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/**
 * Serves ONNX Runtime's WebAssembly files from our own origin under /ort/ (dev) and emits
 * them into the build — no third-party CDN at runtime, and they're cacheable offline.
 */
function onnxRuntimeAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const dist = path.dirname(require.resolve("onnxruntime-web/wasm"));
  const files = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];
  return {
    name: "onnxruntime-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0]?.split("/ort/")[1];
        if (!name || !files.includes(name)) return next();
        res.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        fs.createReadStream(path.join(dist, name)).pipe(res);
      });
    },
    generateBundle(_opts, bundle) {
      for (const f of files) this.emitFile({ type: "asset", fileName: `ort/${f}`, source: fs.readFileSync(path.join(dist, f)) });
      // ORT also references its wasm via import.meta.url, which makes Vite emit a hashed duplicate
      // we never load (wasmPaths points at /ort/). Drop it to keep the deploy small.
      for (const name of Object.keys(bundle)) if (/^assets\/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

/**
 * Dev server runs over HTTPS by default (self-signed) because mobile browsers only expose
 * the camera on secure origins — this is what lets a phone on the same Wi-Fi open
 * https://<your-LAN-IP>:5173 and use its camera. Set DEV_HTTPS=false to disable.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const https = env.DEV_HTTPS !== "false";
  const serverTarget = env.DEV_SERVER_TARGET || "http://localhost:3001";
  // Sub-path the app is served from, e.g. "/ar-object-hunt/" on GitHub Pages. Must end with "/".
  const base = env.VITE_BASE || "/";

  return {
    base,
    plugins: [
      react(),
      onnxRuntimeAssets(),
      ...(https ? [basicSsl()] : []),
      VitePWA({
        // We register the service worker ourselves (src/pwa.ts) to control WHEN updates apply.
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["icons/favicon.svg", "icons/apple-touch-icon.png"],
        manifest: {
          id: base,
          name: "AR Object Hunt",
          short_name: "Object Hunt",
          description: "Real-time two-player AR hide-and-seek. Find your opponent's object before the sweep closes.",
          start_url: base,
          scope: base,
          display: "fullscreen",
          display_override: ["fullscreen", "standalone"],
          orientation: "portrait",
          background_color: "#04060c",
          theme_color: "#04060c",
          categories: ["games", "entertainment"],
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: "192x192", type: "image/png" },
            { src: `${base}icons/icon-512.png`, sizes: "512x512", type: "image/png" },
            { src: `${base}icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // Models (~20 MB) and the inference runtime are fetched on first use, then cached.
          globIgnores: ["**/models/**", "**/ort/**"],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => /\/(models|ort)\//.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "aoh-vision-v1",
                expiration: { maxEntries: 8 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
          navigateFallback: `${base}index.html`,
          // Never let the service worker intercept realtime or API traffic.
          navigateFallbackDenylist: [/\/socket\.io\//, /\/api\//],
          cleanupOutdatedCaches: true,
        },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/socket.io": { target: serverTarget, ws: true, changeOrigin: true },
        "/api": { target: serverTarget, changeOrigin: true },
      },
    },
    preview: {
      host: true,
      port: 4173,
      proxy: {
        "/socket.io": { target: serverTarget, ws: true, changeOrigin: true },
        "/api": { target: serverTarget, changeOrigin: true },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "1.0.0"),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    worker: { format: "es" },
    optimizeDeps: { exclude: ["onnxruntime-web"] },
    build: {
      target: ["es2020", "safari15", "chrome100"],
      sourcemap: true,
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
