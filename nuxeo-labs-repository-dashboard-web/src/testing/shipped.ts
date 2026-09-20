/**
 * Reads a shipped dashboard file the way the application does.
 *
 * A file may be written either way — as a composition naming library widgets, or as the compiled
 * configuration — and a test that only understood one of them would go green for the wrong reason
 * the day a dashboard is migrated.
 */
import { DashboardConfig } from '../app/config/dashboard-config.model';
import { compileComposition } from '../app/config/composition-compiler';
import { DashboardComposition, isComposition } from '../app/config/composition.model';

export function shippedConfig(name: string, source: unknown): DashboardConfig {
  if (!isComposition(source)) {
    return source as DashboardConfig;
  }
  const { config, problems } = compileComposition(source as DashboardComposition);
  if (!config) {
    throw new Error(`${name} does not compile: ${problems.join(' ')}`);
  }
  return config;
}
