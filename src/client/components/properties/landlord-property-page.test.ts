import { describe, expect, it } from "vitest";
import { resolveSupportContact } from "@/lib/support-contact";
import { documentSendHelp } from "./landlord-property-page";

describe("documentSendHelp", () => {
  it("says owners can't upload and the office will reply with how to send the file", () => {
    const text = documentSendHelp(resolveSupportContact({}).officeEmail);
    expect(text).toContain("You can't upload files here.");
    expect(text).toContain("they'll reply with how to send it");
    expect(text).not.toContain("To be confirmed");
  });

  it("names the office email once it is confirmed", () => {
    const email = resolveSupportContact({ VITE_SUPPORT_OFFICE_EMAIL: "office@example.com" }).officeEmail;
    expect(documentSendHelp(email)).toContain("email it to office@example.com");
  });
});
