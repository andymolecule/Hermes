/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hermes/common", "@hermes/ipfs"],
  webpack: (config, { isServer }) => {
    // Suppress warnings from MetaMask SDK and WalletConnect dependencies
    // that try to resolve React Native / optional modules at build time
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    // Ignore known optional peer dependency warnings
    config.ignoreWarnings = [
      { module: /@metamask\/sdk/ },
      { module: /pino/ },
    ];
    return config;
  },
};

export default nextConfig;
