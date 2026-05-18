import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: path.join(__dirname),
  webpack: (config, { isServer }) => {
    // Miden SDK 0.14 worker bundle resolves the WASM via
    //   new URL("assets/miden_client_web.wasm", import.meta.url)
    // Default `asset/resource` emission lands it at
    //   /_next/static/media/miden_client_web.<hash>.wasm
    // which Safari workers can't always re-fetch (module-transfer
    // limitation). Emit a copy at the path the worker expects.
    if (!isServer) {
      config.module.rules.unshift({
        test: /miden_client_web\.wasm$/,
        type: "asset/resource",
        generator: {
          filename: "static/chunks/assets/miden_client_web.wasm",
        },
      });
    }
    return config;
  },
};

export default nextConfig;
