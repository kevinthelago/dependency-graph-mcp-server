import type { LanguageAnalyzer } from "./types.js";

export interface AnalyzerRegistry {
  all(): LanguageAnalyzer[];
  forExtension(ext: string): LanguageAnalyzer | undefined;
}

export declare function getAnalyzerForFile(filePath: string): LanguageAnalyzer | undefined;
export declare function registerAnalyzer(analyzer: LanguageAnalyzer): void;

export class AnalyzerRegistry {
  private byId = new Map<string, LanguageAnalyzer>();
  private byExt = new Map<string, LanguageAnalyzer>();

  register(analyzer: LanguageAnalyzer): void {
    this.byId.set(analyzer.id, analyzer);
    for (const ext of analyzer.extensions) {
      this.byExt.set(ext.toLowerCase(), analyzer);
    }
  }

  forExtension(ext: string): LanguageAnalyzer | undefined {
    return this.byExt.get(ext.toLowerCase());
  }

  forId(id: string): LanguageAnalyzer | undefined {
    return this.byId.get(id);
  }

  all(): LanguageAnalyzer[] {
    return [...this.byId.values()];
  }
}
