import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { recordElement } from "../../src/runtime.js";

const metadata = { file: "view.tsx", line: 1, column: 1, name: "button" };

test("recordElement returns the factory's element unchanged", () => {
  const element = React.createElement("button", { id: "button" }, "label");
  const props = element.props;
  assert.equal(recordElement(element, metadata), element);
  assert.equal(element.props, props);
  assert.deepEqual(element.props, { id: "button", children: "label" });
  const custom = { type: "x", props: { slot: 1 } };
  assert.equal(recordElement(custom, metadata), custom);
  assert.equal(recordElement(null, metadata), null);
});

test("recordElement rejects malformed compiler metadata", () => {
  for (const source of [
    "bad",
    null,
    { file: "view.tsx", line: 0, column: 1, name: "button" },
    { file: "view.tsx", line: 1, column: 1 },
  ]) {
    assert.throws(
      () => recordElement(React.createElement("div"), source as never),
      /Invalid compiler/,
    );
  }
});
