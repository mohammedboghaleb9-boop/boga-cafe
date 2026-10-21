export function isProductionDeploy(env: Record<string, string | undefined>): boolean;
export const PRODUCTION_SITE: 'shop' | 'coming-soon';
export function buildTarget(build: { dataMode?: string; productionDeploy: boolean; productionSite?: 'shop' | 'coming-soon' }): 'coming-soon' | 'shop';
