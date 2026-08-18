import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Email",
    category: "feature",
    purpose: "Handles transactional email delivery and templates.",
    genericTerms: [
      "resend", "nodemailer", "@sendgrid/mail", "sendgrid", "mailgun",
      "postmark", "@postmark", "aws-sdk/ses", "@aws-sdk/client-ses",
      "react-email", "@react-email",
      "email", "mailer", "smtp",
    ],
  },
  {
    name: "Resend",
    category: "provider",
    importNames: ["resend"],
  },
];