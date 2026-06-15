import { EventEmitter } from 'node:events';

/**
 * Typed event emitter for graph invalidation signals.
 *
 * Consumers call onInvalidate(listener) to subscribe. After each incremental
 * update (processIncrementalBatch + reresolveOneDegree), the caller should
 * collect all changed nodeIds and call emitInvalidation() once, so caches
 * (e.g. get_stats result cache) can discard stale results.
 */
export class InvalidationEmitter extends EventEmitter {
  onInvalidate(listener: (nodeIds: string[]) => void): this {
    return this.on('invalidate', listener);
  }

  offInvalidate(listener: (nodeIds: string[]) => void): this {
    return this.off('invalidate', listener);
  }

  override emit(event: 'invalidate', nodeIds: string[]): boolean;
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /** Emit only when there is something to invalidate. */
  emitInvalidation(nodeIds: string[]): void {
    if (nodeIds.length > 0) {
      this.emit('invalidate', nodeIds);
    }
  }
}
