import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mail and IMAP libraries use Node built-ins; keep them out of the bundle.
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer"],
};

export default nextConfig;
