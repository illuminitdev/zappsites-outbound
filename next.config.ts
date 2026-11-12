import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mail and IMAP libraries use Node built-ins; keep them out of the bundle.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
  experimental: {
    // Reuse a page you visited in the last 30s instead of refetching it. Saving a form
    // (server action + revalidatePath / redirect) still refreshes the data straight away.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
