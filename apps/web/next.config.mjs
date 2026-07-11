/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@merism/contracts"],
  serverExternalPackages: ["node-appwrite"],
  webpack(config, { isServer }) {
    if (isServer) {
      config.optimization.splitChunks = false;
    }
    return config;
  },
};

export default nextConfig;
