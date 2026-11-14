export interface Actions {
  send(text: string): void;
  stop(): void;
  refreshModels(): Promise<void>;
  setLocale(locale: string): Promise<void>;
  setProvider(id: string): void;
  setModel(id: string): void;
}
