import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/dbt-docs/:path(.*%7B%7B.*)',
        destination: '/dbt-docs/index.html',
      },
    ];
  },
};

export default nextConfig;
