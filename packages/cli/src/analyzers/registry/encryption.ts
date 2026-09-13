import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "Encryption",
    category: "feature",
    purpose: "Handles data-at-rest encryption and decryption.",
    genericTerms: [
      "node:crypto", "crypto-js", "tweetnacl", "libsodium", "@noble/ciphers",
      "aes", "aes-256-gcm", "cipher", "encrypt", "decrypt", "encryption",
    ],
  },
];
