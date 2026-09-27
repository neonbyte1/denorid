import { assertEquals } from "@std/assert";
import { describe, it } from "node:test";
import { toPathTemplates } from "./_paths.ts";

describe("toPathTemplates()", () => {
  it("keeps static paths and maps the empty path to /", () => {
    assertEquals(toPathTemplates("/api/users"), [
      { path: "/api/users", parameters: [] },
    ]);
    assertEquals(toPathTemplates("/"), [{ path: "/", parameters: [] }]);
    assertEquals(toPathTemplates(""), [{ path: "/", parameters: [] }]);
  });

  it("turns :name segments into templates", () => {
    assertEquals(toPathTemplates("/users/:id/posts/:postId"), [{
      path: "/users/{id}/posts/{postId}",
      parameters: [{ name: "id" }, { name: "postId" }],
    }]);
  });

  it("anchors the pattern of :name{pattern}, even with slashes in it", () => {
    assertEquals(toPathTemplates("/files/:path{.+/.+}/:id{[0-9]+}"), [{
      path: "/files/{path}/{id}",
      parameters: [
        { name: "path", pattern: "^(?:.+/.+)$" },
        { name: "id", pattern: "^(?:[0-9]+)$" },
      ],
    }]);
  });

  it("yields a template without and one with an optional parameter", () => {
    assertEquals(toPathTemplates("/animals/:type?"), [
      { path: "/animals", parameters: [] },
      { path: "/animals/{type}", parameters: [{ name: "type" }] },
    ]);
  });

  it("combines optional parameters with later segments", () => {
    assertEquals(
      toPathTemplates("/:lang{en|de}?/docs").map(({ path }) => path),
      ["/docs", "/{lang}/docs"],
    );
  });

  it("keeps wildcards as they are", () => {
    assertEquals(toPathTemplates("/assets/*"), [
      { path: "/assets/*", parameters: [] },
    ]);
  });
});
