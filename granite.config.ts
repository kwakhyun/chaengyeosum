import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  // The form and console appName must match this value exactly.
  appName: "chaengyeosum",
  brand: {
    displayName: "챙겨썸",
    primaryColor: "#3182F6",
    icon: "https://chaengyeosum-api.kwakhyun-miniapps.workers.dev/logo-light-600x600.png",
  },
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    withTitle: true,
    transparentBackground: false,
    theme: "light",
  },
  web: {
    host: "192.168.219.102",
    port: 5173,
    commands: {
      dev: "vite --host 0.0.0.0",
      build: "vite build",
    },
  },
  permissions: [],
  outdir: "dist",
});
