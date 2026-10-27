// Valid sample demonstrating correct reference-by-ID usage and justified snapshots

export const sampleValidMembership = {
  userId: "usr_123",
  organizationId: "org_456",
  roleId: "role_admin",
  departmentId: "dept_sales",
  jobRoleIds: ["job_lead_sales"],
  teamId: "team_north",
  reportingToIds: ["mem_manager_01", "mem_director_02"],
  permissions: {
    "bill:create": true,
    "bill:void": false,
  },
  status: "active",
  isPrimary: true,
  createdAt: new Date().toISOString(),
  createdBy: "usr_admin",
};

export const sampleValidOrganization = {
  name: "Apex Trading Co.",
  businessType: "wholesale_retail",
  businessCategory: "general",
  country: "IN",
  currency: "INR",
  taxRegimeCode: "IN_GST",
  status: "active",
  planId: "plan_growth", // Reference by ID only, not embedded plan object
  moduleToggles: {
    billing: true,
    inventory: true,
  },
  logoUrl: "https://storage.googleapis.com/.../logo.png",
  createdAt: new Date().toISOString(),
  createdBy: "usr_superadmin",
};

export const sampleValidTeam = {
  organizationId: "org_456",
  name: "Sales Team North",
  // Notice: NO members array! Canonical relationship is Membership.teamId
};
