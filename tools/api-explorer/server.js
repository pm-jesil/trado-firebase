#!/usr/bin/env node
/**
 * Trado Firebase — Local API Explorer Server
 *
 * A minimal Node.js HTTP server (no Express) that:
 *   1. Serves Swagger UI at GET / (locally hosted assets, no CDN)
 *   2. Serves the OpenAPI spec at GET /openapi.json
 *   3. Proxies callable invocations via POST /api/callables/{name}
 *   4. Provides persona login via POST /__local__/auth/login
 *   5. Provides sign-out via POST /__local__/auth/logout
 *   6. Health check via GET /__local__/health
 *   7. Persona list via GET /__local__/personas
 *
 * Binds ONLY to 127.0.0.1. Targets ONLY the local Firebase Emulator Suite.
 * Not a production API gateway. Must never be deployed.
 *
 * Usage:
 *   node tools/api-explorer/server.js              # start on port 3939
 *   node tools/api-explorer/server.js --port 4040  # custom port
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// ── Configuration ────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..", "..");
const OPENAPI_PATH = path.join(ROOT, "docs", "openapi.json");
const MANIFEST_PATH = path.join(ROOT, "tests", "api", "api-manifest.json");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3939;

// Emulator targets — hardcoded loopback. No override allowed.
const FUNCTIONS_HOST = "127.0.0.1";
const FUNCTIONS_PORT = 5001;
const AUTH_HOST = "127.0.0.1";
const AUTH_PORT = 9099;
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8080;
const PROJECT_ID = "trado-x";
const REGION = "asia-south1";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const PROXY_TIMEOUT_MS = 30_000;

// Destructive operations that require explicit confirmation
const DESTRUCTIVE_OPERATIONS = new Set([
  "organizationsDeactivate",
  "branchesDeactivate",
  "employeesDeactivate",
  "tasksDelete",
]);

// ── Parse CLI args ───────────────────────────────────────────────
const args = process.argv.slice(2);
let port = DEFAULT_PORT;
const portIdx = args.indexOf("--port");
if (portIdx !== -1 && args[portIdx + 1]) {
  port = parseInt(args[portIdx + 1], 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("[ERROR] Invalid port. Usage: --port <1-65535>");
    process.exit(1);
  }
}

// ── Safety: reject any live/production flags ─────────────────────
if (args.includes("--target=live") || args.includes("--allow-production") || args.includes("--production")) {
  console.error("[CRITICAL] No live/production mode exists. This tool targets local emulators only.");
  process.exit(1);
}

// ── Load callable allowlist from manifest ────────────────────────
let allowedCallables = new Set();
let triggerNames = new Set();
try {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  manifest.endpoints.forEach((e) => {
    if (e.triggerType === "callable") {
      allowedCallables.add(e.exportName);
    } else {
      triggerNames.add(e.exportName);
    }
  });
  console.log(`[INIT] Loaded ${allowedCallables.size} callable names, ${triggerNames.size} triggers from manifest`);
} catch (err) {
  console.error(`[WARN] Could not load manifest: ${err.message}`);
  console.error("       All callable names will be allowed (no allowlist filtering).");
}

// ── Safety guards ────────────────────────────────────────────────
function assertLocalTarget() {
  const localPatterns = ["127.0.0.1", "localhost", "::1"];
  const fOk = localPatterns.some((p) => FUNCTIONS_HOST.includes(p));
  const aOk = localPatterns.some((p) => AUTH_HOST.includes(p));
  if (!fOk || !aOk) {
    console.error("[CRITICAL] Functions or Auth host is NOT loopback. Aborting.");
    process.exit(1);
  }
  // Reject env overrides pointing to remote hosts
  const envFH = process.env.FIREBASE_FUNCTIONS_HOST || "";
  const envAH = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
  if (envFH && !localPatterns.some((p) => envFH.includes(p))) {
    console.error(`[CRITICAL] FIREBASE_FUNCTIONS_HOST env points to remote: ${envFH}. Aborting.`);
    process.exit(1);
  }
  if (envAH && !localPatterns.some((p) => envAH.includes(p))) {
    console.error(`[CRITICAL] FIREBASE_AUTH_EMULATOR_HOST env points to remote: ${envAH}. Aborting.`);
    process.exit(1);
  }
}
assertLocalTarget();

// ── Helpers ──────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request body too large (max 1 MB)"));
        req.destroy();
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function serveStaticFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(content);
  } catch (_) {
    res.writeHead(404);
    res.end("Not found");
  }
}

function redactAuth(headers) {
  const h = { ...headers };
  if (h.authorization) h.authorization = "Bearer [REDACTED]";
  if (h.Authorization) h.Authorization = "Bearer [REDACTED]";
  return h;
}

function proxyRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (c) => chunks.push(c));
      proxyRes.on("end", () => {
        resolve({
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.setTimeout(PROXY_TIMEOUT_MS, () => {
      req.destroy(new Error("Proxy request timed out"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Seeded personas from current seed system ─────────────────────
const PERSONAS = [
  {
    id: "superadmin",
    label: "Platform Super Admin",
    email: "superadmin@trado.local",
    password: "TestPassword123!",
    description: "Platform-level super administrator with isSuperAdmin claim. Unrestricted platform access.",
    role: "Platform Super Admin",
    organization: "Platform (no tenant)",
    badge: "SUPER ADMIN",
  },
  {
    id: "retail_owner",
    label: "Retail Owner",
    email: "owner@apexwholesale.local",
    password: "TestPassword123!",
    description: "Organization Owner for Retail demo (Apex Retail Supplies). Full tenant administration.",
    role: "Organization Owner",
    organization: "Apex Retail Supplies",
    badge: "RETAIL OWNER",
  },
  {
    id: "retail_admin",
    label: "Retail Admin",
    email: "admin@apexwholesale.local",
    password: "TestPassword123!",
    description: "Organization Admin for Retail demo. Staff and catalog operations.",
    role: "Organization Admin",
    organization: "Apex Retail Supplies",
    badge: "RETAIL ADMIN",
  },
  {
    id: "retail_cashier",
    label: "Retail Cashier",
    email: "cashier@apexwholesale.local",
    password: "TestPassword123!",
    description: "POS billing cashier restricted to main retail branch.",
    role: "Cashier",
    organization: "Apex Retail Supplies",
    badge: "RETAIL CASHIER",
  },
  {
    id: "retail_manager",
    label: "Retail Manager",
    email: "manager@apexwholesale.local",
    password: "TestPassword123!",
    description: "Store Manager for Retail demo. Inventory replenishment & adjustments.",
    role: "Store Manager",
    organization: "Apex Retail Supplies",
    badge: "RETAIL MANAGER",
  },
  {
    id: "retail_rider",
    label: "Retail Rider",
    email: "rider@apexwholesale.local",
    password: "TestPassword123!",
    description: "Delivery Rider for retail order dispatch.",
    role: "Delivery Rider",
    organization: "Apex Retail Supplies",
    badge: "RETAIL RIDER",
  },
  {
    id: "wholesale_owner",
    label: "Wholesale Owner",
    email: "owner@wholesale.trado.local",
    password: "TestPassword123!",
    description: "Organization Owner for Multi-Branch Wholesale demo (Apex Wholesale Hub).",
    role: "Organization Owner",
    organization: "Apex Wholesale Hub",
    badge: "WHOLESALE OWNER",
  },
  {
    id: "wholesale_manager",
    label: "Wholesale Manager",
    email: "manager@wholesale.trado.local",
    password: "TestPassword123!",
    description: "Multi-branch manager with access to both Main HQ and Central Warehouse.",
    role: "Store Manager",
    organization: "Apex Wholesale Hub",
    badge: "WHOLESALE MANAGER",
  },
  {
    id: "wholesale_cashier",
    label: "Wholesale Cashier",
    email: "cashier@wholesale.trado.local",
    password: "TestPassword123!",
    description: "Cashier restricted strictly to Wholesale Main branch.",
    role: "Cashier",
    organization: "Apex Wholesale Hub",
    badge: "WHOLESALE CASHIER",
  },
  {
    id: "wholesale_rider",
    label: "Wholesale Rider",
    email: "rider@wholesale.trado.local",
    password: "TestPassword123!",
    description: "Delivery rider for wholesale orders.",
    role: "Delivery Rider",
    organization: "Apex Wholesale Hub",
    badge: "WHOLESALE RIDER",
  },
  {
    id: "custom",
    label: "Custom Login",
    email: "",
    password: "",
    description: "Sign in with any email/password from the Auth emulator. Use for testing custom personas.",
    role: "Any",
    organization: "Any",
    badge: "CUSTOM",
  },
];

// ── Auth: exchange credentials for ID token via Auth emulator ────
async function authLogin(email, password, deviceId = null) {
  const payload = JSON.stringify({
    email,
    password,
    returnSecureToken: true,
  });
  const result = await proxyRequest(
    {
      hostname: AUTH_HOST,
      port: AUTH_PORT,
      path: "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    payload
  );
  const data = JSON.parse(result.body);
  if (result.status !== 200 || data.error) {
    return { ok: false, error: data.error?.message || "Login failed" };
  }

  const isSuperAdmin = email === "superadmin@trado.local";
  const persona = PERSONAS.find((p) => p.email === email);
  const userName = data.displayName || (persona ? persona.label : "User");

  const expiresInSeconds = parseInt(data.expiresIn || "3600", 10);
  const context = {
    user: {
      uid: data.localId,
      email: data.email,
      name: userName,
      phone: null,
      avatarUrl: null,
      accountType: isSuperAdmin ? "super_admin" : "staff",
      isActive: true,
      isSuperAdmin,
    },
    role: isSuperAdmin
      ? { scope: "platform", roleId: null, roleName: "Platform Super Admin", roleCode: "super_admin" }
      : {
          scope: "organization",
          roleId: persona ? `role_${persona.role.toLowerCase().replace(/\s+/g, "_")}` : "role_employee",
          roleName: persona ? persona.role : "Standard Employee",
          roleCode: persona?.badge === "RETAIL OWNER" || persona?.badge === "WHOLESALE OWNER" ? "org_owner" : "employee",
        },
    jobRoles: [],
    permissions: isSuperAdmin ? [] : ["bill:view", "bill:create", "stock:view"],
    platformPermissions: isSuperAdmin ? ["platform:*"] : [],
    organizations: isSuperAdmin
      ? []
      : [
          {
            organizationId: persona?.id.includes("wholesale") ? "org_wholesale_sample" : "org_apex_sample",
            name: persona ? persona.organization : "Apex Retail Supplies",
            isPrimary: true,
          },
        ],
    primaryOrganization: isSuperAdmin
      ? null
      : {
          organizationId: persona?.id.includes("wholesale") ? "org_wholesale_sample" : "org_apex_sample",
          name: persona ? persona.organization : "Apex Retail Supplies",
        },
    branches: isSuperAdmin
      ? []
      : [
          {
            branchId: "main-branch",
            name: "Main Retail Outlet",
            code: "MAIN",
            isDefault: true,
          },
        ],
    primaryBranch: isSuperAdmin
      ? null
      : {
          branchId: "main-branch",
          name: "Main Retail Outlet",
          code: "MAIN",
        },
    device: deviceId ? { deviceId, recognized: true } : null,
    contextStatus: isSuperAdmin ? "platform" : "ready",
  };

  return {
    ok: true,
    idToken: data.idToken,
    accessToken: data.idToken,
    refreshToken: data.refreshToken || null,
    credentials: {
      idToken: data.idToken,
      expiresInSeconds,
    },
    context,
    localId: data.localId,
    displayName: userName,
    email: data.email,
    deviceId: deviceId || undefined,
    deviceRegistered: Boolean(deviceId),
    // Compatibility fields for legacy explorer UI consumers
    profile: context.user,
    user: context.user,
    isSuperAdmin,
    role: context.role,
    jobRoles: context.jobRoles,
    permissions: context.permissions,
    platformPermissions: context.platformPermissions,
    organizations: context.organizations,
    primaryOrganization: context.primaryOrganization,
    branches: context.branches,
    primaryBranch: context.primaryBranch,
  };
}

// ── Proxy callable to Functions emulator ─────────────────────────
async function proxyCallable(name, body, authHeader) {
  const funcPath = `/${PROJECT_ID}/${REGION}/${name}`;
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }
  return proxyRequest(
    {
      hostname: FUNCTIONS_HOST,
      port: FUNCTIONS_PORT,
      path: funcPath,
      method: "POST",
      headers,
    },
    body
  );
}

// ── Swagger UI: locally hosted from swagger-ui-dist ──────────────
let swaggerUiDir = null;
try {
  swaggerUiDir = path.dirname(require.resolve("swagger-ui-dist/package.json", {
    paths: [path.join(ROOT, "functions", "node_modules")],
  }));
} catch (_) {
  // Fallback: check common locations
  const fallback = path.join(ROOT, "functions", "node_modules", "swagger-ui-dist");
  if (fs.existsSync(path.join(fallback, "swagger-ui-bundle.js"))) {
    swaggerUiDir = fallback;
  }
}

const SWAGGER_UI_AVAILABLE = !!swaggerUiDir;

function getSwaggerHtml() {
  const swaggerJsPath = SWAGGER_UI_AVAILABLE ? "/swagger-ui/swagger-ui-bundle.js" : "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js";
  const swaggerCssPath = SWAGGER_UI_AVAILABLE ? "/swagger-ui/swagger-ui.css" : "https://unpkg.com/swagger-ui-dist@5/swagger-ui.css";
  const offlineNote = SWAGGER_UI_AVAILABLE
    ? "<!-- Swagger UI: locally hosted from swagger-ui-dist (offline capable) -->"
    : "<!-- Swagger UI: loaded from CDN (install swagger-ui-dist for offline use) -->";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trado Backend API Explorer — Local Emulator</title>
  ${offlineNote}
  <link rel="stylesheet" href="${swaggerCssPath}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

    .trado-banner {
      background: linear-gradient(135deg, #d32f2f 0%, #b71c1c 100%);
      color: white;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      letter-spacing: 0.5px;
      position: sticky;
      top: 0;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .trado-banner .project-badge {
      background: rgba(255,255,255,0.2);
      padding: 2px 10px;
      border-radius: 4px;
      margin: 0 8px;
      font-family: monospace;
    }

    .trado-status-bar {
      display: flex;
      gap: 16px;
      justify-content: center;
      align-items: center;
      background: #263238;
      color: #b0bec5;
      padding: 6px 16px;
      font-size: 12px;
      font-family: monospace;
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .status-dot.ok { background: #4caf50; }
    .status-dot.err { background: #f44336; }
    .status-dot.checking { background: #ff9800; }

    .trado-auth-panel {
      background: #f5f5f5;
      border-bottom: 2px solid #e0e0e0;
      padding: 16px 24px;
    }
    .trado-auth-panel h3 { font-size: 15px; color: #333; margin-bottom: 10px; }
    .persona-grid { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .persona-btn {
      padding: 8px 16px;
      border: 2px solid #1976d2;
      background: white;
      color: #1976d2;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .persona-btn:hover { background: #1976d2; color: white; }
    .persona-btn.active { background: #1976d2; color: white; }
    .signout-btn {
      padding: 6px 14px;
      border: 2px solid #c62828;
      background: white;
      color: #c62828;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      margin-left: 8px;
      display: none;
    }
    .signout-btn:hover { background: #c62828; color: white; }
    .signout-btn.visible { display: inline-block; }

    .custom-login { display: none; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
    .custom-login.visible { display: flex; }
    .custom-login input {
      padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; width: 220px;
    }
    .custom-login button {
      padding: 6px 16px; background: #388e3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
    }
    .auth-status { margin-top: 8px; font-size: 13px; padding: 6px 12px; border-radius: 4px; }
    .auth-status.success { background: #e8f5e9; color: #2e7d32; }
    .auth-status.error { background: #ffebee; color: #c62828; }
    .auth-status.info { background: #e3f2fd; color: #1565c0; }

    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin-top: 12px; }
    #swagger-ui { padding-bottom: 40px; }
    .trado-footer { text-align: center; padding: 12px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="trado-banner">
    ⚠️ LOCAL FIREBASE EMULATOR — <span class="project-badge">${PROJECT_ID}</span> — NOT PRODUCTION ⚠️
  </div>

  <div class="trado-status-bar" id="statusBar">
    <span><span class="status-dot checking" id="dotFunctions"></span>Functions :${FUNCTIONS_PORT}</span>
    <span><span class="status-dot checking" id="dotAuth"></span>Auth :${AUTH_PORT}</span>
    <span><span class="status-dot checking" id="dotFirestore"></span>Firestore :${FIRESTORE_PORT}</span>
    <span>Project: ${PROJECT_ID} | Region: ${REGION}</span>
  </div>

  <div class="trado-auth-panel">
    <h3>🔐 Sign In as a Persona <button class="signout-btn" id="signoutBtn" onclick="doSignOut()">Sign Out</button></h3>
    <div class="persona-grid" id="personaGrid"></div>
    <div class="custom-login" id="customLogin">
      <input type="email" id="customEmail" placeholder="email@example.com" autocomplete="off" />
      <input type="password" id="customPassword" placeholder="password" autocomplete="off" />
      <button onclick="doCustomLogin()">Sign In</button>
    </div>
    <div class="auth-status info" id="authStatus">Not signed in — select a persona above to authorize requests</div>
  </div>

  <div id="swagger-ui"></div>

  <div class="trado-footer">
    Trado Backend API Explorer v1.0 — local emulator only — Functions ${FUNCTIONS_HOST}:${FUNCTIONS_PORT} — Auth ${AUTH_HOST}:${AUTH_PORT}
  </div>

  <script src="${swaggerJsPath}"></script>
  <script>
    // ── Emulator status check ────────────────────────────
    async function checkEmulatorStatus() {
      async function checkPort(name, dotId, port) {
        const dot = document.getElementById(dotId);
        try {
          const res = await fetch('/__local__/health');
          const data = await res.json();
          const key = name.toLowerCase();
          const ok = data.emulators?.[key]?.reachable;
          dot.className = 'status-dot ' + (ok ? 'ok' : 'err');
        } catch (_) {
          dot.className = 'status-dot err';
        }
      }
      // Single health call checks all
      try {
        const res = await fetch('/__local__/health');
        const data = await res.json();
        document.getElementById('dotFunctions').className = 'status-dot ' + (data.emulators?.functions?.reachable ? 'ok' : 'err');
        document.getElementById('dotAuth').className = 'status-dot ' + (data.emulators?.auth?.reachable ? 'ok' : 'err');
        document.getElementById('dotFirestore').className = 'status-dot ' + (data.emulators?.firestore?.reachable ? 'ok' : 'err');
      } catch (_) {
        ['dotFunctions','dotAuth','dotFirestore'].forEach(id =>
          document.getElementById(id).className = 'status-dot err');
      }
    }
    checkEmulatorStatus();
    setInterval(checkEmulatorStatus, 15000);

    // ── Persona login logic ──────────────────────────────
    const personas = ${JSON.stringify(PERSONAS.map(p => ({id: p.id, label: p.label, email: p.email, description: p.description, role: p.role, organization: p.organization, badge: p.badge})))};
    let currentToken = null;
    let currentPersona = null;

    function renderPersonas() {
      const grid = document.getElementById('personaGrid');
      personas.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'persona-btn';
        btn.textContent = p.label + (p.badge ? ' [' + p.badge + ']' : '');
        btn.title = p.description + '\\nRole: ' + p.role + '\\nOrg: ' + p.organization;
        btn.dataset.id = p.id;
        btn.setAttribute('aria-label', 'Sign in as ' + p.label);
        btn.onclick = () => selectPersona(p);
        grid.appendChild(btn);
      });
    }

    async function selectPersona(p) {
      document.querySelectorAll('.persona-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-id="' + p.id + '"]').classList.add('active');

      if (p.id === 'custom') {
        document.getElementById('customLogin').classList.add('visible');
        setStatus('Enter email and password, then click Sign In', 'info');
        return;
      }
      document.getElementById('customLogin').classList.remove('visible');
      await doLogin(p.email, p.label);
    }

    async function doCustomLogin() {
      const email = document.getElementById('customEmail').value.trim();
      const pass = document.getElementById('customPassword').value;
      if (!email) { setStatus('Enter an email address', 'error'); return; }
      await doLogin(email, email, pass);
    }

    async function doLogin(email, label, password) {
      setStatus('Signing in as ' + label + '...', 'info');
      try {
        const body = { email };
        if (password) body.password = password;
        const res = await fetch('/__local__/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
          currentToken = null;
          currentPersona = null;
          setStatus('Login failed: ' + (data.error || 'unknown error'), 'error');
          updateSignoutBtn();
          applyToken();
          return;
        }
        currentToken = data.idToken;
        currentPersona = { email: data.email, displayName: data.displayName, uid: data.localId };
        setStatus('✅ Signed in as ' + (data.displayName || data.email) + ' (uid: ' + data.localId + ') — token applied to all requests', 'success');
        updateSignoutBtn();
        applyToken();
      } catch (err) {
        currentToken = null;
        currentPersona = null;
        setStatus('Login error: ' + err.message, 'error');
        updateSignoutBtn();
        applyToken();
      }
    }

    function doSignOut() {
      currentToken = null;
      currentPersona = null;
      document.querySelectorAll('.persona-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('customLogin').classList.remove('visible');
      setStatus('Signed out — select a persona to authorize requests', 'info');
      updateSignoutBtn();
      applyToken();
    }

    function updateSignoutBtn() {
      document.getElementById('signoutBtn').className = 'signout-btn' + (currentToken ? ' visible' : '');
    }

    function setStatus(msg, type) {
      const el = document.getElementById('authStatus');
      el.textContent = msg;
      el.className = 'auth-status ' + type;
    }

    function applyToken() {
      if (window.ui) {
        window.ui.preauthorizeApiKey('bearerAuth', currentToken || '');
      }
    }

    // ── Swagger UI init ──────────────────────────────────
    renderPersonas();

    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      filter: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: 'BaseLayout',
      requestInterceptor: (req) => {
        if (currentToken && !req.headers['Authorization']) {
          req.headers['Authorization'] = 'Bearer ' + currentToken;
        }
        const destructiveOps = ['organizationsDeactivate', 'branchesDeactivate', 'employeesDeactivate', 'tasksDelete'];
        const urlParts = (req.url || '').split('/');
        const opName = urlParts[urlParts.length - 1];
        if (destructiveOps.includes(opName)) {
          const ok = window.confirm('⚠️ DESTRUCTIVE OPERATION WARNING\\n\\nYou are about to execute: ' + opName + '\\nThis operation may deactivate or delete live emulator state.\\n\\nClick OK to confirm and proceed, or Cancel to abort.');
          if (!ok) {
            throw new Error('Operation cancelled by user');
          }
          req.headers['x-trado-confirmed'] = 'true';
        } else if (req.method === 'POST' && req.url && req.url.includes('/api/callables/')) {
          req.headers['x-trado-confirmed'] = 'true';
        }
        return req;
      },
      onComplete: () => {
        applyToken();
      },
    });
  </script>
</body>
</html>`;
}

// ── Route handling ───────────────────────────────────────────────
async function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method.toUpperCase();

  // Validate Host header (must be loopback)
  const hostHeader = (req.headers["host"] || "").split(":")[0];
  const allowedHosts = ["127.0.0.1", "localhost", "::1"];
  if (hostHeader && !allowedHosts.includes(hostHeader)) {
    sendJson(res, 403, { error: `Forbidden: invalid Host header '${hostHeader}'. Loopback only.` });
    return;
  }

  // Validate Origin header if present (reject remote cross-origins)
  const originHeader = req.headers["origin"];
  if (originHeader) {
    const isLocalOrigin = allowedHosts.some((h) => originHeader.includes(h));
    if (!isLocalOrigin) {
      sendJson(res, 403, { error: `Forbidden: cross-origin requests from '${originHeader}' are rejected.` });
      return;
    }
  }

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // Reject non-JSON content type on POST
  if (method === "POST" && !pathname.startsWith("/swagger-ui/")) {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      sendJson(res, 415, { error: "Content-Type must be application/json" });
      return;
    }
  }

  // GET / → Swagger UI HTML
  if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    sendHtml(res, getSwaggerHtml());
    return;
  }

  // GET /swagger-ui/* → serve local swagger-ui-dist assets
  if (method === "GET" && pathname.startsWith("/swagger-ui/") && swaggerUiDir) {
    const fileName = pathname.replace("/swagger-ui/", "");
    // Security: reject path traversal
    if (fileName.includes("..") || fileName.includes("\\") || !fileName.match(/^[a-zA-Z0-9._-]+$/)) {
      res.writeHead(400);
      res.end("Invalid path");
      return;
    }
    const filePath = path.join(swaggerUiDir, fileName);
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".map": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    serveStaticFile(res, filePath, mimeTypes[ext] || "application/octet-stream");
    return;
  }

  // GET /openapi.json → serve OpenAPI spec
  if (method === "GET" && pathname === "/openapi.json") {
    try {
      const spec = fs.readFileSync(OPENAPI_PATH, "utf8");
      const specObj = JSON.parse(spec);
      specObj.servers = [
        {
          url: `http://127.0.0.1:${port}`,
          description: "Trado API Explorer local proxy (emulator only)",
        },
      ];
      sendJson(res, 200, specObj);
    } catch (err) {
      sendJson(res, 500, {
        error: `Cannot read OpenAPI spec: ${err.message}. Run: node scripts/generate-openapi.js`,
      });
    }
    return;
  }

  // GET /__local__/health → health check with emulator connectivity
  if (method === "GET" && pathname === "/__local__/health") {
    let functionsOk = false;
    let authOk = false;
    let firestoreOk = false;
    try {
      await proxyRequest({ hostname: FUNCTIONS_HOST, port: FUNCTIONS_PORT, path: "/", method: "GET", headers: {} });
      functionsOk = true;
    } catch (_) {}
    try {
      await proxyRequest({ hostname: AUTH_HOST, port: AUTH_PORT, path: "/", method: "GET", headers: {} });
      authOk = true;
    } catch (_) {}
    try {
      await proxyRequest({ hostname: FIRESTORE_HOST, port: FIRESTORE_PORT, path: "/", method: "GET", headers: {} });
      firestoreOk = true;
    } catch (_) {}

    sendJson(res, 200, {
      status: functionsOk && authOk && firestoreOk ? "ok" : "degraded",
      explorer: "running",
      projectId: PROJECT_ID,
      region: REGION,
      emulators: {
        functions: { host: `${FUNCTIONS_HOST}:${FUNCTIONS_PORT}`, reachable: functionsOk },
        auth: { host: `${AUTH_HOST}:${AUTH_PORT}`, reachable: authOk },
        firestore: { host: `${FIRESTORE_HOST}:${FIRESTORE_PORT}`, reachable: firestoreOk },
      },
      callableCount: allowedCallables.size,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // GET /__local__/personas → list available test personas (no passwords)
  if (method === "GET" && pathname === "/__local__/personas") {
    const safePersonas = PERSONAS.map((p) => ({
      id: p.id,
      label: p.label,
      email: p.email,
      description: p.description,
      role: p.role,
      organization: p.organization,
    }));
    sendJson(res, 200, { personas: safePersonas });
    return;
  }

  // POST /__local__/auth/login → authenticate against Auth emulator
  if (method === "POST" && pathname === "/__local__/auth/login") {
    try {
      const body = await readBody(req);
      const { email, password, deviceId } = JSON.parse(body);
      if (!email) {
        sendJson(res, 400, { ok: false, error: "email is required" });
        return;
      }
      // Find matching persona or use provided password
      const persona = PERSONAS.find((p) => p.email === email && p.id !== "custom");
      const pwd = password || (persona ? persona.password : null);
      if (!pwd) {
        sendJson(res, 400, { ok: false, error: "password is required for custom login" });
        return;
      }
      const result = await authLogin(email, pwd, deviceId);
      // Never log the token
      if (result.ok) {
        console.log(`[AUTH] Login: ${result.email} (uid: ${result.localId})`);
      }
      sendJson(res, result.ok ? 200 : 401, result);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // POST /__local__/auth/logout → clear session (client-side only, acknowledges)
  if (method === "POST" && pathname === "/__local__/auth/logout") {
    sendJson(res, 200, { ok: true, message: "Session cleared. Token is client-side only." });
    return;
  }

  // POST /api/callables/{name} → proxy to Functions emulator
  const callableMatch = pathname.match(/^\/api\/callables\/([a-zA-Z0-9_]+)$/);
  if (method === "POST" && callableMatch) {
    const name = callableMatch[1];

    // Reject trigger names
    if (triggerNames.has(name)) {
      sendJson(res, 400, {
        error: `"${name}" is a Firestore background trigger, not an HTTP callable. It fires automatically on document writes.`,
        hint: "Background triggers cannot be invoked via the API Explorer.",
      });
      return;
    }

    // Allowlist check
    if (allowedCallables.size > 0 && !allowedCallables.has(name)) {
      sendJson(res, 404, {
        error: `Unknown callable: "${name}". Not found in api-manifest.json.`,
        hint: "Check /openapi.json for available callables.",
      });
      return;
    }

    // Confirmation check for destructive operations
    if (DESTRUCTIVE_OPERATIONS.has(name) && req.headers["x-trado-confirmed"] !== "true") {
      sendJson(res, 400, {
        error: `Explicit confirmation required for destructive operation: "${name}".`,
        hint: "Pass header 'x-trado-confirmed: true' or confirm the browser prompt in API Explorer to proceed.",
      });
      return;
    }

    try {
      const body = await readBody(req);

      // Validate JSON
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (_) {
        sendJson(res, 400, { error: "Invalid JSON in request body" });
        return;
      }

      const authHeader = req.headers["authorization"] || null;

      // Ensure body is wrapped in {data: ...} envelope
      let wrappedBody;
      if (parsed.hasOwnProperty("data")) {
        wrappedBody = body;
      } else {
        wrappedBody = JSON.stringify({ data: parsed });
      }

      console.log(`[PROXY] ${name} (auth: ${authHeader ? "yes" : "no"})`);

      const result = await proxyCallable(name, wrappedBody, authHeader);

      // Forward response with CORS
      res.writeHead(result.status, {
        "Content-Type": result.headers["content-type"] || "application/json",
        "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(result.body);
    } catch (err) {
      sendJson(res, 502, {
        error: `Proxy error: ${err.message}`,
        hint: "Is the Functions emulator running? Start with: npx firebase-tools emulators:start --project trado-x",
      });
    }
    return;
  }

  // Also support /callables/{name} as alias for backward compatibility
  const legacyCallableMatch = pathname.match(/^\/callables\/([a-zA-Z0-9_]+)$/);
  if (method === "POST" && legacyCallableMatch) {
    // Redirect to canonical path
    req.url = `/api${pathname}`;
    return handleRequest(req, res);
  }

  // 404 fallback
  sendJson(res, 404, {
    error: "Not found",
    routes: {
      "GET /": "Swagger UI (API Explorer)",
      "GET /openapi.json": "OpenAPI 3.0 specification",
      "POST /api/callables/{name}": "Invoke a callable function",
      "POST /__local__/auth/login": "Get an Auth emulator ID token",
      "POST /__local__/auth/logout": "Clear session",
      "GET /__local__/health": "Health check",
      "GET /__local__/personas": "List available test personas",
    },
  });
}

// ── Start server ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error(`[ERROR] ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" });
    }
  }
});

if (require.main === module) {
  server.listen(port, HOST, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║       🔥 Trado Backend API Explorer — Local Emulator 🔥     ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  Swagger UI:  http://${HOST}:${port}/`);
    console.log(`║  OpenAPI:     http://${HOST}:${port}/openapi.json`);
    console.log(`║  Health:      http://${HOST}:${port}/__local__/health`);
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  Functions:   ${FUNCTIONS_HOST}:${FUNCTIONS_PORT}`);
    console.log(`║  Auth:        ${AUTH_HOST}:${AUTH_PORT}`);
    console.log(`║  Firestore:   ${FIRESTORE_HOST}:${FIRESTORE_PORT}`);
    console.log(`║  Project:     ${PROJECT_ID}  Region: ${REGION}`);
    console.log(`║  Callables:   ${allowedCallables.size} loaded  Triggers: ${triggerNames.size} (not callable)`);
    console.log(`║  Swagger UI:  ${SWAGGER_UI_AVAILABLE ? "locally hosted (offline)" : "CDN (install swagger-ui-dist for offline)"}`);
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log("║  ⚠️  LOCAL EMULATOR ONLY — NOT PRODUCTION                   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[ERROR] Port ${port} is already in use. Try --port <number>`);
    } else {
      console.error("[ERROR]", err.message);
    }
    process.exit(1);
  });
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = { HOST, FUNCTIONS_HOST, AUTH_HOST, PROJECT_ID, REGION, allowedCallables, triggerNames, assertLocalTarget, DESTRUCTIVE_OPERATIONS, PERSONAS };
}
