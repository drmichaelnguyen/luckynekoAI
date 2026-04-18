const path = require("path");

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /** Native module used for image compression in server actions. */
  serverExternalPackages: ["sharp"],
  /**
   * If a parent folder (e.g. Desktop) also has a package-lock.json, Next can infer the wrong
   * workspace root for output file tracing and warn on `next start`. Pin root to this app.
   */
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = withPWA(nextConfig);
