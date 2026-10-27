# Phase 1 Cloud Functions Callable API Specification

**Runtime**: Cloud Functions Gen 2 (Node.js 22)  
**Region**: `asia-south1` (Mumbai)  
**Protocol**: Firebase onCall HTTPS Callable Protocol  
**Emulator Endpoint Base**: `http://127.0.0.1:5001/trado-x/asia-south1/<functionName>`

---

## 1. API Directory & Access Matrix

| Logical API Name | Exported JS Symbol | Access Requirement | Permission / Claim Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `health.check` | `healthCheck` | Public / Any | None | Baseline diagnostic callable. |
| `auth.me` | `authMe` | Authenticated | Verified Auth UID | Session bootstrap; returns user, memberships, permissions. |
| `organizations.create` | `organizationsCreate` | Super Admin | `token.isSuperAdmin == true` | Provisions org + owner with compensating rollback. |
| `organizations.update` | `organizationsUpdate` | Tenant Admin / Owner | `org_owner` or `admin` in target org | Updates editable tenant properties. |
| `organizations.deactivate`| `organizationsDeactivate` | Tenant Owner / Super | `org_owner` or `token.isSuperAdmin` | Soft status deactivation. |
| `organizations.list` | `organizationsList` | Super Admin | `token.isSuperAdmin == true` | Paginated listing of organizations. |
| `employees.create` | `employeesCreate` | Tenant Admin / Owner | `employee:create` in target org | Provisions staff user + membership with compensation. |
| `employees.update` | `employeesUpdate` | Tenant Admin / Owner | `employee:update` in target org | Updates membership designation, team, or overrides. |
| `employees.deactivate` | `employeesDeactivate` | Tenant Admin / Owner | `employee:delete` in target org | Soft-deactivates tenant membership. |
| `employees.list` | `employeesList` | Tenant Member | `employee:view` in target org | Paginated employee list for tenant. |
| `roles.create` | `rolesCreate` | Tenant Admin / Super | `role:create` in target org | Creates tenant custom role or system role. |
| `roles.update` | `rolesUpdate` | Tenant Admin / Super | `role:update` in target org | Updates custom role definition. |
| `roles.list` | `rolesList` | Authenticated | Active session | Returns available system & tenant roles. |
| `departments.create` | `departmentsCreate` | Tenant Admin / Super | `department:manage` | Creates department. |
| `departments.update` | `departmentsUpdate` | Tenant Admin / Super | `department:manage` | Updates department. |
| `departments.list` | `departmentsList` | Authenticated | Active session | Lists departments. |
| `jobRoles.create` | `jobRolesCreate` | Tenant Admin / Super | `job_role:manage` | Creates job role designation. |
| `jobRoles.update` | `jobRolesUpdate` | Tenant Admin / Super | `job_role:manage` | Updates job role. |
| `jobRoles.list` | `jobRolesList` | Authenticated | Active session | Lists job roles. |
| `teams.create` | `teamsCreate` | Tenant Admin / Super | `team:manage` | Creates team (without embedded members). |
| `teams.update` | `teamsUpdate` | Tenant Admin / Super | `team:manage` | Updates team name. |
| `teams.list` | `teamsList` | Tenant Member | Active membership in org | Lists teams with dynamic member counts. |
| `plans.create` | `plansCreate` | Super Admin | `token.isSuperAdmin == true` | Creates billing subscription tier. |
| `plans.update` | `plansUpdate` | Super Admin | `token.isSuperAdmin == true` | Modifies subscription plan limits/modules. |
| `plans.list` | `plansList` | Authenticated | Active session | Lists available subscription plans. |
| `permissionCatalog.list` | `permissionCatalogList` | Authenticated | Active session | Returns master RBAC permission catalog. |
| `modules.list` | `modulesList` | Authenticated | Active session | Returns master system modules list. |
| `taxRegimes.list` | `taxRegimesList` | Authenticated | Active session | Returns minimal reference tax regimes. |
| `notifications.registerFcmToken` | `notificationsRegisterFcmToken` | Authenticated | Own Auth UID | Registers device push token; dispatches welcome outbox. |

---

## 2. Detailed Endpoint Contracts

### 2.1 `auth.me` (`authMe`)
- **Method**: Callable `POST`
- **Request Body**: `{ data: {} }`
- **Response**:
```json
{
  "result": {
    "user": {
      "uid": "usr_12345",
      "email": "owner@apex.local",
      "name": "Apex Owner",
      "phone": "+91 99999 11111",
      "accountType": "admin",
      "isActive": true
    },
    "isSuperAdmin": false,
    "memberships": [
      {
        "membershipId": "usr_12345_org_apex",
        "organizationId": "org_apex",
        "organizationName": "Apex Wholesale",
        "roleId": "role_org_owner",
        "roleName": "Organization Owner",
        "status": "active",
        "isPrimary": true
      }
    ],
    "activeContext": {
      "organizationId": "org_apex",
      "roleId": "role_org_owner",
      "roleCode": "org_owner",
      "isOrgOwner": true,
      "effectivePermissions": ["*"],
      "moduleToggles": {
        "billing": true,
        "sales": true,
        "inventory": true
      }
    }
  }
}
```

### 2.2 `organizations.create` (`organizationsCreate`)
- **Access**: Super Admin (`request.auth.token.isSuperAdmin === true`)
- **Request**:
```json
{
  "idempotencyKey": "req-org-create-001",
  "name": "Apex Wholesale Supplies",
  "businessType": "wholesale_retail",
  "businessCategory": "general",
  "country": "IN",
  "currency": "INR",
  "taxRegimeCode": "IN_GST",
  "planId": "plan_growth",
  "ownerEmail": "owner@apexwholesale.local",
  "ownerName": "Rajesh Kumar",
  "ownerPhone": "+919876543210",
  "initialPassword": "TemporaryPassword123!"
}
```
- **Response**:
```json
{
  "result": {
    "organizationId": "org_abc123",
    "ownerUserId": "usr_xyz789",
    "ownerMembershipId": "usr_xyz789_org_abc123",
    "status": "active",
    "message": "Organization and owner provisioned successfully."
  }
}
```
- **Error Codes**:
  - `401 unauthenticated`: Missing auth header.
  - `403 permission-denied`: Caller is not Super Admin.
  - `404 not-found`: Subscription plan does not exist.
  - `409 already-exists`: Idempotency key reused with different payload (`IDEMPOTENCY_CONFLICT`) or concurrent request in flight.

### 2.3 `employees.create` (`employeesCreate`)
- **Access**: Super Admin, or Org Owner / Admin in target organization
- **Request**:
```json
{
  "idempotencyKey": "req-emp-create-001",
  "organizationId": "org_abc123",
  "email": "cashier@apexwholesale.local",
  "name": "Sunita Verma",
  "roleId": "role_cashier",
  "departmentId": "dept_sales",
  "jobRoleIds": ["job_cashier_senior"],
  "teamId": "team_counter_1",
  "reportingToIds": ["usr_manager_org_abc123"],
  "permissionOverrides": {
    "bill:discount": false
  }
}
```
- **Response**:
```json
{
  "result": {
    "userId": "usr_emp456",
    "membershipId": "usr_emp456_org_abc123",
    "organizationId": "org_abc123",
    "status": "active",
    "message": "Employee provisioned successfully."
  }
}
```
- **Error Codes**:
  - `403 permission-denied`: Caller not active admin/owner; or attempted role-tier escalation (e.g. admin creating owner).
  - `429 resource-exhausted`: Subscription plan seat limit reached for the organization.

### 2.4 `notifications.registerFcmToken` (`notificationsRegisterFcmToken`)
- **Access**: Authenticated user registering their own device token
- **Request**:
```json
{
  "deviceId": "dev_pixel_9_pro_uuid",
  "fcmToken": "fcm_token_string_abc...",
  "platform": "android"
}
```
- **Response**:
```json
{
  "result": {
    "success": true,
    "deviceId": "dev_pixel_9_pro_uuid",
    "dispatchedWelcomeCount": 1,
    "message": "FCM token registered successfully."
  }
}
```

