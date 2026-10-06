import type {PassiveHandler} from './passive-events.js';

/**
 * Server behaviour of each implemented passive, keyed by catalogue id. A catalogue entry without a handler
 * here is NOT_YET_IMPLEMENTED and is never offered. Adding a passive = one catalogue entry + one handler + tests.
 */
export const passiveHandlers:Record<string,PassiveHandler>={};

export const implementedPassives:ReadonlySet<string>=new Set(Object.keys(passiveHandlers));
