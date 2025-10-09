// build.js
const esbuild = require("esbuild");

esbuild
  .build({
    outbase: "dist-server",
    outfile: "dist-server/server.js",
    entryPoints: ["server/server.js"], // Your entry file
    bundle: true,
    minify: true,
    logLevel: "info",
    drop: ["debugger"], // Remove debugger
    sourcemap: true,
    platform: "node",
    target: "node18", // Adjust to your Node version
    external: ["msgpackr", "msgpackr-extract"], // Add packages to exclude from bundling
  })
  .then(() => {
    console.log("✓ Server Build complete");
  })
  .catch(() => process.exit(1));
