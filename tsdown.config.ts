/**
 * Standalone tsdown config for the hello plugin.
 *
 * Uses the project-local shared client-bundle preset (shared/tsdown.client.ts —
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 */
import { clientBundle } from './shared/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-hello', [
  'src/index.ts',
  'src/invariant.ts',
])