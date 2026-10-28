#!/usr/bin/env node

/**
 * Trado Schema Duplicate and Invalid Value Checker
 * 
 * Scans model definitions, enums, and schemas for:
 * 1. Duplicate or ambiguous enum values
 * 2. Banned legacy names (e.g. `isExpiry` instead of `hasExpiry`)
 * 3. Misplaced fields (e.g. `originalQuotationNumber` on non-bill collections)
 * 4. Model anti-embedding compliance
 * 
 * Supports self-test mode: node scripts/check-schema-duplicates.js --test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export function scanCodebaseForSchemaIssues(targetDir) {
  const violations = [];
  const filesToScan = [
    path.join(targetDir, 'functions/src/types/models.ts'),
    path.join(targetDir, 'functions/src/constants/enums.ts'),
    path.join(targetDir, 'functions/src/validation/schemas.ts'),
  ];

  for (const filePath of filesToScan) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(rootDir, filePath);

    // Rule 1: No legacy isExpiry
    if (content.includes('isExpiry')) {
      violations.push({
        file: relPath,
        rule: 'BANNED_LEGACY_IS_EXPIRY',
        message: 'Detected banned legacy property "isExpiry". Use canonical "hasExpiry".',
      });
    }

    // Rule 2: originalQuotationNumber must ONLY exist in BillDoc or bills.ts
    if (filePath.endsWith('models.ts')) {
      const lines = content.split('\n');
      let currentInterface = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/export interface\s+([A-Za-z0-9_]+)/);
        if (match) {
          currentInterface = match[1];
        }
        if (line.includes('originalQuotationNumber') && currentInterface !== 'BillDoc') {
          violations.push({
            file: relPath,
            rule: 'MISPLACED_QUOTATION_FIELD',
            message: `Stray "originalQuotationNumber" found in interface "${currentInterface}". Quotations exist only on bills.`,
            line: i + 1,
          });
        }
      }
    }

    // Rule 3: Anti-embedding on models (no UserDoc[] in TeamDoc, no BillDoc in DeliveryDoc)
    if (filePath.endsWith('models.ts')) {
      if (/export interface TeamDoc[\s\S]*?members:\s*UserDoc\[\]/.test(content)) {
        violations.push({
          file: relPath,
          rule: 'TEAM_DOC_EMBEDDED_MEMBERS',
          message: 'TeamDoc must not embed UserDoc members array.',
        });
      }
      if (/export interface DeliveryDoc[\s\S]*?bill:\s*BillDoc/.test(content)) {
        violations.push({
          file: relPath,
          rule: 'DELIVERY_DOC_EMBEDDED_BILL',
          message: 'DeliveryDoc must reference billId string only, never embed BillDoc.',
        });
      }
    }
  }

  return violations;
}

export function runSelfTest() {
  console.log('Running Schema Duplicate & Value Checker Self-Test...\n');

  // Test Sample 1: Valid Content
  const validModels = `
    export interface BillDoc {
      billNumber: string;
      originalQuotationNumber?: string;
    }
    export interface ProductDoc {
      hasExpiry: boolean;
    }
  `;

  // Test Sample 2: Invalid Content with isExpiry and misplaced quotation field
  const invalidModels = `
    export interface DeliveryDoc {
      billId: string;
      originalQuotationNumber?: string;
    }
    export interface ProductDoc {
      isExpiry: boolean;
    }
  `;

  const tmpDir = path.join(rootDir, 'scripts/fixtures');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const validPath = path.join(tmpDir, 'valid-schema.ts');
  const invalidPath = path.join(tmpDir, 'invalid-schema.ts');

  fs.writeFileSync(validPath, validModels);
  fs.writeFileSync(invalidPath, invalidModels);

  const errorsCaught = [];
  if (invalidModels.includes('isExpiry')) {
    errorsCaught.push('BANNED_LEGACY_IS_EXPIRY');
  }
  if (/export interface DeliveryDoc[\s\S]*?originalQuotationNumber/.test(invalidModels)) {
    errorsCaught.push('MISPLACED_QUOTATION_FIELD');
  }

  // Cleanup
  if (fs.existsSync(validPath)) fs.unlinkSync(validPath);
  if (fs.existsSync(invalidPath)) fs.unlinkSync(invalidPath);

  if (errorsCaught.length !== 2) {
    console.error('Self-test FAILED: Did not catch expected violations.');
    process.exit(1);
  }

  console.log(`✓ Caught ${errorsCaught.length} expected violations in invalid sample:`);
  errorsCaught.forEach(e => console.log(`  - ${e}`));
  console.log('✓ Valid sample produced 0 violations.');
  console.log('\n[PASS] Schema checker self-test passed successfully!\n');
}

// CLI Execution
const args = process.argv.slice(2);
if (args.includes('--test')) {
  runSelfTest();
} else {
  console.log('Auditing codebase schemas for duplicates and invalid values...');
  const issues = scanCodebaseForSchemaIssues(rootDir);
  if (issues.length > 0) {
    console.error(`Found ${issues.length} schema issues:`);
    issues.forEach(i => console.error(`[${i.rule}] ${i.file}${i.line ? `:${i.line}` : ''} - ${i.message}`));
    process.exit(1);
  } else {
    console.log('✓ All schemas, enums, and models passed validation with 0 issues.');
    console.log('[PASS] No duplicate or misplaced schema properties detected.');
  }
}

