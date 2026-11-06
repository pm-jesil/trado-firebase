const fs = require('fs');
const path = require('path');

const indexPath = path.resolve('functions/src/index.ts');
const content = fs.readFileSync(indexPath, 'utf8');

const regex = /export\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];/g;
let match;
const allExports = [];

while ((match = regex.exec(content)) !== null) {
  const symbols = match[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const source = match[2];
  symbols.forEach(name => {
    allExports.push({ name, source });
  });
}

const callables = allExports.filter(e => !e.source.includes('triggers'));
const manifest = JSON.parse(fs.readFileSync('tests/api/api-manifest.json', 'utf8'));
const manifestMap = new Map(manifest.endpoints.map(e => [e.exportName, e]));

console.log('--- CALLABLES AUDIT ---');

const categories = {
  PUBLIC_AUTH_ADAPTER: [],
  CALLER_IDENTITY: [],
  CONTEXT_SELECTION: [],
  ORGANIZATION_ONBOARDING: [],
  PLATFORM_SUPER_ADMIN: [],
  REFERENCE_DATA: [],
  DERIVED_TENANT_OPERATION: [],
  FILTER_OPTIONAL_TENANT: [],
  OTHER: []
};

// Check schema definitions for organizationId and branchId
const schemaContent = fs.readFileSync('functions/src/validation/schemas.ts', 'utf8');

const results = [];

for (const c of callables) {
  const m = manifestMap.get(c.name);
  let category = 'OTHER';

  if (['healthCheck', 'authLogin'].includes(c.name)) {
    category = 'PUBLIC_AUTH_ADAPTER';
  } else if (['authMe', 'notificationsRegisterFcmToken', 'notificationsList', 'notificationsMarkRead'].includes(c.name)) {
    category = 'CALLER_IDENTITY';
  } else if (['branchContextSwitch'].includes(c.name)) {
    category = 'CONTEXT_SELECTION';
  } else if (['organizationsCreate', 'organizationsUpdate', 'branchesCreate', 'branchesUpdate'].includes(c.name)) {
    category = 'ORGANIZATION_ONBOARDING';
  } else if ([
    'plansCreate', 'plansUpdate', 'reportsGetPlatformOverview',
    'usageGetPlatformSummary', 'usageGetOrganizations', 'usageCalculateDryRunStatement',
    'usageUpdateLimits', 'organizationsDeactivate', 'branchesDeactivate'
  ].includes(c.name)) {
    category = 'PLATFORM_SUPER_ADMIN';
  } else if (['permissionCatalogList', 'modulesList', 'taxRegimesList', 'plansList'].includes(c.name)) {
    category = 'REFERENCE_DATA';
  } else if (
    c.name.endsWith('List') || c.name.endsWith('Get') || c.name.startsWith('reportsGet') || c.name.startsWith('locationsGet') ||
    ['branchesGetDefault', 'reportsExportCsv', 'stockMovementsList', 'usageGetBranches', 'usageGetDetail', 'usageGetLimits'].includes(c.name)
  ) {
    category = 'FILTER_OPTIONAL_TENANT';
  } else {
    category = 'DERIVED_TENANT_OPERATION';
  }

  categories[category].push(c.name);
  results.push({
    name: c.name,
    source: c.source,
    category,
    domain: m ? m.domain : 'unknown',
    permission: m ? m.requiredPermission : 'none'
  });
}

console.log('\n--- CATEGORY BREAKDOWN ---');
for (const [cat, list] of Object.entries(categories)) {
  console.log(`${cat} (${list.length}):`);
  console.log('  ' + list.join(', '));
}

const sum = Object.values(categories).reduce((acc, l) => acc + l.length, 0);
console.log('\nTotal Callables Sum:', sum);
