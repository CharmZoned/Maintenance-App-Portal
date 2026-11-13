/**
 * R5 — Property documents
 * Staff upload documents to a property (or one unit); an admin decides who
 * else may see each one: staff only, the landlord, or the tenant.
 */
import { beforeAll, describe, expect, test } from "vitest";
import * as data from "@/lib/data";
import {
  clientFor,
  expectDenied,
  pdfFile,
  resetWorld,
  signInApp,
  sql,
  type World,
} from "../support/harness";

let world: World;

beforeAll(async () => {
  world = await resetWorld();
});

async function uploadAsAdmin(
  title: string,
  opts: { visibility?: "staff" | "landlord" | "tenant"; unit_id?: number | null; property_id?: number } = {},
) {
  await signInApp("admin");
  return data.uploadPropertyDocument({
    property_id: opts.property_id ?? world.property.id,
    unit_id: opts.unit_id ?? null,
    title,
    file: pdfFile(`${title}.pdf`),
    visibility: opts.visibility ?? "staff",
  });
}

async function titlesVisibleTo(persona: "tenant" | "tenant2" | "landlord" | "worker" | "admin"): Promise<string[]> {
  await signInApp(persona);
  return (await data.listPropertyDocuments()).map((d) => d.title).sort();
}

describe("[R5] Property documents", () => {
  describe("uploading and managing", () => {
    test("an admin uploads a document to a property and can download it", async () => {
      const doc = await uploadAsAdmin("House rules");
      expect(doc).toMatchObject({
        property_id: world.property.id,
        title: "House rules",
        file_name: "House rules.pdf",
        content_type: "application/pdf",
        visibility: "staff",
        uploaded_by_role: "admin",
      });
      const url = await data.getPropertyDocumentDownloadUrl(doc);
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("%PDF");
    });

    test("documents are listed per property", async () => {
      await uploadAsAdmin("Birch inspection", { property_id: world.otherProperty.id });
      const maple = await data.listPropertyDocuments({ property_id: world.property.id });
      const birch = await data.listPropertyDocuments({ property_id: world.otherProperty.id });
      expect(maple.map((d) => d.title)).toContain("House rules");
      expect(birch.map((d) => d.title)).toEqual(["Birch inspection"]);
    });

    test("a document can be attached to one unit of the property", async () => {
      const doc = await uploadAsAdmin("Unit 1A appliance manual", { unit_id: world.units.a.id });
      expect(doc.unit_id).toBe(world.units.a.id);
      const listed = (await data.listPropertyDocuments({ property_id: world.property.id })).find((d) => d.id === doc.id);
      expect(listed?.unit_name).toBe("1A");
    });

    test("a unit from a different property is refused", async () => {
      await signInApp("admin");
      await expect(
        data.uploadPropertyDocument({
          property_id: world.property.id,
          unit_id: world.units.other.id,
          title: "Mismatched",
          file: pdfFile(),
          visibility: "staff",
        }),
      ).rejects.toThrow(/unit_id must belong to property_id/);
    });

    test("a worker uploads a document; it is staff-only", async () => {
      await signInApp("worker");
      const doc = await data.uploadPropertyDocument({
        property_id: world.property.id,
        title: "Boiler service log",
        file: pdfFile("boiler.pdf"),
        visibility: "staff",
      });
      expect(doc).toMatchObject({ visibility: "staff", uploaded_by_role: "maintenance" });
    });

    test("deleting a document removes the file as well as the listing", async () => {
      const doc = await uploadAsAdmin("Temporary notice");
      const stored = () => sql(`select 1 from storage.objects where bucket_id = 'property-documents' and name = $1`, [doc.storage_path]);
      expect(await stored(), "file is in storage after upload").toHaveLength(1);

      await data.deletePropertyDocument(doc.id);

      expect((await data.listPropertyDocuments()).some((d) => d.id === doc.id)).toBe(false);
      expect(await stored(), "file must be removed from storage, not left behind").toHaveLength(0);
    });

    test("retry after storage already removed still clears the metadata row", async () => {
      const doc = await uploadAsAdmin("Retry delete notice");
      const stored = () =>
        sql(`select 1 from storage.objects where bucket_id = 'property-documents' and name = $1`, [
          doc.storage_path,
        ]);
      const meta = () => sql(`select 1 from public."PropertyDocuments" where id = $1`, [doc.id]);

      // Simulate a prior attempt that removed storage then failed before DB delete.
      await sql(`delete from storage.objects where bucket_id = 'property-documents' and name = $1`, [
        doc.storage_path,
      ]);
      expect(await stored()).toHaveLength(0);
      expect(await meta(), "metadata row must still be present for retry").toHaveLength(1);

      await signInApp("admin");
      await data.deletePropertyDocument(doc.id);

      expect(await meta(), "retry must clear the stale metadata row").toHaveLength(0);
      expect((await data.listPropertyDocuments()).some((d) => d.id === doc.id)).toBe(false);
    });
  });

  describe("only an admin decides who can see a document", () => {
    test("a worker cannot upload a document as tenant-visible", async () => {
      await signInApp("worker");
      await expect(
        data.uploadPropertyDocument({
          property_id: world.property.id,
          title: "Worker tries tenant visibility",
          file: pdfFile(),
          visibility: "tenant",
        }),
      ).rejects.toThrow(/only admins can set document visibility/i);
      expect(await sql(`select 1 from public."PropertyDocuments" where title = 'Worker tries tenant visibility'`)).toHaveLength(0);
    });

    test("a worker cannot widen a document's visibility afterwards", async () => {
      const doc = await uploadAsAdmin("Staff eyes only");
      await signInApp("worker");
      await expect(data.updatePropertyDocumentVisibility(doc.id, "tenant")).rejects.toThrow(
        /only admins can change document visibility/i,
      );
    });

    test("an admin changes a document from staff-only to tenant-visible", async () => {
      const doc = await uploadAsAdmin("Recycling schedule");
      expect(await titlesVisibleTo("tenant")).not.toContain("Recycling schedule");
      await signInApp("admin");
      const updated = await data.updatePropertyDocumentVisibility(doc.id, "tenant");
      expect(updated.visibility).toBe("tenant");
      expect(await titlesVisibleTo("tenant")).toContain("Recycling schedule");
    });
  });

  describe("who sees what", () => {
    beforeAll(async () => {
      await uploadAsAdmin("VIS staff-only", { visibility: "staff" });
      await uploadAsAdmin("VIS landlord", { visibility: "landlord" });
      await uploadAsAdmin("VIS tenant building-wide", { visibility: "tenant" });
      await uploadAsAdmin("VIS tenant unit 1A", { visibility: "tenant", unit_id: world.units.a.id });
      await uploadAsAdmin("VIS tenant other property", { visibility: "tenant", property_id: world.otherProperty.id });
    });

    const vis = (titles: string[]) => titles.filter((t) => t.startsWith("VIS "));

    test("staff see every document", async () => {
      expect(vis(await titlesVisibleTo("worker"))).toHaveLength(5);
      expect(vis(await titlesVisibleTo("admin"))).toHaveLength(5);
    });

    test("a tenant sees tenant-visible documents for their own property and unit only", async () => {
      expect(vis(await titlesVisibleTo("tenant"))).toEqual(["VIS tenant building-wide", "VIS tenant unit 1A"]);
    });

    test("a tenant in another unit does not see a document scoped to unit 1A", async () => {
      expect(vis(await titlesVisibleTo("tenant2"))).toEqual(["VIS tenant building-wide"]);
    });

    test("a landlord's access is limited to landlord- and tenant-visible documents on properties they own", async () => {
      const client = await clientFor("landlord");
      const { data: rows } = await client.from("PropertyDocuments").select("title").like("title", "VIS %").order("title");
      expect(rows?.map((r) => r.title)).toEqual(["VIS landlord", "VIS tenant building-wide", "VIS tenant unit 1A"]);
    });

    test("a tenant cannot download a staff-only file even with its storage path", async () => {
      const [doc] = await sql<{ storage_path: string }>(
        `select storage_path from public."PropertyDocuments" where title = 'VIS staff-only'`,
      );
      const client = await clientFor("tenant");
      const signed = await client.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
      expect(signed.error).not.toBeNull();
    });

    describe("visibility isolation", () => {
      test("a tenant never sees landlord-only or staff-only documents", async () => {
        const titles = await titlesVisibleTo("tenant");
        expect(titles).not.toContain("VIS staff-only");
        expect(titles).not.toContain("VIS landlord");
        const client = await clientFor("tenant");
        const { data: rows } = await client
          .from("PropertyDocuments")
          .select("title, visibility")
          .in("title", ["VIS staff-only", "VIS landlord"]);
        expect(rows).toEqual([]);
      });

      test("a landlord cannot download a staff-only file even with its storage path", async () => {
        const [doc] = await sql<{ storage_path: string }>(
          `select storage_path from public."PropertyDocuments" where title = 'VIS staff-only'`,
        );
        const client = await clientFor("landlord");
        expect(
          (await client.from("PropertyDocuments").select("id").eq("title", "VIS staff-only")).data,
        ).toEqual([]);
        const signed = await client.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
        expect(signed.error).not.toBeNull();
      });

      test("a landlord can download landlord- and tenant-visible files on owned properties", async () => {
        const client = await clientFor("landlord");
        for (const title of ["VIS landlord", "VIS tenant building-wide"]) {
          const [doc] = await sql<{ storage_path: string }>(
            `select storage_path from public."PropertyDocuments" where title = $1`,
            [title],
          );
          const signed = await client.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
          expect(signed.error, title).toBeNull();
          const res = await fetch(signed.data!.signedUrl);
          expect(res.status, title).toBe(200);
        }
      });

      test("a landlord cannot see documents on a property they do not own", async () => {
        const client = await clientFor("landlord");
        const { data: rows } = await client
          .from("PropertyDocuments")
          .select("title")
          .eq("title", "VIS tenant other property");
        expect(rows).toEqual([]);
        const [doc] = await sql<{ storage_path: string }>(
          `select storage_path from public."PropertyDocuments" where title = 'VIS tenant other property'`,
        );
        const signed = await client.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
        expect(signed.error).not.toBeNull();
      });

      test("a tenant cannot download a landlord-only file even with its storage path", async () => {
        const [doc] = await sql<{ storage_path: string }>(
          `select storage_path from public."PropertyDocuments" where title = 'VIS landlord'`,
        );
        const client = await clientFor("tenant");
        const signed = await client.storage.from("property-documents").createSignedUrl(doc.storage_path, 60);
        expect(signed.error).not.toBeNull();
      });

      test("a pending user sees no property documents at all", async () => {
        const client = await clientFor("pending");
        const { data: rows } = await client.from("PropertyDocuments").select("id");
        expect(rows).toEqual([]);
      });
    });
  });

  describe("tenants and landlords cannot manage documents", () => {
    test.each(["tenant", "landlord"] as const)("a %s cannot upload a file", async (persona) => {
      const client = await clientFor(persona);
      const up = await client.storage
        .from("property-documents")
        .upload(`${world.property.id}/sneaky-${persona}.pdf`, pdfFile(), { contentType: "application/pdf" });
      expect(up.error).not.toBeNull();
    });

    test.each(["tenant", "landlord"] as const)("a %s cannot delete or relabel a document", async (persona) => {
      const [doc] = await sql<{ id: number }>(
        `select id from public."PropertyDocuments" where title = 'VIS tenant building-wide'`,
      );
      const client = await clientFor(persona);
      expectDenied(await client.from("PropertyDocuments").delete().eq("id", doc.id).select());
      expectDenied(await client.from("PropertyDocuments").update({ title: "Defaced" }).eq("id", doc.id).select());
      expect(await sql(`select 1 from public."PropertyDocuments" where id = $1 and title = 'VIS tenant building-wide'`, [doc.id])).toHaveLength(1);
    });

    test("a landlord cannot clear metadata via delete retry when storage is already gone", async () => {
      const doc = await uploadAsAdmin("Landlord retry delete", { visibility: "landlord" });
      await sql(`delete from storage.objects where bucket_id = 'property-documents' and name = $1`, [
        doc.storage_path,
      ]);
      await signInApp("landlord");
      await expect(data.deletePropertyDocument(doc.id)).rejects.toThrow(
        /metadata could not be deleted|Failed to remove document from storage/i,
      );
      expect(
        await sql(`select 1 from public."PropertyDocuments" where id = $1`, [doc.id]),
        "landlord must not clear the row just because storage was already gone",
      ).toHaveLength(1);
    });
  });
});
