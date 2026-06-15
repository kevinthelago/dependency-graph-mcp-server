/** Formats a number to a fixed number of decimal places. */
export function formatNumber(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

export interface FormatOptions {
  prefix?: string;
  suffix?: string;
}

export type FormattedValue = string;

export const DEFAULT_DECIMALS = 2;

export class Formatter {
  constructor(private readonly opts: FormatOptions = {}) {}

  format(n: number): FormattedValue {
    const s = formatNumber(n);
    return `${this.opts.prefix ?? ''}${s}${this.opts.suffix ?? ''}`;
  }
}

export enum RoundingMode {
  Floor = 'floor',
  Ceil = 'ceil',
  Round = 'round',
}
