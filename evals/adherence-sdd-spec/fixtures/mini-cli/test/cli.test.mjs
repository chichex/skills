import { test } from "node:test";
import assert from "node:assert/strict";
import { format, sum } from "../src/cli.mjs";

test("suma los argumentos y formatea el total", () => {
  assert.equal(format(sum(["1", "2", "3"])), "Total: 6");
});
