import test from "node:test";
import assert from "node:assert/strict";
import { PHONE_CONTEXT, isPhoneRequired } from "../worker/phone-status.mjs";

const requireChecks = (...contexts) => ({
  type: "required_status_checks",
  parameters: { required_status_checks: contexts.map((context) => ({ context })) },
});

test("the phone status holds a merge only when main's rules require it", () => {
  assert.equal(
    isPhoneRequired([{ type: "deletion" }, requireChecks("check", PHONE_CONTEXT)]),
    true,
  );
  assert.equal(isPhoneRequired([requireChecks("check")]), false);
  assert.equal(isPhoneRequired([{ type: "pull_request", parameters: {} }]), false);
  assert.equal(isPhoneRequired([]), false);
});
