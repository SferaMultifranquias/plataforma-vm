import { onRequest as stockCheckHandler } from './index.js';

// Re-export the same handler (single PATCH endpoint via params)
export { stockCheckHandler as onRequest };
