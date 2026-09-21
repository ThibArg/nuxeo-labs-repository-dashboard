import { describe } from 'vitest';
import legacy from './workflows.json';
import source from './workflows.composition.json';
import { DashboardConfig } from '../dashboard-config.model';
import { DashboardComposition } from '../composition.model';
import { provesMigrationOf } from './migration.harness';

describe('the Workflows composition', () => {
  provesMigrationOf(legacy as DashboardConfig, source as DashboardComposition, {
    models: { modelName: { mode: 'subset', values: ['ParallelDocumentReview'] } },
  });
});
