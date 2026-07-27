import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";

process.env.PERITIO_APP_HOST = "app.peritio.ai";
process.env.PERITIO_PUBLIC_HOST = "peritio.ai";

function appHostRequest(pathname: string): NextRequest {
  return new NextRequest(`https://app.peritio.ai${pathname}`, {
    headers: { host: "app.peritio.ai" },
  });
}

function publicHostRequest(pathname: string): NextRequest {
  return new NextRequest(`https://peritio.ai${pathname}`, {
    headers: { host: "peritio.ai" },
  });
}

test("middleware allows dashboard admin API calls on the app host", () => {
  const response = middleware(appHostRequest("/api/admin/users?export=csv"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
});

test("middleware still redirects non-app API paths away from the app host", () => {
  const response = middleware(appHostRequest("/api/unknown"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://peritio.ai/");
});

test("middleware treats dashboard admin API as app-owned on the public host", () => {
  const response = middleware(publicHostRequest("/api/admin/users"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://app.peritio.ai/api/admin/users");
});
