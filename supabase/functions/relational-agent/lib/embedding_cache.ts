export class EmbeddingCache {
  private cache: Map<string, number[]> = new Map();
  private hits = 0;
  private misses = 0;

  private getKey(label: string, category: string): string {
    return `${label.toLowerCase().trim()}|${category.toLowerCase().trim()}`;
  }

  get(label: string, category: string): number[] | null {
    const key = this.getKey(label, category);
    const value = this.cache.get(key);

    if (value) {
      this.hits++;
      console.log(
        `[EmbeddingCache] HIT: "${label}" (${category}) - Total hits: ${this.hits}`,
      );
      return value;
    }

    this.misses++;
    return null;
  }

  set(label: string, category: string, embedding: number[]): void {
    const key = this.getKey(label, category);
    this.cache.set(key, embedding);
    console.log(
      `[EmbeddingCache] SET: "${label}" (${category}) - Cache size: ${this.cache.size}`,
    );
  }

  has(label: string, category: string): boolean {
    return this.cache.has(this.getKey(label, category));
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log("[EmbeddingCache] CLEARED");
  }

  getStats(): { hits: number; misses: number; size: number; hitRate: string } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) : "0.0";

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: `${hitRate}%`,
    };
  }

  logStats(): void {
    const stats = this.getStats();
    console.log(
      `[EmbeddingCache] STATS - Hits: ${stats.hits}, Misses: ${stats.misses}, Size: ${stats.size}, Hit Rate: ${stats.hitRate}`,
    );
  }
}
