import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { Core } from "@pcos/core";
import { API_CONTROLLERS } from "./controllers/index.js";
import { ContextGuard } from "./http/context.guard.js";
import { ErrorFilter } from "./http/error.filter.js";
import type { RealtimeHub } from "./realtime/hub.js";
import { CORE, REALTIME } from "./tokens.js";

@Module({})
export class AppModule {
  static forRoot(core: Core, hub: RealtimeHub): DynamicModule {
    return {
      module: AppModule,
      controllers: API_CONTROLLERS,
      providers: [
        { provide: CORE, useValue: core },
        { provide: REALTIME, useValue: hub },
        { provide: APP_GUARD, useClass: ContextGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
