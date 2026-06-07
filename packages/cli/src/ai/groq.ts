import { DevmapError } from "../utils/errors.js";

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

export async function validateGroqApiKey(apiKey: string): Promise<void> {
  let response: Response;

  try {
    response = await fetch(GROQ_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
  } catch {
    throw new DevmapError(
      "Could not connect to Groq.",
      "Check your internet connection and run devmap init again."
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new DevmapError(
      "The Groq API key is invalid.",
      "Create or copy a valid key from https://console.groq.com/keys."
    );
  }

  if (!response.ok) {
    throw new DevmapError(
      `Groq validation failed with HTTP ${response.status}.`,
      "Try again shortly or check https://status.groq.com."
    );
  }
}
