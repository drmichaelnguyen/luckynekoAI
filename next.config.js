const path = require("path");

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: true,
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
  /**
   * Default Server Action body limit is 1MB; chat uploads allow much larger images/PDFs
   * (see `assertUploadSize`). Without this, multipart sends often fail before `handleChatInput` runs.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

module.exports = withPWA(nextConfig);
