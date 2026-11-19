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
const sharp = require("sharp");
const { enforceLocalEmulatorSafety, verifyEmulatorHealth, PROJECT_ID } = require("./helpers/emulator-helper.cjs");

const STORAGE_ORIGIN = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199"}`;
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

  // Owner may edit the profile (legal name, tax id, contact) but not the system name
  const updateOrgRes = await callFunction("organizationsUpdate", {
    organizationId: owner.organizationId,
    legalName: "TenancySuiteOrg Renamed",
    taxId: "29ABCDE1234F1Z5",
  }, owner.idToken);
  assert.ok(updateOrgRes.success, "Update must succeed");
  console.log("✓ organizationsUpdate succeeded for Owner (profile fields)");
  await assertCallableError(
    callFunction("organizationsUpdate", { organizationId: owner.organizationId, name: "Legal Rename" }, owner.idToken),
    ["FIELD_NOT_EDITABLE"]
  );
  console.log("✓ organizationsUpdate rejected Owner edit of Super-Admin-only field (name)");

  // organizationsList
  const listOrgsSuper = await callFunction("organizationsList", {}, superAdmin.idToken);
  assert.ok(Array.isArray(listOrgsSuper.items), "Must return items array");
  console.log(`✓ organizationsList succeeded for Super Admin (found ${listOrgsSuper.items.length} orgs)`);

  // organizationsGet
  const getOrgRes = await callFunction("organizationsGet", { organizationId: owner.organizationId }, owner.idToken);
  const org = getOrgRes.organization || getOrgRes;
  assert.ok(org && (org.id === owner.organizationId || org.organizationId === owner.organizationId), "organizationsGet must return organization doc");
  console.log(`✓ organizationsGet succeeded for Tenant Owner (currency: ${org.currency})`);

  // organizationsRevealBankAccount
  await db.collection("organizations").doc(owner.organizationId).update({
    bankAccounts: [
      { id: "ba_tenancy_01", bankName: "State Bank", accountNumber: "123456789012", accountHolderName: "Owner Corp", routingType: "ifsc", routingCode: "SBIN0001234" }
    ]
  });
  const revealRes = await callFunction("organizationsRevealBankAccount", {
    organizationId: owner.organizationId,
    bankAccountId: "ba_tenancy_01",
  }, owner.idToken);
  assert.equal(revealRes.accountNumber, "123456789012", "Must reveal full bank account number");
  console.log("✓ [organizationsRevealBankAccount#ok] organizationsRevealBankAccount revealed full unmasked account to owner");

  // organizationsDeactivate
  const tempOrg = await createTenantOwnerPersona(superAdmin.idToken, "DeactOrg");
  await assertCallableError(
    callFunction("organizationsDeactivate", { organizationId: tempOrg.organizationId }, owner.idToken),
    ["permission-denied"]
  );

  // organizationsPreviewDeactivationImpact
  await assertCallableError(
    callFunction("organizationsPreviewDeactivationImpact", { organizationId: tempOrg.organizationId }, owner.idToken),
    ["permission-denied"]
  );
  const previewDeactRes = await callFunction("organizationsPreviewDeactivationImpact", {
    organizationId: tempOrg.organizationId,
  }, superAdmin.idToken);
  assert.ok(previewDeactRes && typeof previewDeactRes.activeEmployeesCount === "number", "organizationsPreviewDeactivationImpact must return impact metrics");
  console.log(`✓ organizationsPreviewDeactivationImpact succeeded (employees: ${previewDeactRes.activeEmployeesCount}, branches: ${previewDeactRes.activeBranchesCount})`);

  const deactRes = await callFunction("organizationsDeactivate", {
    organizationId: tempOrg.organizationId,
  }, superAdmin.idToken);
  assert.ok(deactRes.success, "organizationsDeactivate must succeed for Super Admin");
  console.log("✓ organizationsDeactivate succeeded for Super Admin");

  // organizationsReactivate
  await assertCallableError(
    callFunction("organizationsReactivate", { organizationId: tempOrg.organizationId }, owner.idToken),
    ["permission-denied"]
  );
  const reactRes = await callFunction("organizationsReactivate", {
    organizationId: tempOrg.organizationId,
  }, superAdmin.idToken);
  assert.ok(reactRes.success && reactRes.status === "active", "organizationsReactivate must succeed for Super Admin");
  console.log("✓ organizationsReactivate restored organization to active status");

  // organizationsGetSubscriptionHistory
  await assertCallableError(
    callFunction("organizationsGetSubscriptionHistory", { organizationId: tempOrg.organizationId }, owner.idToken),
    ["permission-denied"]
  );
  const subHistRes = await callFunction("organizationsGetSubscriptionHistory", {
    organizationId: tempOrg.organizationId,
  }, superAdmin.idToken);
  assert.ok(Array.isArray(subHistRes.items), "organizationsGetSubscriptionHistory must return items array");
  console.log(`✓ organizationsGetSubscriptionHistory returned ${subHistRes.items.length} audit entries`);

  // 4b. Platform Users Directory (platformUsersList, platformUsersGet)
  console.log("\n[DOMAIN: PLATFORM USERS] Testing platformUsersList, platformUsersGet...");
  await assertCallableError(
    callFunction("platformUsersList", {}, owner.idToken),
    ["permission-denied"]
  );
  const platUsersRes = await callFunction("platformUsersList", { limit: 10 }, superAdmin.idToken);
  assert.ok(Array.isArray(platUsersRes.items), "platformUsersList must return items array");
  assert.ok(platUsersRes.count >= 1, "platformUsersList must return at least 1 user");
  console.log(`✓ platformUsersList returned ${platUsersRes.items.length} users with included maps`);

  const testUserId = owner.ownerUserId || owner.ownerUid || platUsersRes.items[0]?.id;
  await assertCallableError(
    callFunction("platformUsersGet", { userId: testUserId }, owner.idToken),
    ["permission-denied"]
  );
  const platUserGetRes = await callFunction("platformUsersGet", { userId: testUserId }, superAdmin.idToken);
  assert.ok(platUserGetRes.user && platUserGetRes.user.id === testUserId, "platformUsersGet must return user doc");
  assert.ok(Array.isArray(platUserGetRes.memberships), "platformUsersGet must return memberships");
  console.log(`✓ platformUsersGet returned user with ${platUserGetRes.memberships.length} memberships and effective permissions`);

  // 5. employees (CRUD)
  console.log("\n[DOMAIN: EMPLOYEES] Testing employees CRUD...");
  
  // 5a. Unauthorized employeesCreate attempt
  const directEmail = `emp.direct.${Date.now()}@example.com`;
  await assertCallableError(
    callFunction("employeesCreate", {
      organizationId: owner.organizationId,
      email: directEmail,
      name: "Direct Staff",
      roleId: "role_employee",
      initialPassword: "TestPassword123!",
    }, unassigned.idToken),
    ["permission-denied"]
  );

  // 5b. Invalid argument employeesCreate attempt
  await assertCallableError(
    callFunction("employeesCreate", {
      organizationId: owner.organizationId,
      email: "invalid-email-format",
      name: "Bad Staff",
      roleId: "role_employee",
      initialPassword: "TestPassword123!",
    }, owner.idToken),
    ["invalid-argument"]
  );

  // 5c. Authorized direct employeesCreate call
  const createEmpDirectRes = await callFunction("employeesCreate", {
    organizationId: owner.organizationId,
    email: directEmail,
    name: "Direct Staff",
    roleId: "role_employee",
    initialPassword: "TestPassword123!",
  }, owner.idToken);
  assert.ok(createEmpDirectRes.userId, "employeesCreate must return userId");
  assert.ok(createEmpDirectRes.membershipId, "employeesCreate must return membershipId");
  assert.equal(createEmpDirectRes.organizationId, owner.organizationId);
  assert.equal(createEmpDirectRes.status, "active");
  console.log(`✓ employeesCreate direct call succeeded (userId: ${createEmpDirectRes.userId})`);

  const employee = await createEmployeePersona(owner.idToken, owner.organizationId, {
    roleId: "role_employee",
  });
  console.log(`✓ employeesCreate persona helper succeeded (Created: ${employee.email})`);

  // employeesList
  const empListRes = await callFunction("employeesList", {
    organizationId: owner.organizationId,
  }, owner.idToken);
  assert.ok(Array.isArray(empListRes.items), "employees items must be array");
  assert.ok(empListRes.items.some(e => e.userId === employee.userId), "Created employee must be in list");
  console.log(`✓ employeesList returned ${empListRes.items.length} employees`);

  // employeesGet
  const getEmpRes = await callFunction("employeesGet", {
    organizationId: owner.organizationId,
    membershipId: employee.membershipId,
  }, owner.idToken);
  const emp = getEmpRes.employee || getEmpRes;
  assert.ok(emp && emp.membershipId === employee.membershipId, "employeesGet must return employee profile");
  console.log(`✓ employeesGet succeeded for Tenant Owner`);

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

  // 10. usersUpdateMe (N-09.1)
  console.log("\n[DOMAIN: USER PROFILE] Testing usersUpdateMe...");
  const updateMeRes = await callFunction("usersUpdateMe", {
    name: "Updated Owner Name",
    phone: "+919876543210",
  }, owner.idToken);
  assert.ok(updateMeRes.success, "usersUpdateMe must succeed");
  console.log("✓ usersUpdateMe updated profile");

  // 11. organizationsProvisionUser (N-02 / D-1)
  console.log("\n[DOMAIN: ONBOARDING] Testing organizationsProvisionUser...");
  const provAdminEmail = `provadmin_${Date.now()}@example.com`;
  const provisionUserRes = await callFunction("organizationsProvisionUser", {
    organizationId: owner.organizationId,
    role: "admin",
    user: {
      name: "Provisioned Admin",
      email: provAdminEmail,
      phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
    reason: "Onboarding test admin",
  }, superAdmin.idToken);
  assert.ok(provisionUserRes.success, "organizationsProvisionUser must succeed");
  assert.ok(provisionUserRes.userId, "must return userId");
  console.log(`✓ organizationsProvisionUser succeeded (userId: ${provisionUserRes.userId})`);

  // 12. organizationsTransferOwnership (N-03)
  console.log("\n[DOMAIN: ONBOARDING] Testing organizationsTransferOwnership...");
  const transferOwnershipRes = await callFunction("organizationsTransferOwnership", {
    organizationId: owner.organizationId,
    newOwnerUserId: provisionUserRes.userId,
    previousOwnerAction: "demote_to_admin",
    reason: "Transfer ownership test",
  }, superAdmin.idToken);
  assert.ok(transferOwnershipRes.success, "organizationsTransferOwnership must succeed");
  console.log("✓ organizationsTransferOwnership succeeded");

  // 13. imagesCreateUploadSession, imagesAttach, imagesRemove (N-06 / N-07)
  console.log("\n[DOMAIN: IMAGE PIPELINE] Testing images callables...");
  const sessionRes = await callFunction("imagesCreateUploadSession", {
    purpose: "user_photo",
    entityType: "user",
    entityId: unassigned.uid,
    contentType: "image/jpeg",
    sizeBytes: 1024,
  }, unassigned.idToken);
  assert.ok(sessionRes.uploadId, "imagesCreateUploadSession must return uploadId");
  assert.ok(sessionRes.uploadPath, "imagesCreateUploadSession must return uploadPath");
  console.log(`✓ imagesCreateUploadSession created session: ${sessionRes.uploadId}`);

  // Query imageUploadSessions directly for collection coverage verification
  const sessionDocSnap = await db.collection("imageUploadSessions").doc(sessionRes.uploadId).get();
  assert.ok(sessionDocSnap.exists, "imageUploadSessions doc must exist");

  // imagesAttach rejection on non-existent storage file
  await assertCallableError(callFunction("imagesAttach", {
    uploadId: sessionRes.uploadId,
    entityType: "user",
    entityId: unassigned.uid,
  }, unassigned.idToken), ["not-found", "invalid-argument"]);
  console.log("✓ imagesAttach rejected missing raw upload in storage as expected");

  // imagesAttach success: a real JPEG uploaded to the session's tmp path as the user (storage.rules
  // apply to this request), attached, then read back from Firestore and Storage.
  const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg().toBuffer();
  const bucket = `${PROJECT_ID}.appspot.com`;
  const storageUrl = (objectPath) => `${STORAGE_ORIGIN}/v0/b/${bucket}/o${objectPath ? `/${encodeURIComponent(objectPath)}` : ""}`;
  const boundary = `boundary_${Date.now()}`;
  const metadata = JSON.stringify({ name: sessionRes.uploadPath, contentType: "image/jpeg" });
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    jpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const upload = await fetch(`${storageUrl()}?uploadType=multipart&name=${encodeURIComponent(sessionRes.uploadPath)}`, {
    method: "POST",
    headers: {
      Authorization: `Firebase ${unassigned.idToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "X-Goog-Upload-Protocol": "multipart",
    },
    body: multipartBody,
  });
  assert.equal(upload.status, 200, `tmp upload by its owner must be allowed by storage.rules (HTTP ${upload.status})`);
  const attachRes = await callFunction("imagesAttach", { uploadId: sessionRes.uploadId, entityType: "user", entityId: unassigned.uid }, unassigned.idToken);
  const storedImage = (await db.collection("users").doc(unassigned.uid).get()).data().image;
  assert.ok(storedImage && storedImage.path, "users.image.path must be stored after imagesAttach");
  assert.deepEqual(storedImage, attachRes.image, "the stored image reference must equal the one imagesAttach returned");
  assert.equal(storedImage.contentType, "image/webp");
  const finalObject = await fetch(storageUrl(storedImage.path), { headers: { Authorization: `Firebase ${unassigned.idToken}` } });
  assert.equal(finalObject.status, 200, "the processed image must exist in Storage at image.path");
  const tmpObject = await fetch(storageUrl(sessionRes.uploadPath), { headers: { Authorization: `Firebase ${unassigned.idToken}` } });
  assert.equal(tmpObject.status, 404, "the tmp upload must be deleted after attach");
  console.log(`✓ imagesAttach processed a real upload: ${storedImage.path} (${storedImage.width}x${storedImage.height} ${storedImage.contentType}), tmp object removed`);

  // imagesRemove
  const removeRes = await callFunction("imagesRemove", {
    entityType: "user",
    entityId: unassigned.uid,
  }, unassigned.idToken);
  assert.ok(removeRes.success, "imagesRemove must succeed");
  console.log("✓ imagesRemove succeeded");

  console.log("\n================================================================================");
  console.log("   [PASS] ALL 24 TENANCY, AUTH & STRUCTURE CALLABLES VERIFIED SUCCESSFULLY! ✓   ");
  console.log("================================================================================");
}

run().catch((err) => {
  console.error("\n[FAIL] Test suite failed:", err);
  process.exit(1);
});
