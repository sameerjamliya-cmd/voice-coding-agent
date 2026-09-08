import type { LLMProvider } from "./provider.js";
import { ClaudeProvider } from "./claude-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

// Picks a provider based on which API key is present in the environment.
// Adding a new provider later means one new `if` branch here and one new
// provider file — no changes to loop.ts, agent/types.ts, or the tool
// registry.
export function selectProvider(): LLMProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
  }

  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider(process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
  }

  throw new Error(
    "No supported LLM API key found in the environment. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (check your .env file)."
  );
}
