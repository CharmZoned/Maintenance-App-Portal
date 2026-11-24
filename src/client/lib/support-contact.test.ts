import { describe, expect, it } from "vitest";
import { SUPPORT_PLACEHOLDER, resolveSupportContact } from "./support-contact";

describe("resolveSupportContact", () => {
  it("shows a placeholder for every line until the contact is confirmed", () => {
    const contact = resolveSupportContact({});
    expect(contact.configured).toBe(false);
    for (const line of [contact.officePhone, contact.officeEmail, contact.afterHoursPhone]) {
      expect(line.value).toBe(SUPPORT_PLACEHOLDER);
      expect(line.href).toBeNull();
      expect(line.configured).toBe(false);
    }
  });

  it("treats blank values as unset", () => {
    expect(resolveSupportContact({ VITE_SUPPORT_OFFICE_PHONE: "   " }).officePhone.configured).toBe(false);
  });

  it("links confirmed phone numbers and email", () => {
    const contact = resolveSupportContact({
      VITE_SUPPORT_OFFICE_PHONE: "(555) 010-2000",
      VITE_SUPPORT_OFFICE_EMAIL: "office@example.com",
      VITE_SUPPORT_AFTER_HOURS_PHONE: "+1 555 010 2999",
    });
    expect(contact.configured).toBe(true);
    expect(contact.officePhone).toMatchObject({ value: "(555) 010-2000", href: "tel:5550102000" });
    expect(contact.afterHoursPhone.href).toBe("tel:+15550102999");
    expect(contact.officeEmail.href).toBe("mailto:office@example.com");
  });

  it("is only configured when every line is set", () => {
    expect(resolveSupportContact({ VITE_SUPPORT_OFFICE_PHONE: "555-0100" }).configured).toBe(false);
  });
});
