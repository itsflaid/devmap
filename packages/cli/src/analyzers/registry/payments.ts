import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Payments",
    category: "feature",
    purpose: "Handles payment providers, billing, and transaction workflows.",
    genericTerms: [
      "stripe", "midtrans", "xendit", "@xendit", "paypal", "braintree",
      "razorpay", "paddle", "lemonsqueezy", "lemon-squeezy",
      "payment", "checkout", "billing", "invoice",
    ],
  },
  {
    name: "Stripe",
    category: "provider",
    importNames: ["stripe"],
  },
  {
    name: "Midtrans",
    category: "provider",
    importNames: ["midtrans"],
  },
];