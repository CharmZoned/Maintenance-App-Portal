/**
 * Plain-language versions of the errors the account approval / role RPCs and
 * PostgREST can return. Admins should never see a constraint name.
 *
 * Messages the RPCs already phrase for people (admin_assign_account_role) pass
 * through unchanged; only raw database / network wording is rewritten.
 */
const RULES: Array<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [
    /user_roles_subject_matches_role/i,
    "This role needs a linked record. Pick the Tenant, Landlord or Staff record this login belongs to, or create one from the sign-up.",
  ],
  [/user_roles_one_tenant/i, "That Tenant record is already linked to another login."],
  [/user_roles_one_landlord/i, "That Landlord record is already linked to another login."],
  [/user_roles_one_staff/i, "That Staff record is already linked to another login."],
  [
    /duplicate key.*(tenants|"Tenants")_email/i,
    "A Tenant record with this email already exists. Link it instead of creating a new one.",
  ],
  [
    /duplicate key.*(landlords|"Landlords")_email/i,
    "A Landlord record with this email already exists. Link it instead of creating a new one.",
  ],
  [
    /duplicate key.*(staff|"Staff")_email/i,
    "A team member with this email already exists. Link it instead of creating a new one.",
  ],
  [/staff_services_allowed/i, "One of the selected trades isn't recognised. Pick from the list."],
  [/staff_phone_length/i, "Phone number is too long (40 characters at most)."],
  [/staff_company_name_length/i, "Company name is too long (120 characters at most)."],
  [
    /Email must be confirmed before approving/i,
    "They haven't confirmed their email yet. Ask them to click the link we emailed, then approve.",
  ],
  [/Cannot remove the last approved admin/i, "You can't remove the last admin. Approve another admin first."],
  [
    /Cannot clear (Staff|Tenant|Landlord) link while approved/i,
    (m) => `This account is approved, so it must stay linked to a ${m[1]} record. Suspend it first to unlink.`,
  ],
  [
    /Only admin, maintenance with Staff link, tenant with Tenant link, or landlord with Landlord link can be approved/i,
    "Link this account to its Tenant, Landlord or Staff record before approving.",
  ],
  [/Assign a role before approving/i, "Choose a role before approving."],
  [/^Only admins/i, "Only admins can do this. Sign in with an admin account."],
  [/forbidden: tenant writes require admin/i, "Only admins can change tenant records."],
  [/JWT expired|invalid JWT/i, "Your session has expired. Sign in again, then retry."],
  [
    /fetch failed|failed to fetch|load failed|networkerror|network request failed/i,
    "Can't reach the server. Check your connection and try again.",
  ],
  [/permission denied|row-level security/i, "You don't have permission to do that."],
  [/violates foreign key constraint/i, "That record no longer exists. Refresh and try again."],
  [/violates check constraint/i, "Some details aren't valid. Check the form and try again."],
  [/duplicate key value/i, "That already exists. Refresh and pick the existing record."],
];

export function friendlyAccountError(message: string | null | undefined): string {
  const raw = (message ?? "").trim();
  if (!raw) return "Something went wrong. Try again.";
  for (const [re, out] of RULES) {
    const m = raw.match(re);
    if (m) return typeof out === "string" ? out : out(m);
  }
  return raw;
}
