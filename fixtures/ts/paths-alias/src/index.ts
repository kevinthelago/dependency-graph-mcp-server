import { formatDate } from '@lib/format';
import { clamp } from '@utils';

export function process(date: Date, value: number): string {
  const clamped = clamp(value, 0, 100);
  return `${formatDate(date)}: ${clamped}`;
}
