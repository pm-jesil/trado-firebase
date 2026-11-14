---
covers: [all]
verifiedAgainst: static-policy
---

# Change Checklist & Definition of Done (D-30)

Whenever a source unit is created or modified, the following coupled artifacts MUST be updated together or acknowledged with a reason:

| Change Type | Coupled Artifacts Required |
|---|---|
| **New Callable** | Central wrapper declaration, Zod schema (\`schemas.ts\`), gate check (\`contextResolver.ts\`), behavioral test (\`functions/scripts/test-*.cjs\`), OpenAPI operation (\`docs/openapi.json\`), API manifest (\`tests/api/api-manifest.json\`), permissions entry (\`permissionCatalog\`), API reference (\`docs/api-reference.md\`), explorer example, cost budget (\`scripts/cost-budgets.json\`), audit action (\`auditRegistry.ts\`). |
| **Changed Request Field** | Zod input schema, documentation example, OpenAPI schema, maximal roundtrip test payload, validation vector test. |
| **Changed Response Shape** | Zod response contract, OpenAPI response, client contract (D-18), test assertions. |
| **New Collection** | Model interface (\`models.ts\`), Firestore rules match (\`firestore.rules\`), rules matrix test (\`firestoreRules.test.ts\`), domain assignment in \`generate-source-inventory.js\`, reference integrity checks. |
| **New Field** | Schema, model, field glossary registration (\`field-glossary.json\`), naming registry (\`generate-naming-registry.js\`), documentation. |
| **Permission Change** | \`constants/permissions.ts\`, \`permissionCatalog\`, context resolver gate, gate conformance check (\`check-gate-conformance.js\`). |
| **Rules Change** | \`firestore.rules\` or \`storage.rules\`, rules unit test (\`firestoreRules.test.ts\` / \`storageRules.test.ts\`), coverage report. |
| **Trigger Change** | Trigger export, idempotency guard, replay/ordering test, single-writer verification. |
| **Doc-Only Change** | Link check (\`check-markdown-links.js\`), truth check (\`check-doc-truth.js\`), doc index re-sync (\`generate-doc-index.js\`). |
| **Test-Only Change** | Zero flakiness across 3 consecutive runs, no skipped/only tests, test completeness ratio (\`check-test-completeness.js\`). |

