import { PlayersController } from "./crm.controller.js";
import { CommunicationController, DeviceTokenController, LeaguesController } from "./engagement.controller.js";
import { MeController, PublicController } from "./public.controller.js";
import { AuthController, DevicesController, EdgeController, HealthController, OrganizationController } from "./system.controller.js";
import { StructuresController, TournamentsController } from "./tournaments.controller.js";

export const API_CONTROLLERS = [
  HealthController,
  AuthController,
  OrganizationController,
  DevicesController,
  EdgeController,
  PlayersController,
  StructuresController,
  TournamentsController,
  LeaguesController,
  CommunicationController,
  DeviceTokenController,
  PublicController,
  MeController,
];
