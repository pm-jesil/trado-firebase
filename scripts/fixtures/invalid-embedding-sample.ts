// Invalid sample demonstrating intentional anti-embedding violations for static analysis tests

export const sampleViolationTeamWithEmbeddedMembers = {
  organizationId: "org_456",
  name: "Sales Team North",
  // VIOLATION: Embedding member list instead of using Membership.teamId
  members: [
    {
      userId: "usr_123",
      name: "Alice Smith",
      email: "alice@apex.com",
      role: "cashier",
      status: "active",
    },
  ],
};

export const sampleViolationOrgWithEmbeddedPlan = {
  name: "Apex Trading Co.",
  businessType: "retail_only",
  // VIOLATION: Embedding full plan document instead of planId reference
  plan: {
    name: "Enterprise Tier",
    price: 9999,
    storageLimitMb: 50000,
    monthlyDocumentVolumeLimit: 100000,
    seatLimits: { admin: 10, staff: 100 },
  },
};

export const sampleViolationMembershipWithEmbeddedUser = {
  organizationId: "org_456",
  roleId: "role_admin",
  // VIOLATION: Embedding full user document instead of userId reference
  user: {
    name: "Bob Jones",
    email: "bob@apex.com",
    phone: "+91 99999 22222",
    accountType: "standard",
    isActive: true,
  },
};
