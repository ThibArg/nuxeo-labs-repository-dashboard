import { describe } from 'vitest';
import legacy from './tasks.json';
import source from './tasks.composition.json';
import { DashboardConfig } from '../dashboard-config.model';
import { DashboardComposition } from '../composition.model';
import { provesMigrationOf } from './migration.harness';

describe('the Tasks composition', () => {
  provesMigrationOf(legacy as DashboardConfig, source as DashboardComposition, {
    assignees: { actors: { mode: 'subset', values: ['Josh'] } },
  });
});
