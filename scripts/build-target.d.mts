export function isProductionDeploy(env: Record<string, string | undefined>): boolean;
export function buildTarget(build: { dataMode?: string; productionDeploy: boolean }): 'coming-soon' | 'shop';
