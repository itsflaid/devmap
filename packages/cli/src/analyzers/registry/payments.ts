import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Payments",
    category: "feature",
    purpose: "Handles payment providers, billing, and transaction workflows.",
    // "checkout" is deliberately absent: a cart or point-of-sale checkout creates an order,
    // it does not prove a payment provider or billing flow.
    genericTerms: [
      "stripe", "midtrans", "xendit", "@xendit", "paypal", "braintree",
      "razorpay", "paddle", "lemonsqueezy", "lemon-squeezy",
      "payment", "billing", "invoice",
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