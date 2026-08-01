import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives inside the AudioApi repo, and there are lockfiles above it in the tree.
  // Pin the workspace root so Turbopack never infers a directory outside the project.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
