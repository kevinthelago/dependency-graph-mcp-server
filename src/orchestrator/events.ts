import { EventEmitter } from "node:events";

export interface OrchestratorEvents {
  invalidate: (nodeIds: string[]) => void;
}

export class InvalidationEmitter extends EventEmitter {
  onInvalidate(listener: (nodeIds: string[]) => void): this {
    return this.on("invalidate", listener);
  }

  offInvalidate(listener: (nodeIds: string[]) => void): this {
    return this.off("invalidate", listener);
  }

  emit(event: "invalidate", nodeIds: string[]): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  emitInvalidation(nodeIds: string[]): void {
    if (nodeIds.length > 0) {
      this.emit("invalidate", nodeIds);
    }
  }
}
