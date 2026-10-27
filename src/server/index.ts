import { Hono, type Context } from "hono";
import { z } from "zod";
import { initDB, query, get, run, type DbEnv } from "./db";

type Env = { Bindings: DbEnv };

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  initDB(c.env);
  await ensureSettings();
  await next();
});

const DEFAULT_SETTINGS: Record<string, string> = {
  default_rent_due_day: "1",
  late_fee_amount: "50",
  late_fee_grace_days: "5",
  currency: "USD",
};

let settingsReady = false;

/** Seed default Settings keys only — never auto-insert portfolio rows into shared Supabase. */
async function ensureSettings(): Promise<void> {
  if (settingsReady) return;
  settingsReady = true;
  try {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await run(
        `INSERT INTO "Settings" (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO NOTHING`,
        [key, value],
      );
    }
  } catch {
    settingsReady = false;
  }
}

const intParam = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, data: parsed.data };
}

function buildUpdate(fields: Record<string, unknown>): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`"${k}" = ?`);
      params.push(v);
    }
  }
  return { sets, params };
}

const PROPERTY_TYPES = [
  "Single-family", "Multi-family", "Condo", "Townhouse",
  "Apartment building", "Commercial", "Other",
] as const;

const UNIT_STATUSES = ["Occupied", "Vacant"] as const;
const READINESS = ["Ready", "Turnover Needed", "Turnover In Progress", "Rehab Needed", "Rehab In Progress"] as const;
const MGMT = ["Active", "No Longer Managed"] as const;
const PROP_MGMT = ["Active", "Partially Managed", "No Longer Managed"] as const;
const CONTACT = ["Email", "Phone", "Either"] as const;
const MR_PRIORITY = ["Low", "Normal", "High", "Urgent"] as const;
const MR_STATUS = ["Open", "Scheduled", "In Progress", "On Hold", "Closed"] as const;
const MR_CATEGORY = [
  "Plumbing", "Electrical", "Heating / AC", "Appliance", "Pest control",
  "Locks / keys / doors", "Windows", "Roof / leaks", "Mold / water damage",
  "Exterior / yard", "General repair", "Other",
] as const;

// ── Landlords ──────────────────────────────────────────────────────

const LandlordInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  company_name: z.string().optional().nullable(),
  email: z.string().email(),
  mobile_phone: z.string().optional().nullable(),
  preferred_contact: z.enum(CONTACT).optional().nullable(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
  source_id: z.string().optional(),
});

app.get("/api/landlords", async (c) => {
  const rows = await query(
    `SELECT l.*,
       (SELECT COUNT(*)::int FROM "Properties" p WHERE p.landlord_id = l.id) AS property_count
     FROM "Landlords" l
     ORDER BY l.last_name, l.first_name`,
  );
  return c.json({ landlords: rows });
});

app.get("/api/landlords/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`SELECT * FROM "Landlords" WHERE id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  const properties = await query(`SELECT * FROM "Properties" WHERE landlord_id = ? ORDER BY property_name`, [id]);
  return c.json({ landlord: row, properties });
});

app.post("/api/landlords", async (c) => {
  const parsed = await parseJson(c, LandlordInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Landlords" (first_name, last_name, company_name, email, mobile_phone, preferred_contact, notes, is_test_data, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'app-' || gen_random_uuid()::text))`,
    [
      d.first_name, d.last_name, d.company_name ?? null, d.email,
      d.mobile_phone ?? null, d.preferred_contact ?? null, d.notes ?? null,
      d.is_test_data ?? false, d.source_id ?? null,
    ],
  );
  const row = await get(`SELECT * FROM "Landlords" WHERE id = ?`, [result.lastInsertRowid]);
  return c.json({ landlord: row }, 201);
});

app.put("/api/landlords/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, LandlordInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Landlords" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`SELECT * FROM "Landlords" WHERE id = ?`, [id]);
  return c.json({ landlord: row });
});

app.delete("/api/landlords/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Landlords" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Properties ─────────────────────────────────────────────────────

const PropertyInput = z.object({
  property_name: z.string().min(1).optional().nullable(),
  street_address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  zip: z.string().regex(/^[0-9]{5}$/),
  property_type: z.enum(PROPERTY_TYPES),
  landlord_id: z.number().int(),
  notes: z.string().optional().nullable(),
  management_status: z.enum(PROP_MGMT).optional(),
  management_end_date: z.string().optional().nullable(),
  year_built: z.number().int().optional().nullable(),
  color: z.string().optional(),
  is_test_data: z.boolean().optional(),
  source_id: z.string().optional(),
});

app.get("/api/properties", async (c) => {
  const rows = await query(
    `SELECT p.*,
       l.first_name AS landlord_first_name,
       l.last_name AS landlord_last_name,
       l.company_name AS landlord_company_name,
       (SELECT COUNT(*)::int FROM "Units" u WHERE u.property_id = p.id) AS unit_count,
       (SELECT COUNT(*)::int FROM "Units" u WHERE u.property_id = p.id AND u.status = 'Occupied') AS occupied_count
     FROM "Properties" p
     LEFT JOIN "Landlords" l ON l.id = p.landlord_id
     ORDER BY COALESCE(p.property_name, p.street_address)`,
  );
  return c.json({ properties: rows });
});

app.get("/api/properties/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(
    `SELECT p.*,
       l.first_name AS landlord_first_name,
       l.last_name AS landlord_last_name,
       l.company_name AS landlord_company_name,
       l.email AS landlord_email
     FROM "Properties" p
     LEFT JOIN "Landlords" l ON l.id = p.landlord_id
     WHERE p.id = ?`,
    [id],
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ property: row });
});

app.post("/api/properties", async (c) => {
  const parsed = await parseJson(c, PropertyInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Properties" (
       property_name, street_address, city, state, zip, property_type, landlord_id,
       notes, management_status, management_end_date, year_built, color, is_test_data, source_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'app-' || gen_random_uuid()::text))`,
    [
      d.property_name ?? null, d.street_address, d.city, d.state, d.zip, d.property_type, d.landlord_id,
      d.notes ?? null, d.management_status ?? "Active", d.management_end_date ?? null,
      d.year_built ?? null, d.color ?? "sky", d.is_test_data ?? false, d.source_id ?? null,
    ],
  );
  const row = await get(`SELECT * FROM "Properties" WHERE id = ?`, [result.lastInsertRowid]);
  return c.json({ property: row }, 201);
});

app.put("/api/properties/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PropertyInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  // occupancy_status is trigger-maintained — never accept from client
  const data = { ...parsed.data } as Record<string, unknown>;
  delete data.occupancy_status;
  const { sets, params } = buildUpdate(data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Properties" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`SELECT * FROM "Properties" WHERE id = ?`, [id]);
  return c.json({ property: row });
});

app.delete("/api/properties/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Properties" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Units ──────────────────────────────────────────────────────────

const UnitInput = z.object({
  property_id: z.number().int(),
  unit_label: z.string().min(1),
  bedrooms: z.number().int().min(0).optional().nullable(),
  bathrooms: z.number().min(0).optional().nullable(),
  sqft: z.number().int().optional().nullable(),
  market_rent: z.number().min(0).optional(),
  status: z.enum(UNIT_STATUSES).optional(),
  readiness_status: z.enum(READINESS).optional(),
  currently_being_marketed: z.boolean().optional(),
  management_status: z.enum(MGMT).optional(),
  management_end_date: z.string().optional().nullable(),
  expected_move_out_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
  source_id: z.string().optional(),
});

const UNIT_SELECT = `
  SELECT u.*,
    p.property_name,
    p.color AS property_color,
    p.street_address AS property_address,
    p.city AS property_city,
    (SELECT l.id FROM "Leases" l WHERE l.unit_id = u.id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) AS active_lease_id,
    (SELECT t.first_name || ' ' || t.last_name FROM "Leases" l
       LEFT JOIN "Tenants" t ON t.id = l.primary_tenant_id
       WHERE l.unit_id = u.id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) AS active_tenant_name
  FROM "Units" u
  LEFT JOIN "Properties" p ON p.id = u.property_id
`;

app.get("/api/units", async (c) => {
  const propertyId = intParam(c.req.query("property_id"));
  const status = c.req.query("status");
  const where: string[] = [];
  const params: unknown[] = [];
  if (propertyId) { where.push("u.property_id = ?"); params.push(propertyId); }
  if (status) { where.push("u.status = ?"); params.push(status); }
  const sql = `${UNIT_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY p.property_name, u.unit_label`;
  const rows = await query(sql, params);
  return c.json({ units: rows });
});

app.get("/api/units/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ unit: row });
});

app.post("/api/units", async (c) => {
  const parsed = await parseJson(c, UnitInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Units" (
       property_id, unit_label, bedrooms, bathrooms, sqft, market_rent, status,
       readiness_status, currently_being_marketed, management_status,
       management_end_date, expected_move_out_date, notes, is_test_data, source_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'app-' || gen_random_uuid()::text))`,
    [
      d.property_id, d.unit_label, d.bedrooms ?? null, d.bathrooms ?? null,
      d.sqft ?? null, d.market_rent ?? 0, d.status ?? "Vacant",
      d.readiness_status ?? "Ready", d.currently_being_marketed ?? false,
      d.management_status ?? "Active", d.management_end_date ?? null,
      d.expected_move_out_date ?? null, d.notes ?? null, d.is_test_data ?? false, d.source_id ?? null,
    ],
  );
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [result.lastInsertRowid]);
  return c.json({ unit: row }, 201);
});

app.put("/api/units/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, UnitInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const data = { ...parsed.data } as Record<string, unknown>;
  delete data.occupancy_status; // generated column
  const { sets, params } = buildUpdate(data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Units" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [id]);
  return c.json({ unit: row });
});

app.delete("/api/units/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Units" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Tenants ────────────────────────────────────────────────────────

const TenantInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  mobile_phone: z.string().optional().nullable(),
  unit_id: z.number().int(),
  primary_on_lease: z.boolean(),
  invite_to_app: z.boolean(),
  date_of_birth: z.string().optional().nullable(),
  emergency_contact: z.string().optional().nullable(),
  employer: z.string().optional().nullable(),
  monthly_income: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
  source_id: z.string().optional(),
});

const TENANT_SELECT = `
  SELECT t.*,
    u.unit_label AS active_unit_name,
    u.id AS active_unit_id,
    p.property_name AS active_property_name
  FROM "Tenants" t
  LEFT JOIN "Units" u ON u.id = t.unit_id
  LEFT JOIN "Properties" p ON p.id = u.property_id
`;

app.get("/api/tenants", async (c) => {
  const search = c.req.query("q")?.trim();
  if (search) {
    const like = `%${search}%`;
    const rows = await query(
      `${TENANT_SELECT}
       WHERE t.last_name ILIKE ? OR t.first_name ILIKE ? OR t.email ILIKE ? OR t.mobile_phone ILIKE ?
       ORDER BY t.last_name, t.first_name LIMIT 200`,
      [like, like, like, like],
    );
    return c.json({ tenants: rows });
  }
  const rows = await query(`${TENANT_SELECT} ORDER BY t.last_name, t.first_name LIMIT 500`);
  return c.json({ tenants: rows });
});

app.get("/api/tenants/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${TENANT_SELECT} WHERE t.id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ tenant: row });
});

app.post("/api/tenants", async (c) => {
  const parsed = await parseJson(c, TenantInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Tenants" (
       first_name, last_name, email, mobile_phone, unit_id, primary_on_lease, invite_to_app,
       date_of_birth, emergency_contact, employer, monthly_income, notes, is_test_data, source_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'app-' || gen_random_uuid()::text))`,
    [
      d.first_name, d.last_name, d.email, d.mobile_phone ?? null, d.unit_id,
      d.primary_on_lease, d.invite_to_app, d.date_of_birth ?? null, d.emergency_contact ?? null,
      d.employer ?? null, d.monthly_income ?? null, d.notes ?? null, d.is_test_data ?? false, d.source_id ?? null,
    ],
  );
  const row = await get(`${TENANT_SELECT} WHERE t.id = ?`, [result.lastInsertRowid]);
  return c.json({ tenant: row }, 201);
});

app.put("/api/tenants/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, TenantInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Tenants" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${TENANT_SELECT} WHERE t.id = ?`, [id]);
  return c.json({ tenant: row });
});

app.delete("/api/tenants/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Tenants" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Leases ─────────────────────────────────────────────────────────

const LeaseInput = z.object({
  unit_id: z.number().int(),
  primary_tenant_id: z.number().int().nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
  monthly_rent: z.number().min(0).optional(),
  deposit: z.number().min(0).optional(),
  rent_due_day: z.number().int().min(1).max(31).optional(),
  late_fee: z.number().min(0).optional(),
  status: z.enum(["upcoming", "active", "ended", "cancelled"]).optional(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
});

const LEASE_SELECT = `
  SELECT l.*,
    u.unit_label AS unit_name,
    p.id AS property_id, p.property_name, p.color AS property_color,
    t.first_name AS tenant_first_name, t.last_name AS tenant_last_name,
    t.email AS tenant_email, t.mobile_phone AS tenant_phone
  FROM "Leases" l
  LEFT JOIN "Units" u ON u.id = l.unit_id
  LEFT JOIN "Properties" p ON p.id = u.property_id
  LEFT JOIN "Tenants" t ON t.id = l.primary_tenant_id
`;

app.get("/api/leases", async (c) => {
  const status = c.req.query("status");
  const tenantId = intParam(c.req.query("tenant_id"));
  const unitId = intParam(c.req.query("unit_id"));
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) { where.push("l.status = ?"); params.push(status); }
  if (tenantId) { where.push("l.primary_tenant_id = ?"); params.push(tenantId); }
  if (unitId) { where.push("l.unit_id = ?"); params.push(unitId); }
  const sql = `${LEASE_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY l.start_date DESC`;
  const rows = await query(sql, params);
  return c.json({ leases: rows });
});

app.get("/api/leases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ lease: row });
});

app.post("/api/leases", async (c) => {
  const parsed = await parseJson(c, LeaseInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Leases" (unit_id, primary_tenant_id, start_date, end_date, monthly_rent, deposit, rent_due_day, late_fee, status, notes, is_test_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.unit_id, d.primary_tenant_id ?? null, d.start_date, d.end_date,
      d.monthly_rent ?? 0, d.deposit ?? 0, d.rent_due_day ?? 1, d.late_fee ?? 0,
      d.status ?? "active", d.notes ?? null, d.is_test_data ?? false,
    ],
  );
  if ((d.status ?? "active") === "active") {
    await run(`UPDATE "Units" SET status = 'Occupied' WHERE id = ?`, [d.unit_id]);
  }
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [result.lastInsertRowid]);
  return c.json({ lease: row }, 201);
});

app.put("/api/leases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, LeaseInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Leases" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [id]);
  return c.json({ lease: row });
});

app.delete("/api/leases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Leases" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Rent charges & payments ────────────────────────────────────────

const ChargeInput = z.object({
  lease_id: z.number().int(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  due_date: z.string(),
  amount: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
});

const CHARGE_SELECT = `
  SELECT c.*,
    l.unit_id, l.monthly_rent AS lease_rent, l.rent_due_day,
    u.unit_label AS unit_name,
    p.id AS property_id, p.property_name, p.color AS property_color,
    t.id AS tenant_id, t.first_name AS tenant_first_name, t.last_name AS tenant_last_name
  FROM "RentCharges" c
  LEFT JOIN "Leases" l ON l.id = c.lease_id
  LEFT JOIN "Units" u ON u.id = l.unit_id
  LEFT JOIN "Properties" p ON p.id = u.property_id
  LEFT JOIN "Tenants" t ON t.id = l.primary_tenant_id
`;

app.get("/api/rent-charges", async (c) => {
  const period = c.req.query("period");
  const status = c.req.query("status");
  const where: string[] = [];
  const params: unknown[] = [];
  if (period) { where.push("c.period = ?"); params.push(period); }
  if (status) { where.push("c.status = ?"); params.push(status); }
  const sql = `${CHARGE_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY c.due_date, p.property_name, u.unit_label`;
  const rows = await query(sql, params).catch(() => []);
  return c.json({ charges: rows });
});

app.post("/api/rent-charges", async (c) => {
  const parsed = await parseJson(c, ChargeInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "RentCharges" (lease_id, period, due_date, amount, notes, is_test_data)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (lease_id, period) DO NOTHING`,
    [d.lease_id, d.period, d.due_date, d.amount ?? 0, d.notes ?? null, d.is_test_data ?? false],
  );
  if (!result.changes) {
    const existing = await get(`${CHARGE_SELECT} WHERE c.lease_id = ? AND c.period = ?`, [d.lease_id, d.period]);
    return c.json({ charge: existing });
  }
  const row = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [result.lastInsertRowid]);
  return c.json({ charge: row }, 201);
});

app.post("/api/rent-charges/generate", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { period?: string };
  const period = body.period;
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return c.json({ error: "period (YYYY-MM) required" }, 400);
  const leases = await query<{ id: number; monthly_rent: number; rent_due_day: number; start_date: string; end_date: string }>(
    `SELECT id, monthly_rent, rent_due_day, start_date::text, end_date::text FROM "Leases" WHERE status = 'active'`,
  );
  let created = 0;
  for (const l of leases) {
    const periodStart = `${period}-01`;
    if (l.end_date < periodStart) continue;
    const day = String(Math.min(28, Math.max(1, Number(l.rent_due_day)))).padStart(2, "0");
    const dueDate = `${period}-${day}`;
    const r = await run(
      `INSERT INTO "RentCharges" (lease_id, period, due_date, amount)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (lease_id, period) DO NOTHING`,
      [l.id, period, dueDate, l.monthly_rent],
    );
    if (r.changes) created++;
  }
  await run(
    `UPDATE "RentCharges" SET status = 'overdue'
     WHERE status IN ('open', 'partial') AND amount_paid < amount AND due_date < CURRENT_DATE`,
  );
  return c.json({ created, period });
});

app.put("/api/rent-charges/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const Patch = z.object({
    amount: z.number().min(0).optional(),
    due_date: z.string().optional(),
    status: z.enum(["open", "partial", "paid", "overdue", "waived"]).optional(),
    notes: z.string().optional().nullable(),
  });
  const parsed = await parseJson(c, Patch);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "RentCharges" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [id]);
  return c.json({ charge: row });
});

app.delete("/api/rent-charges/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "RentCharges" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

const PaymentInput = z.object({
  charge_id: z.number().int(),
  paid_at: z.string().optional(),
  amount: z.number().min(0),
  method: z.enum(["cash", "check", "ach", "credit", "other"]).optional(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
});

app.get("/api/rent-charges/:id/payments", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query(`SELECT * FROM "Payments" WHERE charge_id = ? ORDER BY paid_at DESC`, [id]);
  return c.json({ payments: rows });
});

app.post("/api/payments", async (c) => {
  const parsed = await parseJson(c, PaymentInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  await run(
    `INSERT INTO "Payments" (charge_id, paid_at, amount, method, reference, notes, is_test_data)
     VALUES (?, COALESCE(?::timestamptz, now()), ?, ?, ?, ?, ?)`,
    [d.charge_id, d.paid_at ?? null, d.amount, d.method ?? "cash", d.reference ?? null, d.notes ?? null, d.is_test_data ?? false],
  );
  const charge = await get<{ amount: number }>(`SELECT amount FROM "RentCharges" WHERE id = ?`, [d.charge_id]);
  if (!charge) return c.json({ error: "Charge not found" }, 404);
  const sumRow = await get<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM "Payments" WHERE charge_id = ?`, [d.charge_id]);
  const paid = Number(sumRow?.total ?? 0);
  const status = paid >= Number(charge.amount) ? "paid" : paid > 0 ? "partial" : "open";
  await run(`UPDATE "RentCharges" SET amount_paid = ?, status = ? WHERE id = ?`, [paid, status, d.charge_id]);
  const updated = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [d.charge_id]);
  return c.json({ charge: updated }, 201);
});

app.delete("/api/payments/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get<{ charge_id: number }>(`SELECT charge_id FROM "Payments" WHERE id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  await run(`DELETE FROM "Payments" WHERE id = ?`, [id]);
  const sumRow = await get<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM "Payments" WHERE charge_id = ?`, [row.charge_id]);
  const charge = await get<{ amount: number }>(`SELECT amount FROM "RentCharges" WHERE id = ?`, [row.charge_id]);
  const paid = Number(sumRow?.total ?? 0);
  const status = !charge ? "open" : paid >= Number(charge.amount) ? "paid" : paid > 0 ? "partial" : "open";
  await run(`UPDATE "RentCharges" SET amount_paid = ?, status = ? WHERE id = ?`, [paid, status, row.charge_id]);
  return c.json({ ok: true });
});

// ── Vendors ────────────────────────────────────────────────────────

const VendorInput = z.object({
  name: z.string().min(1),
  category: z.enum(["plumber", "electrician", "hvac", "handyman", "cleaning", "landscaping", "general"]).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().optional(),
  is_test_data: z.boolean().optional(),
});

app.get("/api/vendors", async (c) => {
  const rows = await query(`SELECT * FROM "Vendors" ORDER BY name`);
  return c.json({ vendors: rows });
});

app.post("/api/vendors", async (c) => {
  const parsed = await parseJson(c, VendorInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Vendors" (name, category, phone, email, notes, color, is_test_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [d.name, d.category ?? "general", d.phone ?? null, d.email ?? null, d.notes ?? null, d.color ?? "slate", d.is_test_data ?? false],
  );
  const row = await get(`SELECT * FROM "Vendors" WHERE id = ?`, [result.lastInsertRowid]);
  return c.json({ vendor: row }, 201);
});

app.put("/api/vendors/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, VendorInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Vendors" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`SELECT * FROM "Vendors" WHERE id = ?`, [id]);
  return c.json({ vendor: row });
});

app.delete("/api/vendors/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Vendors" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Staff ──────────────────────────────────────────────────────────

const StaffInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email(),
  job_title: z.string().optional().nullable(),
  gets_request_alerts: z.boolean().optional(),
  is_test_data: z.boolean().optional(),
});

app.get("/api/staff", async (c) => {
  const rows = await query(`SELECT * FROM "Staff" ORDER BY last_name, first_name`);
  return c.json({ staff: rows });
});

app.post("/api/staff", async (c) => {
  const parsed = await parseJson(c, StaffInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Staff" (first_name, last_name, email, job_title, gets_request_alerts, is_test_data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.first_name, d.last_name, d.email, d.job_title ?? null, d.gets_request_alerts ?? false, d.is_test_data ?? false],
  );
  const row = await get(`SELECT * FROM "Staff" WHERE id = ?`, [result.lastInsertRowid]);
  return c.json({ staff: row }, 201);
});

app.put("/api/staff/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, StaffInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Staff" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`SELECT * FROM "Staff" WHERE id = ?`, [id]);
  return c.json({ staff: row });
});

app.delete("/api/staff/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Staff" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Maintenance requests (merged work orders) ──────────────────────

const MaintenanceBase = z.object({
  property_id: z.number().int().nullable().optional(),
  unit_id: z.number().int().nullable().optional(),
  submitted_by_tenant_id: z.number().int().nullable().optional(),
  assigned_staff_id: z.number().int().nullable().optional(),
  vendor_id: z.number().int().nullable().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(MR_CATEGORY),
  priority: z.enum(MR_PRIORITY).optional(),
  status: z.enum(MR_STATUS).optional(),
  scheduled_for: z.string().optional().nullable(),
  started_at: z.string().optional().nullable(),
  hold_reason: z.string().optional().nullable(),
  next_follow_up_date: z.string().optional().nullable(),
  closed_at: z.string().optional().nullable(),
  resolution_notes: z.string().optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
});
const MaintenanceInput = MaintenanceBase.refine((d) => d.unit_id != null || d.property_id != null, {
  message: "Either unit_id or property_id is required",
});

const MR_SELECT_CLEAN = `
  SELECT m.*,
    COALESCE(p.property_name, pu.property_name) AS property_name,
    COALESCE(p.color, pu.color) AS property_color,
    COALESCE(m.property_id, u.property_id) AS resolved_property_id,
    u.unit_label AS unit_name,
    t.first_name AS tenant_first_name, t.last_name AS tenant_last_name,
    v.name AS vendor_name, v.color AS vendor_color,
    s.first_name AS staff_first_name, s.last_name AS staff_last_name
  FROM "MaintenanceRequests" m
  LEFT JOIN "Units" u ON u.id = m.unit_id
  LEFT JOIN "Properties" p ON p.id = m.property_id
  LEFT JOIN "Properties" pu ON pu.id = u.property_id
  LEFT JOIN "Tenants" t ON t.id = m.submitted_by_tenant_id
  LEFT JOIN "Vendors" v ON v.id = m.vendor_id
  LEFT JOIN "Staff" s ON s.id = m.assigned_staff_id
`;

app.get("/api/maintenance-requests", async (c) => {
  const status = c.req.query("status");
  const propertyId = intParam(c.req.query("property_id"));
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) { where.push("m.status = ?"); params.push(status); }
  if (propertyId) {
    where.push("(m.property_id = ? OR u.property_id = ?)");
    params.push(propertyId, propertyId);
  }
  const sql = `${MR_SELECT_CLEAN}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY
    CASE m.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
    m.created_at DESC`;
  const rows = await query(sql, params).catch(() => []);
  return c.json({ maintenance_requests: rows });
});

// Back-compat alias used by older client code during the cutover
app.get("/api/work-orders", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/api/maintenance-requests";
  return app.fetch(new Request(url.toString(), c.req.raw), c.env);
});

app.post("/api/maintenance-requests", async (c) => {
  const parsed = await parseJson(c, MaintenanceInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  // request_number is assigned by trigger when null/blank
  const result = await run(
    `INSERT INTO "MaintenanceRequests" (
       request_number, property_id, unit_id, submitted_by_tenant_id, assigned_staff_id, vendor_id,
       title, description, category, priority, status,
       scheduled_for, started_at, hold_reason, next_follow_up_date, closed_at,
       resolution_notes, cost, notes, is_test_data
     ) VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.property_id ?? null, d.unit_id ?? null, d.submitted_by_tenant_id ?? null,
      d.assigned_staff_id ?? null, d.vendor_id ?? null,
      d.title, d.description, d.category, d.priority ?? "Normal", d.status ?? "Open",
      d.scheduled_for ?? null, d.started_at ?? null, d.hold_reason ?? null,
      d.next_follow_up_date ?? null, d.closed_at ?? null,
      d.resolution_notes ?? null, d.cost ?? null, d.notes ?? null, d.is_test_data ?? false,
    ],
  );
  const row = await get(`${MR_SELECT_CLEAN} WHERE m.id = ?`, [result.lastInsertRowid]);
  return c.json({ maintenance_request: row }, 201);
});

app.put("/api/maintenance-requests/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, MaintenanceBase.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const data = { ...parsed.data } as Record<string, unknown>;
  delete data.request_number; // immutable
  const { sets, params } = buildUpdate(data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "MaintenanceRequests" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${MR_SELECT_CLEAN} WHERE m.id = ?`, [id]);
  return c.json({ maintenance_request: row });
});

app.delete("/api/maintenance-requests/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "MaintenanceRequests" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Inquiries ──────────────────────────────────────────────────────

app.get("/api/inquiries", async (c) => {
  const rows = await query(`SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 500`);
  return c.json({ inquiries: rows });
});

app.put("/api/inquiries/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const Patch = z.object({ status: z.string().min(1) });
  const parsed = await parseJson(c, Patch);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const r = await run(`UPDATE inquiries SET status = ? WHERE id = ?::uuid`, [parsed.data.status, id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`SELECT * FROM inquiries WHERE id = ?::uuid`, [id]);
  return c.json({ inquiry: row });
});

// ── Applications ───────────────────────────────────────────────────

const ApplicationInput = z.object({
  unit_id: z.number().int().nullable().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  monthly_income: z.number().optional().nullable(),
  employer: z.string().optional().nullable(),
  desired_move_in: z.string().optional().nullable(),
  status: z.enum(["new", "screening", "approved", "declined", "withdrawn"]).optional(),
  notes: z.string().optional().nullable(),
  is_test_data: z.boolean().optional(),
});

app.get("/api/applications", async (c) => {
  const rows = await query(
    `SELECT a.*, u.unit_label AS unit_name, p.property_name
     FROM "Applications" a
     LEFT JOIN "Units" u ON u.id = a.unit_id
     LEFT JOIN "Properties" p ON p.id = u.property_id
     ORDER BY a.created_at DESC`,
  ).catch(() => []);
  return c.json({ applications: rows });
});

app.post("/api/applications", async (c) => {
  const parsed = await parseJson(c, ApplicationInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO "Applications" (unit_id, first_name, last_name, email, phone, monthly_income, employer, desired_move_in, status, notes, is_test_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.unit_id ?? null, d.first_name, d.last_name, d.email ?? null, d.phone ?? null,
      d.monthly_income ?? null, d.employer ?? null, d.desired_move_in ?? null,
      d.status ?? "new", d.notes ?? null, d.is_test_data ?? false,
    ],
  );
  const row = await get(
    `SELECT a.*, u.unit_label AS unit_name, p.property_name
     FROM "Applications" a LEFT JOIN "Units" u ON u.id = a.unit_id LEFT JOIN "Properties" p ON p.id = u.property_id
     WHERE a.id = ?`,
    [result.lastInsertRowid],
  );
  return c.json({ application: row }, 201);
});

app.put("/api/applications/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, ApplicationInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data as Record<string, unknown>);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE "Applications" SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(
    `SELECT a.*, u.unit_label AS unit_name, p.property_name
     FROM "Applications" a LEFT JOIN "Units" u ON u.id = a.unit_id LEFT JOIN "Properties" p ON p.id = u.property_id
     WHERE a.id = ?`,
    [id],
  );
  return c.json({ application: row });
});

app.delete("/api/applications/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(`DELETE FROM "Applications" WHERE id = ?`, [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Dashboard ──────────────────────────────────────────────────────

app.get("/api/dashboard/summary", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const periodNow = today.slice(0, 7);

  const safeGet = <T,>(sql: string, params: unknown[] = [], fallback: T) =>
    get<T>(sql, params).catch(() => fallback as T | undefined).then((v) => v ?? fallback);
  const safeQuery = <T,>(sql: string, params: unknown[] = []): Promise<T[]> =>
    query<T>(sql, params).catch(() => [] as T[]);

  const [
    propertyCount, unitCount, occupiedCount, vacantCount, activeLeases, upcomingMoveOuts,
    monthOutstanding, monthCollected, overdueRow,
    openRequests, onHoldRequests, unassignedRequests, urgentRequests,
    recentRequests, upcomingExpirations,
  ] = await Promise.all([
    safeGet<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Properties"`, [], { n: 0 }),
    safeGet<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Units"`, [], { n: 0 }),
    safeGet<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Units" WHERE status = 'Occupied'`, [], { n: 0 }),
    safeGet<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Units" WHERE status = 'Vacant'`, [], { n: 0 }),
    safeGet<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "Leases" WHERE status = 'active'`, [], { n: 0 }),
    safeGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "Leases" WHERE status = 'active' AND end_date <= (CURRENT_DATE + INTERVAL '30 days')`,
      [], { n: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(amount - amount_paid), 0) AS total FROM "RentCharges" WHERE period = ? AND status != 'waived'`,
      [periodNow], { total: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total FROM "RentCharges" WHERE period = ?`,
      [periodNow], { total: 0 },
    ),
    safeGet<{ total: number; n: number }>(
      `SELECT COALESCE(SUM(amount - amount_paid), 0) AS total, COUNT(*)::int AS n
       FROM "RentCharges" WHERE due_date < CURRENT_DATE AND amount_paid < amount AND status != 'waived'`,
      [], { total: 0, n: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "MaintenanceRequests" WHERE status NOT IN ('Closed')`,
      [], { n: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "MaintenanceRequests" WHERE status = 'On Hold'`,
      [], { n: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "MaintenanceRequests" WHERE status NOT IN ('Closed') AND assigned_staff_id IS NULL`,
      [], { n: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "MaintenanceRequests" WHERE priority = 'Urgent' AND status NOT IN ('Closed')`,
      [], { n: 0 },
    ),
    safeQuery<{ id: number; title: string; priority: string; status: string; property_name: string | null; unit_name: string | null; created_at: string; request_number: string }>(
      `SELECT m.id, m.title, m.priority, m.status, m.request_number, m.created_at::text,
         COALESCE(p.property_name, pu.property_name) AS property_name,
         u.unit_label AS unit_name
       FROM "MaintenanceRequests" m
       LEFT JOIN "Units" u ON u.id = m.unit_id
       LEFT JOIN "Properties" p ON p.id = m.property_id
       LEFT JOIN "Properties" pu ON pu.id = u.property_id
       WHERE m.status NOT IN ('Closed')
       ORDER BY CASE m.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, m.created_at DESC
       LIMIT 6`,
    ),
    safeQuery<{ id: number; end_date: string; tenant_first_name: string | null; tenant_last_name: string | null; unit_name: string | null; property_name: string | null }>(
      `SELECT l.id, l.end_date::text AS end_date,
         t.first_name AS tenant_first_name, t.last_name AS tenant_last_name,
         u.unit_label AS unit_name, p.property_name
       FROM "Leases" l
       LEFT JOIN "Tenants" t ON t.id = l.primary_tenant_id
       LEFT JOIN "Units" u ON u.id = l.unit_id
       LEFT JOIN "Properties" p ON p.id = u.property_id
       WHERE l.status = 'active' AND l.end_date <= (CURRENT_DATE + INTERVAL '60 days')
       ORDER BY l.end_date ASC LIMIT 6`,
    ),
  ]);

  return c.json({
    period: periodNow,
    properties: propertyCount.n,
    units: unitCount.n,
    occupied: occupiedCount.n,
    vacant: vacantCount.n,
    occupancy_rate: unitCount.n ? Math.round((occupiedCount.n / unitCount.n) * 100) : 0,
    active_leases: activeLeases.n,
    upcoming_move_outs: upcomingMoveOuts.n,
    month_outstanding: Number(monthOutstanding.total),
    month_collected: Number(monthCollected.total),
    overdue_total: Number(overdueRow.total),
    overdue_count: overdueRow.n,
    open_work_orders: openRequests.n,
    urgent_work_orders: urgentRequests.n,
    on_hold_requests: onHoldRequests.n,
    unassigned_requests: unassignedRequests.n,
    recent_work_orders: recentRequests,
    upcoming_expirations: upcomingExpirations,
  });
});

// ── Settings ───────────────────────────────────────────────────────

app.get("/api/settings", async (c) => {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM "Settings"`).catch(() => []);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: out });
});

app.put("/api/settings", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "Body must be an object" }, 400);
  const entries = Object.entries(body as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
  for (const [key, value] of entries) {
    await run(
      `INSERT INTO "Settings" (key, value, updated_at) VALUES (?, ?, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, String(value)],
    );
  }
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM "Settings"`);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: out });
});

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
