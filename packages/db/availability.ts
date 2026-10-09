// Client-safe entry point: `@sla/db/availability` exposes the integration catalog and the availability codes and messages without the Prisma client (D33, N10).
export { INTEGRATION_CATALOG, CATALOG_PROVIDERS, catalogEntry } from "./src/integration-catalog";
export type { IntegrationCatalogEntry, IntegrationCategory, IntegrationConnectionType } from "./src/integration-catalog";
export { INTEGRATION_UNAVAILABLE_CODES, isIntegrationUnavailableCode, unavailableMessage } from "./src/integration-availability";
export type { IntegrationUnavailableCode } from "./src/integration-availability";
