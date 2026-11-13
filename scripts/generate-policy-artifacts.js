/**
 * Generates docs/generated/country-defaults.json and docs/generated/image-policy.json
 * from TypeScript source files to ensure single source of truth (zero duplication).
 */

const fs = require('fs');
const path = require('path');

// Read compiled countryDefaults and imagePolicy
const { COUNTRY_DEFAULTS } = require('../functions/lib/constants/countryDefaults.js');
const { IMAGE_POLICIES } = require('../functions/lib/config/imagePolicy.js');

const countryDefaultsPath = path.join(__dirname, '../docs/generated/country-defaults.json');
const imagePolicyPath = path.join(__dirname, '../docs/generated/image-policy.json');

fs.writeFileSync(countryDefaultsPath, JSON.stringify(COUNTRY_DEFAULTS, null, 2) + '\n', 'utf8');
console.log('Generated docs/generated/country-defaults.json');

fs.writeFileSync(imagePolicyPath, JSON.stringify(IMAGE_POLICIES, null, 2) + '\n', 'utf8');
console.log('Generated docs/generated/image-policy.json');
