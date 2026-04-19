import "server-only";

import nodemailer from "nodemailer";

type MailArgs = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSecure(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function getTransportConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.MAIL_FROM?.trim();

  if (!host || !user || !pass || !from) {
    return null;
  }

  const port = parsePort(process.env.SMTP_PORT, 587);
  const secure = parseSecure(process.env.SMTP_SECURE, port === 465);

  return {
    host,
    port,
    secure,
    from,
    auth: { user, pass },
  };
}

export function isMailConfigured(): boolean {
  return getTransportConfig() !== null;
}

export async function sendEmail(args: MailArgs): Promise<void> {
  const config = getTransportConfig();
  if (!config) {
    throw new Error("SMTP is not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  await transporter.sendMail({
    from: config.from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });
}
