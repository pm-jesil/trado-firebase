#!/usr/bin/env node
/**
 * Generates docs/generated/country-defaults.json, docs/generated/image-policy.json,
 * and docs/generated/currencies.json from compiled TypeScript source files
 * to ensure single source of truth (zero duplication).
 */

const fs = require('fs');
const path = require('path');

// Read compiled countryDefaults, imagePolicy, and currencies
const { COUNTRY_DEFAULTS } = require('../functions/lib/constants/countryDefaults.js');
const { IMAGE_POLICIES } = require('../functions/lib/config/imagePolicy.js');
const { CURRENCIES } = require('../functions/lib/constants/currencies.js');

const countryDefaultsPath = path.join(__dirname, '../docs/generated/country-defaults.json');
const imagePolicyPath = path.join(__dirname, '../docs/generated/image-policy.json');
const currenciesPath = path.join(__dirname, '../docs/generated/currencies.json');

const countryDefaultsContent = JSON.stringify(COUNTRY_DEFAULTS, null, 2) + '\n';
const imagePolicyContent = JSON.stringify(IMAGE_POLICIES, null, 2) + '\n';
const currenciesContent = JSON.stringify(CURRENCIES, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const stale = [
    [countryDefaultsPath, countryDefaultsContent],
    [imagePolicyPath, imagePolicyContent],
    [currenciesPath, currenciesContent],
  ].filter(([f, expected]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== expected);

  if (stale.length > 0) {
    console.error(`[FAIL] Policy artifacts stale: ${stale.map(([f]) => path.relative(path.join(__dirname, '..'), f)).join(', ')}. Run: node scripts/generate-policy-artifacts.js`);
    process.exit(1);
  }
  console.log('[PASS] Policy artifacts are up to date (country-defaults.json, image-policy.json, currencies.json).');
} else {
  fs.writeFileSync(countryDefaultsPath, countryDefaultsContent, 'utf8');
  console.log('Generated docs/generated/country-defaults.json');

  fs.writeFileSync(imagePolicyPath, imagePolicyContent, 'utf8');
  console.log('Generated docs/generated/image-policy.json');

  fs.writeFileSync(currenciesPath, currenciesContent, 'utf8');
  console.log('Generated docs/generated/currencies.json');
}
