import type {
  ChatEvent,
  ChatRequest,
  ModelInfo,
  ProviderAdapter,
  ProviderCapabilities,
  Usage,
} from '@ptt/core';

export interface OpenAICompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  capabilities?: Partial<ProviderCapabilities>;
}

interface OpenAIModelList {
  data?: Array<{ id?: string }>;
}

interface OpenAIDelta {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function mapUsage(raw: OpenAIDelta['usage']): Usage | undefined {
  if (!raw) return undefined;
  return {
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    totalTokens: raw.total_tokens ?? 0,
  };
}

export function parseOpenAIEvent(raw: string): ChatEvent | null {
  if (raw === '[DONE]') return { type: 'done' };

  let payload: OpenAIDelta;
  try {
    payload = JSON.parse(raw) as OpenAIDelta;
  } catch {
    return null;
  }

  const delta = payload.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    return { type: 'content', delta };
  }

  const usage = mapUsage(payload.usage);
  if (usage) return { type: 'done', usage };

  return null;
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly id: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.id = options.id;
  }

  capabilities(): ProviderCapabilities {
    return {
      chat: true,
      streaming: true,
      models: true,
      ...this.options.capabilities,
    };
  }

  private url(path: string): string {
    return `${this.options.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers.authorization = `Bearer ${this.options.apiKey}`;
    return headers;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(this.url('/models'), { headers: this.headers() });
    if (!response.ok) throw new Error(`models request failed: ${response.status}`);

    const body = (await response.json()) as OpenAIModelList;
    return (body.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => ({ id, provider: this.id }));
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatEvent> {
    const response = await fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        stream: true,
        ...(request.stop ? { stop: request.stop } : {}),
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        ...(request.chatTemplateKwargs
          ? { chat_template_kwargs: request.chatTemplateKwargs }
          : {}),
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`chat request failed: ${response.status}`);
    }
    if (!response.body) {
      throw new Error('chat response has no body');
    }

    const isStream = response.headers.get('content-type')?.includes('text/event-stream');

    if (isStream) {
      for await (const line of readLines(response.body)) {
        if (!line.startsWith('data:')) continue;
        const event = parseOpenAIEvent(line.slice(5).trim());
        if (event) yield event;
      }
      return;
    }

    const body = (await response.json()) as OpenAIDelta;
    const content = body.choices?.[0]?.delta?.content;
    if (typeof content === 'string') yield { type: 'content', delta: content };
    yield { type: 'done', usage: mapUsage(body.usage) };
  }
}
