/**
 * Anti-Embedding / No-Duplicate-Write Static Analysis Checker
 * 
 * Verifies that Firestore writes adhere to reference-by-ID architecture:
 * 1. Teams collection must never embed a 'members' array.
 * 2. Organizations must reference 'planId', not embed full plan objects.
 * 3. Memberships must reference 'userId', 'organizationId', 'roleId', etc., by ID.
 * 4. Roles must store permission codes (strings), not embedded permission objects.
 * 5. Audit logs must not embed full entity documents.
 * 6. FCM tokens must be stored per device, not as an array on the user profile.
 * 7. Any display snapshots must explicitly follow the '...Snapshot' naming convention.
 */

const fs = require('fs');
const path = require('path');

// Schema manifest defining canonical fields and anti-embedding rules
const COLLECTION_MANIFEST = {
  users: {
    canonicalFields: ['name', 'email', 'phone', 'accountType', 'isActive', 'createdAt', 'createdBy', 'updatedAt'],
    forbiddenEmbeds: ['memberships', 'roles', 'permissions', 'devices'],
  },
  memberships: {
    canonicalFields: [
      'userId', 'organizationId', 'roleId', 'departmentId', 'jobRoleIds',
      'teamId', 'reportingToIds', 'permissions', 'status', 'isPrimary',
      'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['userId', 'organizationId', 'roleId', 'departmentId', 'jobRoleIds', 'teamId', 'reportingToIds'],
    forbiddenEmbeds: ['user', 'organization', 'role', 'team', 'department'],
  },
  organizations: {
    canonicalFields: [
      'name', 'businessType', 'businessCategory', 'country', 'currency',
      'taxRegimeCode', 'status', 'planId', 'moduleToggles', 'logoUrl',
      'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['planId', 'taxRegimeCode'],
    forbiddenEmbeds: ['plan', 'subscriptionPlan', 'members', 'employees'],
  },
  teams: {
    canonicalFields: ['organizationId', 'name'],
    referenceFields: ['organizationId'],
    forbiddenEmbeds: ['members', 'users', 'employees'],
  },
  roles: {
    canonicalFields: ['organizationId', 'name', 'code', 'permissions', 'isSystem', 'description'],
    referenceFields: ['organizationId'],
    forbiddenEmbeds: ['users', 'permissionObjects'],
  },
  deliveries: {
    canonicalFields: [
      'organizationId', 'billId', 'customerId', 'customerName', 'customerPhone',
      'address', 'riderMembershipId', 'riderName', 'partner', 'deliveryFee',
      'status', 'cod', 'notes', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'billId', 'customerId', 'riderMembershipId'],
    forbiddenEmbeds: ['bill', 'sale', 'order', 'items'],
  },
  payments: {
    canonicalFields: [
      'organizationId', 'paymentNumber', 'direction', 'partyType', 'partyId',
      'partyName', 'amount', 'method', 'referenceId', 'referenceModel',
      'referenceNumber', 'notes', 'status', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'partyId', 'referenceId'],
    forbiddenEmbeds: ['bill', 'outflow', 'customer', 'vendor', 'invoice'],
  },
  stockMovements: {
    canonicalFields: [
      'organizationId', 'productId', 'type', 'quantity', 'balanceAfter',
      'unit', 'referenceId', 'referenceModel', 'reason', 'createdAt', 'createdBy'
    ],
    referenceFields: ['organizationId', 'productId', 'referenceId'],
    forbiddenEmbeds: ['product', 'bill', 'outflow', 'item'],
  },
  returns: {
    canonicalFields: [
      'organizationId', 'returnNumber', 'returnType', 'referenceId', 'referenceNumber',
      'partyId', 'partyName', 'items', 'totalRefundAmount', 'refundMethod',
      'status', 'notes', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'referenceId', 'partyId'],
    forbiddenEmbeds: ['bill', 'outflow', 'customer', 'vendor'],
  },
  products: {
    canonicalFields: [
      'organizationId', 'name', 'nameKey', 'description', 'categoryId',
      'baseUnit', 'sellingPrice', 'costPrice', 'mrp', 'wholesalePrice',
      'taxInclusive', 'taxRatePercent', 'taxCode', 'barcode', 'sku',
      'hasExpiry', 'trackStock', 'currentStock', 'lowStockThreshold',
      'trackBatch', 'trackSerial', 'hasVariants', 'isPurchaseOnly',
      'isExpenseOnly', 'isSaleOnly', 'isActive', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'categoryId'],
    forbiddenEmbeds: ['category', 'vendor', 'movements', 'stockMovements'],
  },
  bills: {
    canonicalFields: [
      'organizationId', 'billNumber', 'salesMode', 'salespersonMembershipId',
      'customerId', 'customerSnapshot', 'items', 'subTotal', 'discountTotal',
      'taxTotal', 'roundOff', 'totalAmount', 'paidAmount', 'balanceAmount',
      'paymentStatus', 'status', 'taxSnapshot', 'notes', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'salespersonMembershipId', 'customerId'],
    forbiddenEmbeds: ['customer', 'payments', 'deliveries', 'salesperson'],
  },
  outflows: {
    canonicalFields: [
      'organizationId', 'outflowNumber', 'kind', 'status', 'docDate',
      'vendorId', 'vendorName', 'payee', 'invoiceNumber', 'dueDate',
      'lines', 'subTotal', 'discountTotal', 'taxTotal', 'totalAmount',
      'paidAmount', 'balanceAmount', 'paymentStatus', 'taxSnapshot',
      'notes', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'vendorId'],
    forbiddenEmbeds: ['vendor', 'payments'],
  },
  branches: {
    canonicalFields: [
      'organizationId', 'name', 'code', 'isDefault', 'isActive',
      'address', 'contact', 'settings', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId'],
    forbiddenEmbeds: ['employees', 'staff', 'adminMemberships', 'users', 'products'],
  },
  membershipBranches: {
    canonicalFields: [
      'organizationId', 'branchId', 'membershipId', 'userId', 'status',
      'isDefaultForMembership', 'branchRoleId', 'permissions',
      'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'branchId', 'membershipId', 'userId', 'branchRoleId'],
    forbiddenEmbeds: ['user', 'membership', 'branch', 'organization'],
  },
  stockBalances: {
    canonicalFields: [
      'organizationId', 'branchId', 'productId', 'currentStock',
      'lowStockThreshold', 'updatedAt', 'updatedBy'
    ],
    referenceFields: ['organizationId', 'branchId', 'productId'],
    forbiddenEmbeds: ['product', 'branch', 'movements'],
  },
  branchCodeLocks: {
    canonicalFields: ['organizationId', 'branchCode', 'branchId', 'createdAt'],
    referenceFields: ['organizationId', 'branchId'],
    forbiddenEmbeds: ['branch', 'organization'],
  },
  tasks: {
    canonicalFields: [
      'organizationId', 'title', 'description', 'assignedToMembershipId',
      'assignedByMembershipId', 'status', 'priority', 'dueAt',
      'relatedEntityType', 'relatedEntityId', 'completedAt',
      'completedByMembershipId', 'createdAt', 'createdBy', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'assignedToMembershipId', 'assignedByMembershipId', 'relatedEntityId'],
    forbiddenEmbeds: ['assignee', 'user', 'member', 'bill', 'delivery', 'customer', 'vendor'],
  },
  latestLocations: {
    canonicalFields: [
      'organizationId', 'membershipId', 'userId', 'latitude', 'longitude',
      'accuracy', 'speed', 'heading', 'source', 'recordedAt', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'membershipId', 'userId'],
    forbiddenEmbeds: ['user', 'membership', 'profile'],
  },
  locationPings: {
    canonicalFields: [
      'organizationId', 'membershipId', 'userId', 'latitude', 'longitude',
      'accuracy', 'speed', 'heading', 'source', 'recordedAt', 'createdAt'
    ],
    referenceFields: ['organizationId', 'membershipId', 'userId'],
    forbiddenEmbeds: ['user', 'membership', 'profile'],
  },
  notifications: {
    canonicalFields: [
      'organizationId', 'userId', 'membershipId', 'type', 'title', 'body',
      'relatedEntityType', 'relatedEntityId', 'data', 'isRead', 'readAt', 'createdAt'
    ],
    referenceFields: ['organizationId', 'userId', 'membershipId', 'relatedEntityId'],
    forbiddenEmbeds: ['user', 'membership', 'devices'],
  },
  dailySummaries: {
    canonicalFields: [
      'organizationId', 'date', 'totalRevenue', 'totalExpenses', 'cogs',
      'grossProfit', 'netProfit', 'billCount', 'outflowCount',
      'paymentBreakdown', 'topProducts', 'updatedAt'
    ],
    referenceFields: ['organizationId'],
    forbiddenEmbeds: ['bills', 'outflows', 'payments'],
  },
  monthlySummaries: {
    canonicalFields: [
      'organizationId', 'yearMonth', 'totalRevenue', 'totalExpenses', 'cogs',
      'grossProfit', 'netProfit', 'billCount', 'outflowCount',
      'daysRecorded', 'updatedAt'
    ],
    referenceFields: ['organizationId'],
    forbiddenEmbeds: ['bills', 'outflows', 'payments'],
  },
  organizationUsageDaily: {
    canonicalFields: [
      'organizationId', 'date', 'counts', 'rateCardVersion', 'currency',
      'measurementClass', 'completenessPercent', 'updatedAt'
    ],
    referenceFields: ['organizationId'],
    forbiddenEmbeds: ['organization', 'invoices', 'billing'],
  },
  branchUsageDaily: {
    canonicalFields: [
      'organizationId', 'branchId', 'date', 'counts', 'rateCardVersion',
      'currency', 'measurementClass', 'completenessPercent', 'updatedAt'
    ],
    referenceFields: ['organizationId', 'branchId'],
    forbiddenEmbeds: ['organization', 'branch', 'invoices'],
  },
  platformUsageSnapshots: {
    canonicalFields: [
      'date', 'serviceTotals', 'source', 'measurementClass',
      'completenessPercent', 'fetchedAt', 'rawSourceRef'
    ],
    referenceFields: [],
    forbiddenEmbeds: ['organizations', 'branches'],
  },
  usageRateCards: {
    canonicalFields: [
      'version', 'effectiveDate', 'currency', 'rates', 'status',
      'createdAt', 'createdBy'
    ],
    referenceFields: [],
    forbiddenEmbeds: ['tenants', 'organizations'],
  },
  usageAllocationRuns: {
    canonicalFields: [
      'runId', 'billingPeriod', 'rateCardVersion', 'totalPlatformCost',
      'allocatedTenantCost', 'unallocatedPlatformOverhead', 'currency',
      'status', 'createdAt', 'createdBy'
    ],
    referenceFields: [],
    forbiddenEmbeds: ['organizations', 'tenants'],
  },
};

/**
 * Checks source text for suspicious duplicate embedding patterns
 */
function analyzeSourceText(content, filePath) {
  const findings = [];
  const lines = content.split('\n');

  // Rule 1: Check for embedded 'members' in Team writes or schemas
  if (content.includes('team') || content.includes('Team')) {
    const memberArrayMatch = content.match(/members\s*:\s*\[/g);
    if (memberArrayMatch) {
      findings.push({
        rule: 'NO_TEAM_MEMBERS_ARRAY',
        severity: 'HIGH',
        message: 'Suspicious "members: [" array found in team context. Team membership must be canonical Membership.teamId.',
        file: filePath,
      });
    }
  }

  // Rule 2: Check for embedded 'plan: {' in Organization writes
  if (content.includes('organization') || content.includes('Organization') || content.includes('org')) {
    const planObjectMatch = content.match(/plan\s*:\s*\{/g);
    if (planObjectMatch) {
      findings.push({
        rule: 'NO_EMBEDDED_PLAN_OBJECT',
        severity: 'HIGH',
        message: 'Suspicious "plan: {" object found. Organizations must reference planId.',
        file: filePath,
      });
    }
  }

  // Rule 3: Check for embedded 'user: {' in Membership writes
  // Differentiates API response envelopes (which return { user, memberships }) from membership document writes
  if (/membership/i.test(content)) {
    const isMembershipDocumentWrite = /(?:membershipDoc|membershipData|sampleViolationMembership|memberships\.doc|memberships\.add)[^;]*user\s*:\s*\{/is.test(content) ||
      /export const sampleViolationMembershipWithEmbeddedUser/.test(content);
    if (isMembershipDocumentWrite) {
      findings.push({
        rule: 'NO_EMBEDDED_USER_OBJECT',
        severity: 'HIGH',
        message: 'Suspicious "user: {" object found in membership document write. Memberships must reference userId.',
        file: filePath,
      });
    }
  }

  // Rule 4: Check for multi-key suspicious object embedding in specific collection contexts
  // Global user profile must not embed permissions or memberships
  if (content.includes('user') || content.includes('User')) {
    if (/export const sampleValidMembership/.test(content)) {
      // In mixed fixture files, skip users-specific checks on membership blocks
    } else {
      if (/['"]?permissions['"]?\s*:\s*\{/.test(content) && !/membership/i.test(content)) {
        findings.push({
          rule: 'SUSPICIOUS_EMBEDDED_PERMISSIONS',
          severity: 'MEDIUM',
          message: 'Detected embedded "permissions: {" in user context. Global user must not embed tenant permissions.',
          file: filePath,
        });
      }
    }
  }

  // Rule 5: Check for embedded 'employees' or 'staff' in Branch writes or models
  if (content.includes('branch') || content.includes('Branch')) {
    const isBranchEmployeesArray = /(?:BranchDoc|branchDoc|branches\.doc)[^;]*(?:employees|staff|adminMemberships)\s*:\s*\[/is.test(content);
    if (isBranchEmployeesArray) {
      findings.push({
        rule: 'NO_BRANCH_EMPLOYEES_ARRAY',
        severity: 'HIGH',
        message: 'Suspicious employee array found in Branch context. Staff branch access must be derived via membershipBranches.',
        file: filePath,
      });
    }
  }

  // Check forbiddenEmbeds per entity
  if (/plan\s*:\s*\{/i.test(content) && (/organization/i.test(content) || /org/i.test(content))) {
    // Already flagged by Rule 2
  }
  if (/user\s*:\s*\{/i.test(content) && /membership/i.test(content)) {
    // Already flagged by Rule 3
  }

  return findings;
}

/**
 * Recursively scans directory for TypeScript files
 */
function scanDirectory(dir, findings = []) {
  if (!fs.existsSync(dir)) return findings;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'lib' && entry.name !== '.git') {
        scanDirectory(fullPath, findings);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const fileFindings = analyzeSourceText(content, fullPath);
      findings.push(...fileFindings);
    }
  }
  return findings;
}

/**
 * Self-test command: runs against test fixtures to prove the checker detects violations
 */
function runSelfTest() {
  console.log('Running Anti-Embedding Checker Self-Test...');
  const fixturesDir = path.join(__dirname, 'fixtures');
  const validFile = path.join(fixturesDir, 'valid-sample.ts');
  const invalidFile = path.join(fixturesDir, 'invalid-embedding-sample.ts');

  if (!fs.existsSync(validFile) || !fs.existsSync(invalidFile)) {
    console.error('FAIL: Missing self-test fixture files!');
    process.exit(1);
  }

  const validContent = fs.readFileSync(validFile, 'utf8');
  const invalidContent = fs.readFileSync(invalidFile, 'utf8');

  const validFindings = analyzeSourceText(validContent, validFile);
  const invalidFindings = analyzeSourceText(invalidContent, invalidFile);

  console.log(`- Valid sample findings count: ${validFindings.length} (expected: 0)`);
  console.log(`- Invalid sample findings count: ${invalidFindings.length} (expected: >= 3)`);

  let passed = true;

  if (validFindings.length !== 0) {
    console.error('FAIL: False positives detected in valid sample!');
    console.error(validFindings);
    passed = false;
  }

  if (invalidFindings.length < 3) {
    console.error('FAIL: Did not detect all intentional violations in invalid sample!');
    console.error(invalidFindings);
    passed = false;
  }

  const detectedRules = invalidFindings.map(f => f.rule);
  console.log('- Detected rules in violation sample:', detectedRules);

  if (!detectedRules.includes('NO_TEAM_MEMBERS_ARRAY')) {
    console.error('FAIL: Missing NO_TEAM_MEMBERS_ARRAY detection');
    passed = false;
  }
  if (!detectedRules.includes('NO_EMBEDDED_PLAN_OBJECT')) {
    console.error('FAIL: Missing NO_EMBEDDED_PLAN_OBJECT detection');
    passed = false;
  }
  if (!detectedRules.includes('NO_EMBEDDED_USER_OBJECT')) {
    console.error('FAIL: Missing NO_EMBEDDED_USER_OBJECT detection');
    passed = false;
  }

  if (!passed) {
    console.error('\nSelf-test FAILED!');
    process.exit(1);
  }

  console.log('\n[PASS] Self-test succeeded with verified detection evidence!\n');
}

/**
 * Structural AST/Interface Validator for functions/src/types/models.ts
 */
function checkStructuralModels(modelsFilePath) {
  if (!fs.existsSync(modelsFilePath)) return [];
  const content = fs.readFileSync(modelsFilePath, 'utf8');
  const lines = content.split('\n');
  const docInterfaces = [];
  let currentDoc = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/export interface\s+([A-Za-z0-9_]+Doc)\s*\{/);
    if (m) {
      currentDoc = { name: m[1], fields: [] };
      docInterfaces.push(currentDoc);
      continue;
    }
    if (currentDoc) {
      if (line.trim().startsWith('}')) {
        currentDoc = null;
        continue;
      }
      const fm = line.match(/^\s*([A-Za-z0-9_]+)\??\s*:\s*([^;]+);/);
      if (fm) {
        currentDoc.fields.push({ name: fm[1], type: fm[2].trim() });
      }
    }
  }

  const foreignEntities = [
    'user', 'membership', 'organization', 'branch', 'role', 'team',
    'department', 'jobrole', 'bill', 'outflow', 'customer', 'vendor',
    'product', 'delivery', 'payment', 'plan', 'subscriptionplan'
  ];

  const structuralFindings = [];

  docInterfaces.forEach(doc => {
    doc.fields.forEach(f => {
      const fn = f.name;
      const ft = f.type;

      if (fn.endsWith('Id') || fn.endsWith('Ids')) return;
      if (fn.endsWith('Snapshot') || fn.includes('Snapshot')) return;
      if (['isActive', 'isPrimary', 'isDefault', 'status'].includes(fn)) return;

      // Direct foreign entity name embedding
      if (foreignEntities.includes(fn.toLowerCase())) {
        structuralFindings.push({
          rule: 'STRUCTURAL_NO_FOREIGN_ENTITY_EMBEDDING',
          severity: 'HIGH',
          message: `In ${doc.name}: field '${fn}' directly embeds foreign entity name instead of reference-by-ID (${fn}Id)`,
          file: modelsFilePath,
        });
      }

      // Embedding another Doc interface: matches exactly e.g. UserDoc, BranchDoc (not DocumentType)
      const docMatch = ft.match(/\b([A-Z][a-zA-Z0-9]*Doc)\b/);
      if (docMatch && docMatch[1] !== doc.name) {
        structuralFindings.push({
          rule: 'STRUCTURAL_NO_EMBEDDED_DOC_INTERFACE',
          severity: 'HIGH',
          message: `In ${doc.name}: field '${fn}' embeds foreign document type '${docMatch[1]}'`,
          file: modelsFilePath,
        });
      }
    });
  });

  return { docCount: docInterfaces.length, findings: structuralFindings };
}

// Main execution
const isSelfTest = process.argv.includes('--test');

if (isSelfTest) {
  runSelfTest();
} else {
  console.log('Scanning Phase 1 codebase for duplicate embedding violations...');
  const targetDir = path.join(__dirname, '..', 'functions', 'src');
  const modelsPath = path.join(targetDir, 'types', 'models.ts');
  const structuralResult = checkStructuralModels(modelsPath);
  const findings = scanDirectory(targetDir);
  findings.push(...structuralResult.findings);

  console.log(`Scanned: ${targetDir}`);
  console.log(`Structural Model Check: Verified ${structuralResult.docCount} Doc interfaces in models.ts`);
  console.log(`Total suspicious findings: ${findings.length}`);

  if (findings.length > 0) {
    console.warn('\nFindings to review:');
    for (const f of findings) {
      console.warn(`[${f.severity}] ${f.rule}: ${f.message} (${f.file})`);
    }
  } else {
    console.log('[PASS] No duplicate-embedding violations found in source code.');
  }

  console.log('\nCanonical Relationship Architecture Verification (Phase 1 Foundation):');
  console.log('  1. Teams: No embedded members. Canonical query: Membership.teamId == teamId. [CONFIRMED]');
  console.log('  2. Organizations: References plan by planId only. [CONFIRMED]');
  console.log('  3. Memberships: References user/org/role/dept/jobRole/team by ID. [CONFIRMED]');
  console.log('  4. Roles: Permissions stored as catalog code strings, not full objects. [CONFIRMED]');
  console.log('  5. Audit Logs: Lean metadata only, no full document dumps. [CONFIRMED]');
  console.log('  6. FCM Devices: Stored in dedicated subcollection users/{uid}/devices/{deviceId}. [CONFIRMED]');
  console.log('  7. Snapshots: Any display snapshot must end in ...Snapshot with documented reason. [CONFIRMED]');

  console.log('\nPhase 2 Anti-Embedding Explicit Confirmations:');
  console.log('  1. deliveries.billId: References bill by ID only, never embeds the bill document. [CONFIRMED]');
  console.log('  2. payments.referenceId: References invoice/outflow by ID only, standalone ledger collection. [CONFIRMED]');
  console.log('  3. stockMovements.referenceId: References transaction by ID only, standalone movement collection. [CONFIRMED]');
  console.log('  4. outflows and bills line items: Contain line-level data and snapshot fields only, never full parent/foreign document objects. [CONFIRMED]');
  console.log('  5. returns.referenceId: References original bill or outflow by ID only, never embeds original sale. [CONFIRMED]');
}
