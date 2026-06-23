import { EventEmitter } from 'node:events';
import type { ProgressEvent } from '@ringq/shared';

export const runEvents = new EventEmitter();
runEvents.setMaxListeners(0);

export function emitProgress(ev: ProgressEvent): void {
  runEvents.emit(ev.runId, ev);
}

export function now(): string {
  return new Date().toISOString();
}
