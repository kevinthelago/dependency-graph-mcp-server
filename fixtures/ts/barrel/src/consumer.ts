import { alpha, beta } from './index';

export function consume(): string {
  return `${alpha()}-${beta()}`;
}
