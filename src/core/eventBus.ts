import { EventEmitter } from 'node:events';
import type { AuditEvent } from '../types.js';

export class AuditEventBus extends EventEmitter {
  publish(event: AuditEvent): void {
    this.emit('event', event);
  }

  subscribe(listener: (event: AuditEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}
