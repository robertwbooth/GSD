import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "GSD",
        short_name: "GSD",
        description: "Tasks, lists and notes",
        theme_color: "#4772fa",
        background_color: "#ffffff",
        display: "standalone",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { navigateFallbackDenylist: [/^\/api\//], globPatterns: ["**/*.{js,css,html,svg}"] },
    }),
  ],
  build: { target: "es2022" },
  server: { proxy: { "/api": "http://localhost:8080" } },
});
