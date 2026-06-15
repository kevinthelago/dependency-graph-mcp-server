import { formatNumber, Formatter } from './utils';
import type { FormatOptions } from './utils';

export function run(): void {
  const opts: FormatOptions = { prefix: '$' };
  const f = new Formatter(opts);
  console.log(f.format(1234.5));
  console.log(formatNumber(3.14159, 3));
}

export const VERSION = '1.0.0';
