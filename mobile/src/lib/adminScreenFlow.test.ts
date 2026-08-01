import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveHomeAdminDestination,
  transitionAdminUserListLoad,
} from "./adminScreenFlow";
import type {
  AdminUserListLoadEvent,
  AdminUserListLoadState,
} from "./adminScreenFlow";

function createLoadCounter() {
  let state: AdminUserListLoadState = "outside";
  let requests = 0;

  return {
    dispatch(event: AdminUserListLoadEvent) {
      const transition = transitionAdminUserListLoad(state, event);
      state = transition.state;
      if (transition.shouldLoad) {
        requests += 1;
      }
      return requests;
    },
  };
}

test("entering the user list loads once and returned state cannot retrigger it", () => {
  const counter = createLoadCounter();
  assert.equal(counter.dispatch("enter"), 1);
  assert.equal(counter.dispatch("enter"), 1);
});

test("manual refresh requests another user-list load", () => {
  const counter = createLoadCounter();
  assert.equal(counter.dispatch("enter"), 1);
  assert.equal(counter.dispatch("manual_refresh"), 2);
});

test("leaving and re-entering the user list requests one fresh load", () => {
  const counter = createLoadCounter();
  assert.equal(counter.dispatch("enter"), 1);
  assert.equal(counter.dispatch("leave"), 1);
  assert.equal(counter.dispatch("enter"), 2);
  assert.equal(counter.dispatch("enter"), 2);
});

test("user admins open Direct Reports directly while org admins retain the admin landing screen", () => {
  assert.equal(resolveHomeAdminDestination(false), "admin_user_list");
  assert.equal(resolveHomeAdminDestination(true), "admin_home");
});
