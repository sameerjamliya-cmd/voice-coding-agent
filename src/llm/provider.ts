import type { NormalizedMessage, NormalizedTool, NormalizedResponse } from "./types.js";

export interface LLMProvider {
  name: string;
  complete(
    messages: NormalizedMessage[],
    tools: NormalizedTool[],
    system: string
  ): Promise<NormalizedResponse>;
}
