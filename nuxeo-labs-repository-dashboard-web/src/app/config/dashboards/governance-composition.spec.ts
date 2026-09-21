import { describe } from 'vitest';
import legacy from './governance.json';
import source from './governance.composition.json';
import { DashboardConfig } from '../dashboard-config.model';
import { DashboardComposition } from '../composition.model';
import { provesMigrationOf } from './migration.harness';

describe('the Governance composition', () => {
  provesMigrationOf(legacy as DashboardConfig, source as DashboardComposition, {
    kind: { types: { mode: 'subset', values: ['File'] } },
  });
});
