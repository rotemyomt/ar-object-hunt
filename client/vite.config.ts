/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

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
      ...(https ? [basicSsl()] : []),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
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
