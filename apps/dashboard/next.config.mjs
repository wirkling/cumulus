/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared-types ships as TS source; let Next transpile the workspace package.
  transpilePackages: ['@cumulus/shared-types'],
  // The package uses ESM `.js`-extension imports that map to `.ts` source;
  // teach webpack to follow them (tsx/Vite do this via bundler resolution).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
