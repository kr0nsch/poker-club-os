/** DI token for the core service container (built once in main.ts). */
export const CORE = Symbol("PCOS_CORE");
/** DI token for the realtime hub (WebSocket gateway). */
export const REALTIME = Symbol("PCOS_REALTIME");
