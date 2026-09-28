// Builds the HTTP + WebSocket server around a core container. Used by main.ts
// and by integration tests (with an ephemeral port).

import "reflect-metadata";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Core } from "@pcos/core";
import { AppModule } from "./app.module.js";
import { RealtimeHub } from "./realtime/hub.js";

export interface ApiServer {
  app: NestFastifyApplication;
  hub: RealtimeHub;
  url: string;
  close(): Promise<void>;
}

export async function createApiServer(core: Core, opts: { port?: number; host?: string; logger?: boolean } = {}): Promise<ApiServer> {
  const hub = new RealtimeHub(core);
  const adapter = new FastifyAdapter({
    trustProxy: core.config.TRUST_PROXY,
    bodyLimit: 12 * 1024 * 1024,
    logger: false,
    // Requests from tablets on flaky Wi-Fi should not hang forever.
    requestTimeout: 30_000,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(core, hub), adapter, {
    logger: opts.logger === false ? false : ["error", "warn"],
    bufferLogs: false,
  });
  await app.register(fastifyCookie as never);
  await app.register(fastifyHelmet as never, {
    // The API serves JSON only; the web app sets its own CSP.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: false, // TLS terminates at the reverse proxy which sets HSTS
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onSend", async (req, reply, payload) => {
    // API responses may contain personal data: never cache them (PWA, proxies).
    if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    return payload;
  });
  app.enableShutdownHooks();
  hub.attach(app.getHttpServer());
  await hub.start();
  await app.listen({ port: opts.port ?? core.config.PORT, host: opts.host ?? "0.0.0.0" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? core.config.PORT);
  return {
    app,
    hub,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await hub.close();
      await app.close();
    },
  };
}
