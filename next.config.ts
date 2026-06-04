import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Canonicalize the legacy .vercel.app alias to the apex brand domain.
    // Exact host match so preview deploys (offer-shield-template-git-*.vercel.app)
    // keep resolving directly — only the production alias is redirected.
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "offer-shield-template.vercel.app" }],
        destination: "https://considerationforchange.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
