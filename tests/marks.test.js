"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/marks.js");
const S = require("../js/schedule.js");

test("date key is the JST date", () => {
  assert.equal(M.dateKey(S.jstParts(Date.parse("2026-10-16T10:00:00+09:00"))), "2026-10-16");
  // 15:00 UTC is already the next day in Japan
  assert.equal(M.dateKey(S.jstParts(Date.parse("2026-10-16T15:00:00Z"))), "2026-10-17");
  assert.equal(M.dateKey(S.jstParts(Date.parse("2026-01-05T00:00:00+09:00"))), "2026-01-05");
});

test("toggle adds and removes, keeping the list sorted", () => {
  let l = [];
  l = M.toggle(l, 4);
  l = M.toggle(l, 2);
  assert.deepEqual(l, [2, 4]);
  l = M.toggle(l, 4);
  assert.deepEqual(l, [2]);
  assert.deepEqual(M.toggle([2], 2), []);
});

test("marks round-trip for the same day", () => {
  const raw = M.serialize("2026-10-16", [3, 5]);
  assert.deepEqual(M.parse(raw, "2026-10-16"), [3, 5]);
});

test("marks from another day are dropped (next day starts clean)", () => {
  const raw = M.serialize("2026-10-16", [3, 5]);
  assert.deepEqual(M.parse(raw, "2026-10-17"), []);
  assert.deepEqual(M.parse(raw, "2025-10-16"), []);
});

test("bad stored data is ignored", () => {
  for (const raw of [null, undefined, "", "not json", "{}", '{"date":"2026-10-16"}', '{"date":"2026-10-16","periods":"3"}']) {
    assert.deepEqual(M.parse(raw, "2026-10-16"), [], String(raw));
  }
  assert.deepEqual(M.parse('{"date":"2026-10-16","periods":[5,"x",3,3,-1,2.5]}', "2026-10-16"), [3, 5]);
});
