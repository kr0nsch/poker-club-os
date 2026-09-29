import type { TestProject } from "vitest/node";
import { globalSetupPostgres } from "@pcos/testkit";

declare module "vitest" {
  export interface ProvidedContext {
    pgBaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  return globalSetupPostgres((key, value) => project.provide(key as "pgBaseUrl", value));
}
