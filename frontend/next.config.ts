import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory.
  //
  // Without this, Turbopack walks up looking for a lockfile, escapes the repo,
  // and finds an unrelated ~/package-lock.json — then warns on every start and
  // treats the home directory as the project root.
  turbopack: {
    root: __dirname,
  },
  // Discover was folded into Parcels (single land-map experience).
  redirects() {
    return [
      {
        source: "/discover",
        destination: "/parcels",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
