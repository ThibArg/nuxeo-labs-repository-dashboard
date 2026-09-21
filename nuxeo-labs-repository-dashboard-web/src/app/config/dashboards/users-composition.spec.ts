import { describe } from 'vitest';
import legacy from './users.json';
import source from './users.composition.json';
import { DashboardConfig } from '../dashboard-config.model';
import { DashboardComposition } from '../composition.model';
import { provesMigrationOf } from './migration.harness';

describe('the Users composition', () => {
  provesMigrationOf(legacy as DashboardConfig, source as DashboardComposition);
});
