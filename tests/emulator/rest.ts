/**
 * A small PostgREST: turns the REST calls supabase-js makes into SQL and runs
 * them as the caller's database role, so RLS, grants, triggers and CHECK
 * constraints are enforced by Postgres itself — exactly as in production.
 *
 * Supported (everything the app uses today):
 *   select=cols | filters eq neq gt gte lt lte like ilike is in (+ not.) |
 *   order | limit | offset | insert | upsert | update | delete | rpc |
 *   Prefer: return=representation, resolution=merge-duplicates | single-object Accept
 *
 * Anything outside that fails loudly with code EMU001 rather than guessing.
 */
import type { Transaction } from "@electric-sql/pglite";
import type { DbRole, EmulatorDb, PgError } from "./db";
import type { JwtClaims } from "./jwt";

export interface RestResponse {
  status: number;
  body: string | null;
  headers?: Record<string, string>;
}

class RestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string | null = null,
    readonly hint: string | null = null,
  ) {
    super(message);
  }
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

function json(status: number, payload: unknown, headers?: Record<string, string>): RestResponse {
  return { status, body: JSON.stringify(payload), headers };
}

function errorBody(code: string, message: string, details: string | null, hint: string | null) {
  return { code, details, hint, message };
}

function statusForPgError(code: string | undefined, role: DbRole): number {
  switch (code) {
    case "42501":
      return role === "anon" ? 401 : 403;
    case "23503":
    case "23505":
    case "40001":
      return 409;
    case "42P01":
    case "42883":
      return 404;
    default:
      return 400;
  }
}

interface Relation {
  columns: Set<string>;
  primaryKey: string[];
}

interface FunctionSig {
  argNames: string[];
  argTypes: string[];
  defaults: number;
  returnsSet: boolean;
  returnKind: "void" | "scalar" | "composite";
}

export class RestApi {
  private relations = new Map<string, Relation | null>();
  private functions = new Map<string, FunctionSig[]>();

  constructor(private readonly db: EmulatorDb) {}

  private async relation(name: string): Promise<Relation> {
    if (!this.relations.has(name)) {
      const cols = await this.db.admin<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1`,
        [name],
      );
      if (cols.length === 0) {
        this.relations.set(name, null);
      } else {
        const pk = await this.db.admin<{ attname: string }>(
          `select a.attname
             from pg_index i
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
            where i.indrelid = format('public.%I', $1::text)::regclass and i.indisprimary
            order by array_position(i.indkey, a.attnum)`,
          [name],
        );
        this.relations.set(name, {
          columns: new Set(cols.map((c) => c.column_name)),
          primaryKey: pk.map((r) => r.attname),
        });
      }
    }
    const rel = this.relations.get(name);
    if (!rel) {
      throw new RestError(
        404,
        "PGRST205",
        `Could not find the table 'public.${name}' in the schema cache`,
      );
    }
    return rel;
  }

  private column(rel: Relation, table: string, col: string): string {
    if (!rel.columns.has(col)) {
      throw new RestError(400, "42703", `column ${table}.${col} does not exist`);
    }
    return q(col);
  }

  private selectList(rel: Relation, table: string, select: string | null): string {
    if (!select || select.trim() === "" || select.trim() === "*") return "*";
    return select
      .split(",")
      .map((raw) => {
        const part = raw.trim();
        if (part === "*") return "*";
        if (/[()]/.test(part)) {
          throw new RestError(
            400,
            "EMU001",
            `Embedded resources are not supported by the test emulator: "${part}"`,
            null,
            "Extend tests/emulator/rest.ts or split the query.",
          );
        }
        const [alias, col] = part.includes(":") ? part.split(":") : [null, part];
        const ident = this.column(rel, table, col.trim());
        return alias ? `${ident} as ${q(alias.trim())}` : ident;
      })
      .join(", ");
  }

  private where(
    rel: Relation,
    table: string,
    params: URLSearchParams,
    values: unknown[],
    qualifier = "",
  ): string {
    const reserved = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
    const clauses: string[] = [];
    for (const [key, raw] of params) {
      if (reserved.has(key)) continue;
      if (key === "or" || key === "and") {
        throw new RestError(400, "EMU001", `Logical filter "${key}" is not supported by the test emulator`);
      }
      const col = qualifier + this.column(rel, table, key);
      let expr = raw;
      let negate = false;
      if (expr.startsWith("not.")) {
        negate = true;
        expr = expr.slice(4);
      }
      const dot = expr.indexOf(".");
      const op = dot === -1 ? expr : expr.slice(0, dot);
      const operand = dot === -1 ? "" : expr.slice(dot + 1);
      let sql: string;
      const bind = (v: unknown) => {
        values.push(v);
        return `$${values.length}`;
      };
      switch (op) {
        case "eq":
          sql = `${col} = ${bind(operand)}`;
          break;
        case "neq":
          sql = `${col} <> ${bind(operand)}`;
          break;
        case "gt":
          sql = `${col} > ${bind(operand)}`;
          break;
        case "gte":
          sql = `${col} >= ${bind(operand)}`;
          break;
        case "lt":
          sql = `${col} < ${bind(operand)}`;
          break;
        case "lte":
          sql = `${col} <= ${bind(operand)}`;
          break;
        case "like":
          sql = `${col} like ${bind(operand.replace(/\*/g, "%"))}`;
          break;
        case "ilike":
          sql = `${col} ilike ${bind(operand.replace(/\*/g, "%"))}`;
          break;
        case "is": {
          const v = operand.toLowerCase();
          if (!["null", "true", "false", "unknown"].includes(v)) {
            throw new RestError(400, "PGRST100", `"is" expects null, true, false or unknown`);
          }
          sql = `${col} is ${v}`;
          break;
        }
        case "in": {
          const m = /^\((.*)\)$/s.exec(operand);
          if (!m) throw new RestError(400, "PGRST100", `"in" expects a parenthesised list`);
          const items = splitList(m[1]);
          if (items.length === 0) {
            sql = "false";
          } else {
            sql = `${col}::text = any(${bind(toArrayLiteral(items))}::text[])`;
          }
          break;
        }
        default:
          throw new RestError(400, "EMU001", `Filter operator "${op}" is not supported by the test emulator`);
      }
      clauses.push(negate ? `not (${sql})` : sql);
    }
    return clauses.length ? ` where ${clauses.join(" and ")}` : "";
  }

  private orderBy(rel: Relation, table: string, order: string | null): string {
    if (!order) return "";
    const terms = order.split(",").map((term) => {
      const [col, ...mods] = term.trim().split(".");
      let sql = this.column(rel, table, col);
      for (const mod of mods) {
        if (mod === "asc" || mod === "desc") sql += ` ${mod}`;
        else if (mod === "nullsfirst") sql += " nulls first";
        else if (mod === "nullslast") sql += " nulls last";
        else throw new RestError(400, "PGRST100", `Unknown order modifier "${mod}"`);
      }
      return sql;
    });
    return ` order by ${terms.join(", ")}`;
  }

  /** Shape a JSON-array body into what the caller asked for. */
  private finish(
    rowsJson: string,
    opts: { single: boolean; returnRows: boolean; successStatus: number },
  ): RestResponse {
    if (!opts.returnRows) return { status: opts.successStatus === 200 ? 204 : opts.successStatus, body: null };
    if (!opts.single) return { status: opts.successStatus, body: rowsJson };
    const rows = JSON.parse(rowsJson) as unknown[];
    if (rows.length !== 1) {
      return json(
        406,
        errorBody(
          "PGRST116",
          "Cannot coerce the result to a single JSON object",
          `The result contains ${rows.length} rows`,
          null,
        ),
      );
    }
    return json(opts.successStatus, rows[0]);
  }

  async handle(req: {
    method: string;
    path: string; // after /rest/v1
    params: URLSearchParams;
    headers: Headers;
    body: unknown;
    role: DbRole;
    claims: JwtClaims;
  }): Promise<RestResponse> {
    try {
      return await this.dispatch(req);
    } catch (err) {
      if (err instanceof RestError) {
        return json(err.status, errorBody(err.code, err.message, err.details, err.hint));
      }
      const e = err as PgError;
      if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
        return json(
          statusForPgError(e.code, req.role),
          errorBody(e.code, e.message, e.detail ?? null, e.hint ?? null),
        );
      }
      return json(500, errorBody("EMU500", `Emulator failure: ${e.message}`, null, null));
    }
  }

  private async dispatch(req: {
    method: string;
    path: string;
    params: URLSearchParams;
    headers: Headers;
    body: unknown;
    role: DbRole;
    claims: JwtClaims;
  }): Promise<RestResponse> {
    const segments = req.path.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] === "rpc" && segments[1]) {
      return this.rpc(segments[1], req);
    }
    if (segments.length !== 1) {
      throw new RestError(404, "PGRST125", "Invalid path specified in request URL");
    }
    const table = segments[0];
    const rel = await this.relation(table);
    const prefer = (req.headers.get("prefer") ?? "").toLowerCase();
    const accept = req.headers.get("accept") ?? "";
    const single = accept.includes("application/vnd.pgrst.object+json");
    const wantsRows = prefer.includes("return=representation");
    const target = `public.${q(table)}`;
    const run = <T>(fn: (tx: Transaction) => Promise<T>) => this.db.asRole(req.role, req.claims, fn);
    const cols = this.selectList(rel, table, req.params.get("select"));

    switch (req.method) {
      case "GET":
      case "HEAD": {
        const values: unknown[] = [];
        const where = this.where(rel, table, req.params, values);
        const order = this.orderBy(rel, table, req.params.get("order"));
        const limit = intParam(req.params.get("limit"), "limit");
        const offset = intParam(req.params.get("offset"), "offset");
        const sql =
          `select coalesce(json_agg(_r), '[]'::json)::text as body from (` +
          `select ${cols} from ${target}${where}${order}` +
          (limit != null ? ` limit ${limit}` : "") +
          (offset != null ? ` offset ${offset}` : "") +
          `) _r`;
        const res = await run((tx) => tx.query<{ body: string }>(sql, values));
        return this.finish(res.rows[0].body, { single, returnRows: true, successStatus: 200 });
      }

      case "POST": {
        const rows = Array.isArray(req.body) ? req.body : [req.body];
        if (rows.some((r) => r === null || typeof r !== "object")) {
          throw new RestError(400, "PGRST102", "Request body must be a JSON object or array of objects");
        }
        const explicit = req.params.get("columns");
        const keys = explicit
          ? explicit.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
          : [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
        const colList = keys.map((k) => this.column(rel, table, k));
        let sql: string;
        if (colList.length === 0) {
          sql = `insert into ${target} default values`;
        } else {
          sql =
            `insert into ${target} (${colList.join(", ")}) ` +
            `select ${colList.join(", ")} from json_populate_recordset(null::${target}, $1::json)`;
        }
        if (prefer.includes("resolution=merge-duplicates") || prefer.includes("resolution=ignore-duplicates")) {
          const conflict = (req.params.get("on_conflict")?.split(",").map((c) => c.trim()) ?? rel.primaryKey).map(
            (c) => this.column(rel, table, c),
          );
          if (prefer.includes("resolution=ignore-duplicates")) {
            sql += ` on conflict (${conflict.join(", ")}) do nothing`;
          } else {
            const updates = colList.filter((c) => !conflict.includes(c)).map((c) => `${c} = excluded.${c}`);
            sql += updates.length
              ? ` on conflict (${conflict.join(", ")}) do update set ${updates.join(", ")}`
              : ` on conflict (${conflict.join(", ")}) do nothing`;
          }
        }
        const full = wantsRows
          ? `with _m as (${sql} returning *) select coalesce(json_agg(_r), '[]'::json)::text as body from (select ${cols} from _m) _r`
          : sql;
        const res = await run((tx) =>
          tx.query<{ body: string }>(full, colList.length ? [JSON.stringify(rows)] : []),
        );
        return this.finish(wantsRows ? res.rows[0].body : "[]", {
          single,
          returnRows: wantsRows,
          successStatus: 201,
        });
      }

      case "PATCH": {
        if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
          throw new RestError(400, "PGRST102", "PATCH body must be a JSON object");
        }
        const keys = Object.keys(req.body as object);
        if (keys.length === 0) {
          return this.finish("[]", { single, returnRows: wantsRows, successStatus: 200 });
        }
        const values: unknown[] = [JSON.stringify(req.body)];
        const sets = keys.map((k) => {
          const c = this.column(rel, table, k);
          return `${c} = _b.${c}`;
        });
        const where = this.where(rel, table, req.params, values, `${q(table)}.`);
        const sql =
          `update ${target} set ${sets.join(", ")} ` +
          `from json_populate_record(null::${target}, $1::json) _b${where}`;
        const full = wantsRows
          ? `with _m as (${sql} returning ${q(table)}.*) select coalesce(json_agg(_r), '[]'::json)::text as body from (select ${cols} from _m) _r`
          : sql;
        const res = await run((tx) => tx.query<{ body: string }>(full, values));
        return this.finish(wantsRows ? res.rows[0].body : "[]", {
          single,
          returnRows: wantsRows,
          successStatus: 200,
        });
      }

      case "DELETE": {
        const values: unknown[] = [];
        const where = this.where(rel, table, req.params, values);
        const sql = `delete from ${target}${where}`;
        const full = wantsRows
          ? `with _m as (${sql} returning *) select coalesce(json_agg(_r), '[]'::json)::text as body from (select ${cols} from _m) _r`
          : sql;
        const res = await run((tx) => tx.query<{ body: string }>(full, values));
        return this.finish(wantsRows ? res.rows[0].body : "[]", {
          single,
          returnRows: wantsRows,
          successStatus: 200,
        });
      }

      default:
        throw new RestError(405, "PGRST117", `Unsupported HTTP method: ${req.method}`);
    }
  }

  private async signatures(name: string): Promise<FunctionSig[]> {
    if (!this.functions.has(name)) {
      const rows = await this.db.admin<{
        argnames: string[] | null;
        argtypes: string[] | null;
        defaults: number;
        proretset: boolean;
        rettype: string;
        typtype: string;
      }>(
        `select p.proargnames as argnames,
                array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as argtypes,
                p.pronargdefaults::int as defaults,
                p.proretset,
                format_type(p.prorettype, null) as rettype,
                rt.typtype::text as typtype
           from pg_proc p
           join pg_type rt on rt.oid = p.prorettype
          where p.pronamespace = 'public'::regnamespace and p.proname = $1 and p.prokind = 'f'`,
        [name],
      );
      this.functions.set(
        name,
        rows.map((r) => {
          const argTypes = r.argtypes ?? [];
          return {
            // proargnames also lists OUT/TABLE columns; inputs are the first N.
            argNames: (r.argnames ?? []).slice(0, argTypes.length),
            argTypes,
            defaults: r.defaults,
            returnsSet: r.proretset,
            returnKind: r.rettype === "void" ? "void" : r.typtype === "c" || r.rettype === "record" ? "composite" : "scalar",
          };
        }),
      );
    }
    return this.functions.get(name)!;
  }

  private async rpc(
    name: string,
    req: { method: string; params: URLSearchParams; headers: Headers; body: unknown; role: DbRole; claims: JwtClaims },
  ): Promise<RestResponse> {
    const args =
      req.method === "GET"
        ? Object.fromEntries(req.params)
        : ((req.body ?? {}) as Record<string, unknown>);
    const given = Object.keys(args);
    const sigs = await this.signatures(name);
    const sig = sigs.find((s) => {
      const required = s.argNames.slice(0, s.argNames.length - s.defaults);
      return given.every((g) => s.argNames.includes(g)) && required.every((r) => given.includes(r));
    });
    if (!sig) {
      throw new RestError(
        404,
        "PGRST202",
        `Could not find the function public.${name}(${given.join(", ")}) in the schema cache`,
        `Searched for the function public.${name} with parameters ${given.join(", ") || "none"}`,
      );
    }
    const values: unknown[] = [];
    const call =
      `public.${q(name)}(` +
      given
        .map((g) => {
          const v = args[g];
          values.push(v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
          return `${q(g)} => $${values.length}::${sig.argTypes[sig.argNames.indexOf(g)]}`;
        })
        .join(", ") +
      `)`;
    const run = <T>(fn: (tx: Transaction) => Promise<T>) => this.db.asRole(req.role, req.claims, fn);
    if (sig.returnKind === "void") {
      await run((tx) => tx.query(`select ${call}`, values));
      return { status: 204, body: null };
    }
    let sql: string;
    if (sig.returnsSet) {
      sql = `select coalesce(json_agg(_r), '[]'::json)::text as body from ${call} _r`;
    } else if (sig.returnKind === "composite") {
      sql = `select row_to_json(_r)::text as body from ${call} _r`;
    } else {
      sql = `select to_json(${call})::text as body`;
    }
    const res = await run((tx) => tx.query<{ body: string | null }>(sql, values));
    const body = res.rows[0]?.body ?? "null";
    const single = (req.headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json");
    if (single && sig.returnsSet) {
      return this.finish(body, { single: true, returnRows: true, successStatus: 200 });
    }
    return { status: 200, body };
  }
}

function intParam(raw: string | null, name: string): number | null {
  if (raw == null) return null;
  if (!/^\d+$/.test(raw)) throw new RestError(400, "PGRST100", `"${name}" must be a non-negative integer`);
  return Number(raw);
}

/** Split a PostgREST list `a,"b,c",d` on top-level commas. */
function splitList(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let sawAny = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === "\\" && i + 1 < input.length) cur += input[++i];
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
      sawAny = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
      sawAny = true;
    }
  }
  if (sawAny || out.length) out.push(cur);
  return out;
}

function toArrayLiteral(items: string[]): string {
  return `{${items.map((i) => `"${i.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
