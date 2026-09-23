export interface TokenCounter {
  countTokens(text: string): number;
}

export class SimpleTokenCounter implements TokenCounter {
  countTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }
}

export const tokenCounter = new SimpleTokenCounter();
