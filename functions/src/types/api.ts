/**
 * Request and Response Data Transfer Objects (DTOs) for Cloud Functions Callables
 */

import type { EffectiveBusinessConfig } from "../constants/businessDefaults.js";
import type { CurrencyDefinition } from "../constants/currencies.js";

// Canonical Session Context DTOs
export type AuthContextStatus =
  | "ready"
  | "platform"
  | "organization_selection_required"
  | "branch_selection_required"
  | "no_active_membership"
  | "organization_inactive" // Organization status is not active (Super Admin locked it)
  | "subscription_expired" // Past expiry + grace: no tenant operations
  | "subscription_suspended" // Suspended or cancelled by the platform
  | "subscription_not_started";

export interface AuthSubscriptionContext {
  state: string; // trial | active | grace | expired | suspended | cancelled | legacy_unset
  planId: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  daysRemaining: number | null;
}

export interface AuthUserContext {
  uid: string;
  email: string;
  name: string;
  phone: string | null;
  /** D-15: computed display URL for the user's image; derived from UserDoc.image.path at read time. Never stored. */
  imageUrl: string | null;
  accountType: string;
  isActive: boolean;
  isSuperAdmin: boolean;
}

export interface AuthRoleContext {
  scope: "platform" | "organization";
  roleId: string | null;
  roleName: string | null;
  roleCode: string | null;
}

export interface AuthJobRoleContext {
  jobRoleId: string;
  name: string;
  code: string;
}

export interface AuthOrganizationContext {
  organizationId: string;
  name?: string;
  roleId?: string;
  roleName?: string;
  isPrimary?: boolean;
}

export interface AuthPrimaryOrganizationContext {
  organizationId: string;
  name?: string;
  currency?: string;
  currencyInfo?: CurrencyDefinition;
  timezone?: string;
  country?: string;
  taxRegimeCode?: string;
  businessType?: string;
  businessCategory?: string;
}

export interface AuthBranchContext {
  branchId: string;
  name: string;
  code: string;
  isDefault: boolean;
}

export interface AuthPrimaryBranchContext {
  branchId: string;
  name: string;
  code: string;
}

export interface AuthDeviceContext {
  deviceId: string;
  recognized: boolean;
}

export interface AuthSessionContext {
  user: AuthUserContext;
  /** Effective business configuration: organization override ?? business-type default (computed). */
  businessConfig?: EffectiveBusinessConfig | null;
  role: AuthRoleContext | null;
  jobRoles: AuthJobRoleContext[];
  permissions: string[];
  platformPermissions: string[];
  organizations: AuthOrganizationContext[];
  primaryOrganization: AuthPrimaryOrganizationContext | null;
  branches: AuthBranchContext[];
  primaryBranch: AuthPrimaryBranchContext | null;
  device: AuthDeviceContext | null;
  contextStatus: AuthContextStatus;
  subscription?: AuthSubscriptionContext | null;
}

// Authentication Login DTOs (Emulator Adapter)

export interface AuthLoginResponse {
  /** D-18: single canonical response — `context` is the one source of truth. */
  context: AuthSessionContext;
  credentials: {
    idToken: string;
    expiresInSeconds: number;
    accessToken?: string;
    refreshToken?: string;
  };
  idToken?: string;
  accessToken?: string;
  refreshToken?: string | null;
}


export interface AuthMeResponse {
  /** D-18: single canonical response — `context` is the one source of truth. */
  context: AuthSessionContext;
  credentials: null;
}

// Organizations

export interface CreateOrganizationResponse {
  organizationId: string;
  ownerUserId?: string | null;
  ownerMembershipId?: string | null;
  status: string;
  ownerStatus?: "pending" | "active";
  temporaryPassword?: string;
  userCreated?: boolean;
  message: string;
}



// Employees / Memberships

export interface CreateEmployeeResponse {
  userId: string;
  membershipId: string;
  organizationId: string;
  status: string;
  message: string;
}




// ============================================================
// Operational Business Layer API Interfaces
// ============================================================

// Products



// Customers


// Vendors


// Outflows


// Bills


// Deliveries



// Returns


// Payments


// Stock Adjustments


// ==========================================
// Operations & Intelligence API Interfaces
// ==========================================

// Reporting






export interface PlatformCurrencyTotals {
  revenue: number;
  outflows: number;
  netCashFlow: number;
  billsCount: number;
  outflowsCount: number;
}

export interface PlatformOverviewReportResponse {
  totalOrganizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  inactiveOrganizations: number;
  organizationsByStatus: Record<string, number>;
  organizationsByCountry: Record<string, number>;
  organizationsByPlan: Record<string, number>;
  availablePlansCount: number;
  totalUsers: number;
  subscriptionsExpiring: Array<{ organizationId: string; name: string; expiresAt: string; daysLeft: number }>;
  atRiskOrganizations: string[];
  topOrganizationsByUsage: Array<{ organizationId: string; currency: string; billsCount: number; revenue: number }>;
  totalsByCurrency: Record<string, PlatformCurrencyTotals>;
  platformFinancials: {
    totalsByCurrency: Record<string, PlatformCurrencyTotals>;
    billsCount: number;
    outflowsCount: number;
  };
  generatedAt: string;
}


// Live Location
export interface RecordLocationPingRequest {
  organizationId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  source?: "foreground" | "background";
}

export interface GetLatestLocationsRequest {
  organizationId: string;
  membershipIds?: string[];
}

export interface GetLocationHistoryRequest {
  organizationId: string;
  membershipId: string;
  from?: string;
  to?: string;
  limit?: number;
}


// ============================================================
// Super Admin Usage Metering & Platform Consumption API Types
// ============================================================



