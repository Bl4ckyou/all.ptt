import { describe, expect, it } from 'vitest';
import { parseOpenAIEvent } from './openai-compatible.js';

describe('parseOpenAIEvent', () => {
  it('reads a content delta', () => {
    const raw = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    expect(parseOpenAIEvent(raw)).toEqual({ type: 'content', delta: 'hi' });
  });

  it('ends the stream on [DONE]', () => {
    expect(parseOpenAIEvent('[DONE]')).toEqual({ type: 'done' });
  });

  it('reads usage when present', () => {
    const raw = JSON.stringify({
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    expect(parseOpenAIEvent(raw)).toEqual({
      type: 'done',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });

  it('ignores malformed data and empty deltas', () => {
    expect(parseOpenAIEvent('not json')).toBeNull();
    expect(parseOpenAIEvent(JSON.stringify({ choices: [{ delta: { content: '' } }] }))).toBeNull();
  });
});
