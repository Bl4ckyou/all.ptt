import type { ProviderAdapter } from '@ptt/core';
import { createProviders, type ProviderConfig } from '@ptt/providers';

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  constructor(configs: readonly ProviderConfig[]) {
    for (const provider of createProviders(configs)) {
      this.providers.set(provider.id, provider);
    }
  }

  all(): ProviderAdapter[] {
    return [...this.providers.values()];
  }

  get(id: string): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  add(provider: ProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  remove(id: string): void {
    this.providers.delete(id);
  }
}
