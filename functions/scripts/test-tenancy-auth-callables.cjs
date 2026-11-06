/**
 * Trado Firebase Backend — Tenancy, Auth & Structure Callable Contract Suite
 * 
 * Exhaustively tests:
 * - General: healthCheck, authMe, permissionCatalogList, modulesList
 * - Organizations: organizationsCreate, organizationsUpdate, organizationsDeactivate, organizationsList
 * - Employees: employeesCreate, employeesUpdate, employeesDeactivate, employeesList
 * - Roles: rolesCreate, rolesUpdate, rolesList
 * - Departments: departmentsCreate, departmentsUpdate, departmentsList
 * - Job Roles: jobRolesCreate, jobRolesUpdate, jobRolesList
 * - Teams: teamsCreate, teamsUpdate, teamsList
 */

const assert = require("node:assert/strict");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");
const { callFunction, assertCallableError } = require("./helpers/callable-client.cjs");
const {
  getSuperAdminPersona,
  createTenantOwnerPersona,
  createEmployeePersona,
  createUnassignedUserPersona,
  db,
} = require("./helpers/auth-personas.cjs");

async function run() {
  console.log("================================================================================");
  console.log("   TRADO TEST SUITE: TENANCY, AUTH & STRUCTURE CALLABLES CONTRACT               ");
  console.log("================================================================================");

  await verifyEmulatorHealth();

  console.log("\n[SETUP] Provisioning test personas...");
  const superAdmin = await getSuperAdminPersona();
  const owner = await createTenantOwnerPersona(superAdmin.idToken, "TenancySuiteOrg");
  const unassigned = await createUnassignedUserPersona();
  console.log(`✓ Super Admin: ${superAdmin.email}`);
  console.log(`✓ Tenant Owner: ${owner.email} (Org: ${owner.organizationId})`);
  console.log(`✓ Unassigned User: ${unassigned.email}`);

  // 1. healthCheck
  console.log("\n[DOMAIN: GENERAL] Testing healthCheck...");
  const healthRes = await callFunction("healthCheck", {}, owner.idToken);
  assert.equal(healthRes.status, "ok", "healthCheck must return ok status");
  console.log("✓ healthCheck returned ok status for authenticated user");

  // 1b. authLogin
  console.log("\n[DOMAIN: GENERAL] Testing authLogin...");
  await assertCallableError(callFunction("authLogin", { email: "fake@trado.local", password: "wrong" }), ["unauthenticated", "invalid-argument"]);
  const loginOwner = await callFunction("authLogin", { email: owner.email, password: "TestPassword123!", deviceId: "device_test_01" });
  assert.ok(loginOwner.credentials?.idToken, "authLogin must return credentials.idToken");
  assert.equal(typeof loginOwner.credentials?.expiresInSeconds, "number", "authLogin must return credentials.expiresInSeconds");
  assert.ok(loginOwner.context, "authLogin must return canonical context");
  assert.equal(loginOwner.context.user?.email, owner.email, "authLogin must return user email in context");
  assert.equal(loginOwner.context.user?.isSuperAdmin, false, "Tenant owner must not be super admin");
  assert.equal(loginOwner.context.role?.roleCode, "org_owner", "Tenant owner must have org_owner role");
  assert.ok(Array.isArray(loginOwner.context.permissions), "permissions must be an array");
  assert.ok(Array.isArray(loginOwner.context.organizations), "organizations must be an array");
  assert.equal(loginOwner.context.primaryOrganization?.organizationId, owner.organizationId, "primaryOrganization must match owner org");
  assert.ok(Array.isArray(loginOwner.context.branches), "branches must be an array");
  assert.ok(loginOwner.context.primaryBranch?.branchId, "primaryBranch must be populated");
  assert.equal(loginOwner.context.device?.deviceId, "device_test_01", "device must be recorded");
  assert.equal(loginOwner.context.contextStatus, "ready", "contextStatus must be ready");
  console.log("✓ authLogin succeeded for tenant owner with complete canonical context and credentials payload");

  const loginAdmin = await callFunction("authLogin", { email: superAdmin.email, password: "TestPassword123!" });
  assert.ok(loginAdmin.credentials?.idToken, "authLogin must return credentials.idToken for Super Admin");
  assert.equal(loginAdmin.context.user?.isSuperAdmin, true, "Super Admin must have isSuperAdmin: true");
  assert.equal(loginAdmin.context.role, null, "Super Admin role must be strictly null");
  assert.equal(loginAdmin.context.primaryOrganization, null, "Super Admin primaryOrganization must be null");
  assert.equal(loginAdmin.context.primaryBranch, null, "Super Admin primaryBranch must be null");
  assert.equal(loginAdmin.context.organizations.length, 0, "Super Admin organizations must be empty array");
  assert.equal(loginAdmin.context.branches.length, 0, "Super Admin branches must be empty array");
  assert.equal(loginAdmin.context.permissions.length, 0, "Super Admin tenant permissions must be strictly empty array");
  assert.ok(loginAdmin.context.platformPermissions.includes("platform:*"), "Super Admin platformPermissions must include platform:*");
  assert.equal(loginAdmin.context.contextStatus, "platform", "Super Admin contextStatus must be platform");
  console.log("✓ authLogin succeeded for Super Admin with verified platform isolation and zero tenant permissions");

  // 2. authMe
  console.log("\n[DOMAIN: GENERAL] Testing authMe...");
  await assertCallableError(callFunction("authMe", {}), ["unauthenticated"]);
  console.log("✓ authMe rejected unauthenticated call");

  const authMeOwner = await callFunction("authMe", { deviceId: "device_test_01" }, owner.idToken);
  assert.equal(authMeOwner.credentials, null, "authMe credentials must be null");
  assert.ok(authMeOwner.context, "authMe must return context");
  assert.equal(authMeOwner.context.role?.roleCode, "org_owner", "Owner must have roleCode org_owner in context");
  assert.equal(authMeOwner.context.primaryBranch?.branchId, "main-branch", "Owner must have default branch main-branch");
  assert.deepEqual(authMeOwner.context.user, loginOwner.context.user, "authMe and authLogin must return identical user context");
  assert.deepEqual(authMeOwner.context.permissions, loginOwner.context.permissions, "authMe and authLogin must return identical permissions");
  assert.deepEqual(authMeOwner.context.organizations, loginOwner.context.organizations, "authMe and authLogin must return identical organizations");
  console.log("✓ authMe correctly resolved canonical AuthSessionContext matching authLogin");

  // 3. permissionCatalogList & modulesList
  console.log("\n[DOMAIN: CATALOGS] Testing permissionCatalogList & modulesList...");
  await assertCallableError(callFunction("permissionCatalogList", {}), ["unauthenticated"]);
  const permsRes = await callFunction("permissionCatalogList", {}, owner.idToken);
  assert.ok(Array.isArray(permsRes.permissions), "permissions must be an array");
  assert.ok(permsRes.permissions.length > 0, "permissions catalog must not be empty");
  console.log(`✓ permissionCatalogList returned ${permsRes.permissions.length} permissions`);

  await assertCallableError(callFunction("modulesList", {}), ["unauthenticated"]);
  const modulesRes = await callFunction("modulesList", {}, owner.idToken);
  assert.ok(Array.isArray(modulesRes.modules), "modules must be an array");
  assert.ok(modulesRes.modules.length > 0, "modules list must not be empty");
  console.log(`✓ modulesList returned ${modulesRes.modules.length} modules`);

  // 4. organizations (CRUD)
  console.log("\n[DOMAIN: ORGANIZATIONS] Testing organizations CRUD...");
  // Unauthorized create attempt
  await assertCallableError(
    callFunction("organizationsCreate", { name: "Illegal Org" }, owner.idToken),
    ["permission-denied"]
  );
  console.log("✓ organizationsCreate rejected non-super-admin caller");

  // Valid organizationsUpdate by Owner
  const newOrgName = "TenancySuiteOrg Renamed";
  const updateOrgRes = await callFunction("organizationsUpdate", {
    organizationId: owner.organizationId,
    name: newOrgName,
  }, owner.idToken);
  assert.ok(updateOrgRes.success, "Update must succeed");
  console.log("✓ organizationsUpdate succeeded for Owner");

  // organizationsList
  const listOrgsSuper = await callFunction("organizationsList", {}, superAdmin.idToken);
  assert.ok(Array.isArray(listOrgsSuper.items), "Must return items array");
  console.log(`✓ organizationsList succeeded for Super Admin (found ${listOrgsSuper.items.length} orgs)`);

  // organizationsDeactivate
  const tempOrg = await createTenantOwnerPersona(superAdmin.idToken, "DeactOrg");
  await assertCallableError(
    callFunction("organizationsDeactivate", { organizationId: tempOrg.organizationId }, owner.idToken),
    ["permission-denied"]
  );
  const deactRes = await callFunction("organizationsDeactivate", {
    organizationId: tempOrg.organizationId,
  }, superAdmin.idToken);
  assert.ok(deactRes.success, "organizationsDeactivate must succeed for Super Admin");
  console.log("✓ organizationsDeactivate succeeded for Super Admin");

  // 5. employees (CRUD)
  console.log("\n[DOMAIN: EMPLOYEES] Testing employees CRUD...");
  
  // 5a. Unauthorized employeesCreate attempt
  const directEmail = `emp.direct.${Date.now()}@example.com`;
  await assertCallableError(
    callFunction("employeesCreate", {
      organizationId: owner.organizationId,
      email: directEmail,
      name: "Direct Staff",
      roleCode: "employee",
      password: "TestPassword123!",
    }, unassigned.idToken),
    ["permission-denied"]
  );

  // 5b. Invalid argument employeesCreate attempt
  await assertCallableError(
    callFunction("employeesCreate", {
      organizationId: owner.organizationId,
      email: "invalid-email-format",
      name: "Bad Staff",
      roleCode: "employee",
      password: "TestPassword123!",
    }, owner.idToken),
    ["invalid-argument"]
  );

  // 5c. Authorized direct employeesCreate call
  const createEmpDirectRes = await callFunction("employeesCreate", {
    organizationId: owner.organizationId,
    email: directEmail,
    name: "Direct Staff",
    roleCode: "employee",
    password: "TestPassword123!",
  }, owner.idToken);
  assert.ok(createEmpDirectRes.userId, "employeesCreate must return userId");
  assert.ok(createEmpDirectRes.membershipId, "employeesCreate must return membershipId");
  assert.equal(createEmpDirectRes.organizationId, owner.organizationId);
  assert.equal(createEmpDirectRes.status, "active");
  console.log(`✓ employeesCreate direct call succeeded (userId: ${createEmpDirectRes.userId})`);

  const employee = await createEmployeePersona(owner.idToken, owner.organizationId, {
    roleCode: "employee",
  });
  console.log(`✓ employeesCreate persona helper succeeded (Created: ${employee.email})`);

  // employeesList
  const empListRes = await callFunction("employeesList", {
    organizationId: owner.organizationId,
  }, owner.idToken);
  assert.ok(Array.isArray(empListRes.items), "employees items must be array");
  assert.ok(empListRes.items.some(e => e.userId === employee.userId), "Created employee must be in list");
  console.log(`✓ employeesList returned ${empListRes.items.length} employees`);

  // employeesUpdate
  const updateEmpRes = await callFunction("employeesUpdate", {
    organizationId: owner.organizationId,
    membershipId: employee.membershipId,
    name: "Staff Employee Updated",
  }, owner.idToken);
  assert.ok(updateEmpRes.success, "employeesUpdate must succeed");
  console.log("✓ employeesUpdate succeeded for Owner");

  // employeesDeactivate
  const deactEmpRes = await callFunction("employeesDeactivate", {
    organizationId: owner.organizationId,
    membershipId: employee.membershipId,
    reason: "Completed temporary contract assignment",
  }, owner.idToken);
  assert.ok(deactEmpRes.success, "employeesDeactivate must succeed");
  console.log("✓ employeesDeactivate succeeded for Owner");

  // 6. roles (CRUD)
  console.log("\n[DOMAIN: ROLES] Testing roles CRUD...");
  const roleName = `Custom Cashier ${Date.now()}`;
  const roleCode = `cashier_${Date.now()}`.slice(0, 20);

  // Unauthorized create attempt
  await assertCallableError(
    callFunction("rolesCreate", {
      organizationId: owner.organizationId,
      name: roleName,
      code: roleCode,
      description: "Custom cashier role description",
      permissions: ["bill:create"],
    }, unassigned.idToken),
    ["permission-denied"]
  );

  const createRoleRes = await callFunction("rolesCreate", {
    organizationId: owner.organizationId,
    name: roleName,
    code: roleCode,
    description: "Custom cashier role description",
    permissions: ["bill:create", "bill:view"],
  }, owner.idToken);
  assert.ok(createRoleRes.roleId, "rolesCreate must return roleId");
  console.log(`✓ rolesCreate succeeded (roleId: ${createRoleRes.roleId})`);

  // rolesUpdate
  const updateRoleRes = await callFunction("rolesUpdate", {
    roleId: createRoleRes.roleId,
    name: `${roleName} Updated`,
    description: "Updated cashier role description",
    permissions: ["bill:create", "bill:view", "customer:view"],
  }, owner.idToken);
  assert.ok(updateRoleRes.success, "rolesUpdate must succeed");
  console.log("✓ rolesUpdate succeeded for Owner");

  // rolesList
  const rolesListRes = await callFunction("rolesList", {
    organizationId: owner.organizationId,
  }, owner.idToken);
  assert.ok(Array.isArray(rolesListRes.roles), "roles must be array");
  console.log(`✓ rolesList returned ${rolesListRes.roles.length} roles`);

  // 7. departments (CRUD)
  console.log("\n[DOMAIN: DEPARTMENTS] Testing departments CRUD...");
  const deptName = `Logistics Dept ${Date.now()}`;
  const createDeptRes = await callFunction("departmentsCreate", {
    organizationId: owner.organizationId,
    name: deptName,
  }, owner.idToken);
  assert.ok(createDeptRes.departmentId, "departmentsCreate must return departmentId");
  console.log(`✓ departmentsCreate succeeded (deptId: ${createDeptRes.departmentId})`);

  // departmentsUpdate
  const updateDeptRes = await callFunction("departmentsUpdate", {
    departmentId: createDeptRes.departmentId,
    name: `${deptName} Updated`,
  }, owner.idToken);
  assert.ok(updateDeptRes.success, "departmentsUpdate must succeed");
  console.log("✓ departmentsUpdate succeeded");

  // departmentsList
  const deptListRes = await callFunction("departmentsList", {
    organizationId: owner.organizationId,
  }, owner.idToken);
  assert.ok(Array.isArray(deptListRes.departments), "departments must be array");
  assert.ok(deptListRes.departments.some(d => d.departmentId === createDeptRes.departmentId));
  console.log(`✓ departmentsList returned ${deptListRes.departments.length} departments`);

  // 8. jobRoles (CRUD)
  console.log("\n[DOMAIN: JOB ROLES] Testing jobRoles CRUD...");
  const jobRoleName = `Inventory Specialist ${Date.now()}`;
  const createJobRoleRes = await callFunction("jobRolesCreate", {
    organizationId: owner.organizationId,
    name: jobRoleName,
  }, owner.idToken);
  assert.ok(createJobRoleRes.jobRoleId, "jobRolesCreate must return jobRoleId");
  console.log(`✓ jobRolesCreate succeeded (jobRoleId: ${createJobRoleRes.jobRoleId})`);

  // jobRolesUpdate
  const updateJobRoleRes = await callFunction("jobRolesUpdate", {
    jobRoleId: createJobRoleRes.jobRoleId,
    name: `${jobRoleName} Updated`,
  }, owner.idToken);
  assert.ok(updateJobRoleRes.success, "jobRolesUpdate must succeed");
  console.log("✓ jobRolesUpdate succeeded");

  // jobRolesList
  const jobRoleListRes = await callFunction("jobRolesList", {
    organizationId: owner.organizationId,
  }, owner.idToken);
  assert.ok(Array.isArray(jobRoleListRes.jobRoles), "jobRoles must be array");
  assert.ok(jobRoleListRes.jobRoles.some(j => j.jobRoleId === createJobRoleRes.jobRoleId));
  console.log(`✓ jobRolesList returned ${jobRoleListRes.jobRoles.length} job roles`);

  // 9. teams (CRUD)
  console.log("\n[DOMAIN: TEAMS] Testing teams CRUD...");
  const teamName = `Front Desk Team ${Date.now()}`;
  const createTeamRes = await callFunction("teamsCreate", {
    organizationId: owner.organizationId,
    name: teamName,
  }, owner.idToken);
  assert.ok(createTeamRes.teamId, "teamsCreate must return teamId");
  console.log(`✓ teamsCreate succeeded (teamId: ${createTeamRes.teamId})`);

  // teamsUpdate
  const updateTeamRes = await callFunction("teamsUpdate", {
    teamId: createTeamRes.teamId,
    name: `${teamName} Updated`,
  }, owner.idToken);
  assert.ok(updateTeamRes.success, "teamsUpdate must succeed");
  console.log("✓ teamsUpdate succeeded");

  // teamsList
  const teamListRes = await callFunction("teamsList", {
    organizationId: owner.organizationId,
  }, owner.idToken);
  assert.ok(Array.isArray(teamListRes.teams), "teams must be array");
  assert.ok(teamListRes.teams.some(t => t.teamId === createTeamRes.teamId));
  console.log(`✓ teamsList returned ${teamListRes.teams.length} teams`);

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 24 TENANCY, AUTH & STRUCTURE CALLABLES VERIFIED SUCCESSFULLY! ✓   ");
  console.log("================================================================================");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
