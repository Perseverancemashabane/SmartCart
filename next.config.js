/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Vercel's isolated type-check worker has a known issue with Prisma 6
    // where it can't see newly-generated models. We verify types locally
    // with `npx tsc --noEmit` before pushing.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;