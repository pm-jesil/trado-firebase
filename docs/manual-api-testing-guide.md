# Manual API Testing Guide — Trado Firebase Backend

> **Audience:** New developers learning Firebase, or anyone who wants to manually explore the Trado API using a browser-based Swagger UI.

## Quick Start (5 minutes)

Execute these 5 commands across two PowerShell terminals:

```powershell
# 1. Compile backend functions
npm --prefix functions run build

# 2. Start Firebase Emulators (Terminal 1)
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x

# 3. Seed demo organizations & personas (Terminal 2)
node functions/lib/scripts/seed-emulator.js --profile api-explorer-demo

# 4. Generate OpenAPI specification (Terminal 2)
node scripts/generate-openapi.js

# 5. Launch Local API Explorer (Terminal 2)
node tools/api-explorer/server.js
# → Open browser to http://127.0.0.1:3939
```

### Detailed Step-by-Step Breakdown

#### Step 1: Build the Backend

```powershell
npm --prefix functions run build
```

#### Step 2: Start the Firebase Emulators (Terminal 1)

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase emulators:start --project trado-x
```

Wait for:
```
✔  All emulators ready! It is now safe to connect your app.
```

> [!TIP]
> Leave Terminal 1 open — the emulators must stay running.

#### Step 3: Seed Demo Organizations & Personas (Terminal 2)

In a new terminal window:
```powershell
node functions/lib/scripts/seed-emulator.js --profile api-explorer-demo
```

This provisions two realistic demo businesses and exports credentials to `.local/api-explorer-credentials.json`:
- **Platform Super Admin:** `superadmin@trado.local` (Unrestricted platform & usage controls)
- **Organization A (Retail Demo - `org_apex_sample`):**
  * Owner: `owner@apexwholesale.local`
  * Admin: `admin@apexwholesale.local`
  * Cashier: `cashier@apexwholesale.local`
  * Branch: `main-branch` (`MAIN`)
- **Organization B (Wholesale Multi-Branch - `org_wholesale_sample`):**
  * Owner: `owner@wholesale.trado.local`
  * Manager: `manager@wholesale.trado.local` (Assigned to both `main-branch` and `branch_warehouse`)
  * Cashier: `cashier@wholesale.trado.local` (Branch-locked to `main-branch`)
  * Branches: `main-branch` (`MAIN`), `branch_warehouse` (`WH01`)
- **Default Test Password:** `TestPassword123!` for all personas.
- **Detailed Persona Reference:** For the complete list of accounts, branch scopes, and negative personas, see [Testing Personas & Credentials](testing-personas-and-credentials.md).

#### Step 4: Generate OpenAPI Specification (Terminal 2)

```powershell
node scripts/generate-openapi.js
```

You should see output like:
```
[OK] Generated docs/openapi.json
     178 callable operations, 8 triggers documented
     100% typed response schemas
```

#### Step 5: Launch Local API Explorer (Terminal 2)

```powershell
node tools/api-explorer/server.js
```

#### Step 6: Open the Explorer

Open your browser to: **[http://127.0.0.1:3939](http://127.0.0.1:3939)**

You'll see:
1. A red **"LOCAL FIREBASE EMULATOR — trado-x — NOT PRODUCTION"** banner
2. A **persona login** panel with one-click buttons for Super Admin, Retail, and Wholesale personas
3. The **Swagger UI** listing all 178 callable functions grouped by domain

---

## Using the API Explorer

### Signing In via Persona Bar

1. Click any persona button in the header bar (e.g., **"Platform Super Admin"**, **"Retail Owner"**, or **"Wholesale Owner"**).
2. The status line turns green: `✅ Signed in as ... — token applied to all requests`.
3. All subsequent Try-it-out requests will include the auth token automatically.

For custom test accounts, click **"Custom Login"**, enter email/password, and click **Sign In**.

### Testing the Unified Authentication API (`authLogin`)

You can also test the unified login API directly as a callable in Swagger UI:
1. Navigate to domain **"General"** → **`authLogin`**.
2. Click **"Try it out"**.
3. Use the complete request example:
   ```json
   {
     "data": {
       "email": "owner@apexwholesale.local",
       "password": "TestPassword123!",
       "deviceId": "device_manual_test_01"
     }
   }
   ```
4. Click **"Execute"**.
5. Observe the comprehensive JSON response:
   - `accessToken`, `refreshToken`, `expiresIn`: Token bundle for API invocation.
   - `profile`: User details (`uid`, `email`, `name`, `phone`, `accountType`, `isActive`, `isSuperAdmin`).
   - `role`: Role details (`roleId`, `roleName`, `roleCode: "org_owner"`).
   - `permissions`: Evaluated 4-layer permissions array.
   - `organizations`: Full list of organizations the user belongs to, plus `primaryOrganization`.
   - `branches`: Branches assigned to the user, plus `primaryBranch`.

> [!TIP]
> **Super Admin Invariant**: If you execute `authLogin` with `email: "superadmin@trado.local"`, the response will have:
> - `profile.isSuperAdmin`: `true`
> - `organizations`: `[]` (empty list)
> - `primaryOrganization`: `null`
> - `branches`: `[]` (empty list)
> - `primaryBranch`: `null`
> - `role`: `{ roleId: null, roleName: "Platform Super Admin", roleCode: "super_admin" }`
> - `permissions`: `["*"]`

### Signing Out

Click the **"Sign Out"** button in the persona bar (or `POST /__local__/auth/logout`). This clears your auth token — subsequent requests will be unauthenticated until you sign in again. Use this to test unauthenticated rejection or switch personas.

### Safety Guards for Destructive Operations

To prevent accidental modification or deactivation of core entities, destructive operations are protected by a safety confirmation guard:
- **Protected Callables**:
  * `organizationsDeactivate`
  * `branchesDeactivate`
  * `employeesDeactivate`
  * `tasksDelete`
- **In Swagger UI**: When you click "Execute" on any of these operations, the browser will display a confirmation dialog:
  > *"DESTRUCTIVE OPERATION: Are you sure you want to execute <operationName>? This changes active business status."*
  Clicking "OK" automatically attaches the required `x-trado-confirmed: true` header.
- **In Scripts or Direct HTTP**: You must explicitly send the HTTP header `x-trado-confirmed: true`. Requests without this header are safely rejected with `HTTP 400 Bad Request`.

### Making Your First Read Request

1. Scroll to **"System & Health"** → **`healthCheck`**
2. Click **"Try it out"**
3. Click **"Execute"**
4. You should see a 200 response with `{"result": {"status": "ok", ...}}`

### Making a Write Request

1. Sign in as **Apex Wholesale Owner**
2. Scroll to **"Categories"** → **`categoriesCreate`**
3. Click **"Try it out"**
4. Replace the request body with:
   ```json
   {
     "data": {
       "organizationId": "<your-org-id>",
       "name": "Beverages",
       "idempotencyKey": "cat-beverages-001"
     }
   }
   ```
5. Click **"Execute"**
6. Check the response for `{"result": {"categoryId": "..."}}`

> [!NOTE]
> To find your `organizationId`, call `authMe` first — it's in `result.activeContext.organizationId`.

### Understanding the Request Envelope

Firebase callable functions expect a specific envelope:

```json
{
  "data": {
    // your actual payload goes here
  }
}
```

The API Explorer proxy handles this automatically — if you send raw payload, it wraps it for you. But for clarity, the schemas shown in Swagger UI represent the **inner `data` payload**.

### Understanding Error Responses

| HTTP Status | Firebase Code | Meaning |
|-------------|---------------|---------|
| 400 | `INVALID_ARGUMENT` | Missing or invalid input fields |
| 401 | `UNAUTHENTICATED` | No auth token or expired token |
| 403 | `PERMISSION_DENIED` | User lacks required permission |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `ALREADY_EXISTS` | Duplicate idempotency key |

---

## Resetting Demo Data

To clear all emulator data and re-seed:

1. Stop the emulators (Ctrl+C)
2. Restart them: `npx firebase-tools emulators:start --project trado-x`
3. Re-run the seed command from Step 4

> [!IMPORTANT]
> Emulator data is **ephemeral** — it's lost when emulators stop unless you use `--export-on-exit`.

---

## Tool Comparison

| Feature | API Explorer (Swagger UI) | .http Files | CLI Workbench | Automated Tests |
|---------|--------------------------|-------------|---------------|-----------------|
| Visual UI | ✅ Browser-based | ❌ Editor only | ❌ Terminal | ❌ Terminal |
| Auto-complete schemas | ✅ From OpenAPI | ❌ Manual | ❌ Manual | N/A |
| Persona login | ✅ One-click | ❌ Manual curl | ✅ Scripted | ✅ Scripted |
| Try individual APIs | ✅ | ✅ | ✅ | ❌ |
| Batch/regression testing | ❌ | ❌ | ✅ Limited | ✅ Full |
| Schema validation | ✅ Zod → JSON Schema | ❌ | ❌ | ✅ |
| CI/CD integration | ❌ | ❌ | ❌ | ✅ |

**Recommendation:** Use the API Explorer when learning the API or debugging a specific callable. Use automated tests for regression and CI.

---

## Troubleshooting

### "Cannot read OpenAPI spec"
Run `node scripts/generate-openapi.js` to generate `docs/openapi.json`.

### "Login failed"
- Ensure emulators are running
- Ensure data has been seeded (Step 4)
- Check the email/password — default password is `TestPassword123!`

### "Proxy error: connect ECONNREFUSED"
The Functions emulator isn't running on port 5001. Start emulators first.

### Port 3939 is in use
Use a different port: `node tools/api-explorer/server.js --port 4040`

### Emulator ports are occupied
```powershell
# Find what's using port 8080 (Firestore) or 5001 (Functions)
netstat -ano | findstr :8080
netstat -ano | findstr :5001

# Kill the process by PID
Stop-Process -Id <PID> -Force
```

---

## Architecture

```
Browser (http://127.0.0.1:3939)
  │
  ├── GET /              → Swagger UI (HTML/JS from swagger-ui-dist, offline capable)
  ├── GET /openapi.json  → OpenAPI spec (from docs/openapi.json)
  ├── POST /api/callables/{name}  → proxy → Functions emulator (127.0.0.1:5001)
  ├── POST /__local__/auth/login  → proxy → Auth emulator (127.0.0.1:9099)
  └── POST /__local__/auth/logout → clears auth token
```

The API Explorer is a thin proxy — it:
1. Wraps your payload in the Firebase `{data: ...}` envelope
2. Forwards your auth token to the Functions emulator
3. Returns the raw response

No data transformation, no caching, no middleware.

---

## Related Documentation

- 📱 [Flutter Web Client Integration Guide](flutter-client-integration.md)
- 🌱 [Local Development & Safe Emulator Seed Guide](local-development-seed-guide.md)
- 📜 [API Reference (All 178 Callables & 8 Triggers)](api-reference.md)
- 🧪 [Testing Architecture & Pipelines](testing-guide.md)


