// Make sure to replace the values with your actual API key and model

// USING ANTHROPIC Claude Opus 4.6 is strongly recommended for best results

export const config = {
  aiSdk: {
    // The base URL for the AI SDK, leave blank for e.g. openai
    baseUrl: "https://openrouter.ai/api/v1",

    // Your API key for provider, if using Ollama enter "ollama" here
    apiKey: "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",

    // The model to use, e.g., "gpt-4", "gpt-3.5-turbo", or "ollama/llama2"
    model: "anthropic/claude-opus-4-6",
  },
} as const;
