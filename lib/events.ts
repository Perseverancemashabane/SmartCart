import { EventEmitter } from 'events';

// Global Event Emitter for Server-Sent Events (SSE) broadcasting across App Router APIs
class CartEventEmitter extends EventEmitter {}

declare global {
  // eslint-disable-next-line no-var
  var cartEventsBus: CartEventEmitter | undefined;
}

export const cartEventsBus = globalThis.cartEventsBus || new CartEventEmitter();

if (process.env.NODE_ENV !== 'production') {
  globalThis.cartEventsBus = cartEventsBus;
}
