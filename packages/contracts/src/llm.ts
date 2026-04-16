export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  responseFormat?: "text" | "json";
  temperature?: number;
}

export interface LlmResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
