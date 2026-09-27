import { Hono } from "@hono/hono";
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import type { RuntimeGlobals } from "./_serve.ts";
import { createStaticFilesHandler } from "./_static_files.ts";
import type { StaticFilesOptions } from "./adapter.ts";

describe(createStaticFilesHandler.name, () => {
  const MTIME = new Date("2026-01-01T00:00:00Z");
  const HTML = { Accept: "text/html,application/xhtml+xml" };

  interface TempRoot extends AsyncDisposable {
    path: string;
  }

  async function makeRoot(files: Record<string, string>): Promise<TempRoot> {
    const path = await Deno.makeTempDir();

    for (const [name, content] of Object.entries(files)) {
      const file = join(path, name);

      await Deno.mkdir(dirname(file), { recursive: true });
      await Deno.writeTextFile(file, content);
      await Deno.utime(file, MTIME, MTIME);
    }

    return {
      path,
      [Symbol.asyncDispose]: () => Deno.remove(path, { recursive: true }),
    };
  }

  async function makeApp(
    options: StaticFilesOptions,
    basePath: string = "/",
  ): Promise<Hono> {
    const app = new Hono();

    app.get("*", await createStaticFilesHandler(options, basePath));

    return app;
  }

  /** Requests an absolute URL so Hono keeps the path exactly as given. */
  async function fetchText(
    app: Hono,
    path: string,
    init?: RequestInit,
  ): Promise<[number, string]> {
    const response = await app.request(`http://localhost${path}`, init);

    return [response.status, await response.text()];
  }

  describe("setup", () => {
    it("rejects a missing root", async () => {
      await using root = await makeRoot({});

      await assertRejects(
        () => createStaticFilesHandler({ root: join(root.path, "dist") }, "/"),
        Error,
        "is not a directory",
      );
    });

    it("rejects a root that is a file", async () => {
      await using root = await makeRoot({ "index.html": "" });

      await assertRejects(
        () =>
          createStaticFilesHandler(
            { root: join(root.path, "index.html") },
            "/",
          ),
        Error,
        "is not a directory",
      );
    });

    it("resolves a relative root against the working directory", async () => {
      await using root = await makeRoot({ "robots.txt": "allow" });
      const app = await makeApp({ root: relative(Deno.cwd(), root.path) });

      assertEquals(await fetchText(app, "/robots.txt"), [200, "allow"]);
    });

    for (const fallback of ["missing.html", "assets", "../index.html"]) {
      it(`rejects the fallback ${fallback}`, async () => {
        await using root = await makeRoot({ "assets/app.js": "" });

        await assertRejects(
          () => createStaticFilesHandler({ root: root.path, fallback }, "/"),
          Error,
          "is not a file in",
        );
      });
    }
  });

  describe("files", () => {
    it("serves a file with type, length and a revalidating cache policy", async () => {
      await using root = await makeRoot({ "robots.txt": "User-agent: *" });
      const app = await makeApp({ root: root.path });
      const response = await app.request("/robots.txt");

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "User-agent: *");
      assertEquals(
        response.headers.get("Content-Type"),
        "text/plain; charset=utf-8",
      );
      assertEquals(response.headers.get("Content-Length"), "13");
      assertEquals(response.headers.get("Accept-Ranges"), "bytes");
      assertEquals(response.headers.get("Cache-Control"), "no-cache");
      assertEquals(
        response.headers.get("Last-Modified"),
        MTIME.toUTCString(),
      );
    });

    it("serves unknown file types as application/octet-stream", async () => {
      await using root = await makeRoot({ "data.unknownext": "bytes" });
      const app = await makeApp({ root: root.path });
      const response = await app.request("/data.unknownext");

      assertEquals(
        response.headers.get("Content-Type"),
        "application/octet-stream",
      );
      assertEquals(await response.text(), "bytes");
    });

    it("serves the directory index", async () => {
      await using root = await makeRoot({
        "index.html": "root",
        "docs/index.html": "docs",
      });
      const app = await makeApp({ root: root.path });

      assertEquals(await fetchText(app, "/"), [200, "root"]);
      assertEquals(await fetchText(app, "/docs"), [200, "docs"]);
      assertEquals(await fetchText(app, "/docs/"), [200, "docs"]);
    });

    it("passes on directories without index and files requested as directories", async () => {
      await using root = await makeRoot({ "assets/app.js": "" });
      const app = await makeApp({ root: root.path });

      assertEquals((await app.request("/assets")).status, 404);
      assertEquals((await app.request("/assets/app.js/")).status, 404);
      assertEquals((await app.request("/missing.js")).status, 404);
    });

    it("decodes percent-encoded segments", async () => {
      await using root = await makeRoot({ "hello world.txt": "hi" });
      const app = await makeApp({ root: root.path });

      assertEquals(await fetchText(app, "/hello%20world.txt"), [200, "hi"]);
    });

    it("reads files through Bun.file on Bun", async () => {
      await using root = await makeRoot({ "robots.txt": "User-agent: *" });
      const file = spy((path: string) => new Blob([Deno.readFileSync(path)]));
      const app = new Hono();

      app.get(
        "*",
        await createStaticFilesHandler({ root: root.path }, "/", {
          Bun: { file },
        }),
      );

      assertEquals(await fetchText(app, "/robots.txt"), [200, "User-agent: *"]);
      assertSpyCall(file, 0, { args: [join(root.path, "robots.txt")] });
    });

    it("answers HEAD requests without a body", async () => {
      await using root = await makeRoot({ "robots.txt": "User-agent: *" });
      const app = await makeApp({ root: root.path });
      const response = await app.request("/robots.txt", { method: "HEAD" });

      assertEquals(response.status, 200);
      assertEquals(response.body, null);
      assertEquals(response.headers.get("Content-Length"), "13");
    });

    it("lets files of the immutable directory be cached for a year", async () => {
      await using root = await makeRoot({
        "assets/app-1a2b.js": "",
        "assets.js": "",
        "index.html": "",
      });
      const app = await makeApp({ root: root.path, immutable: "assets" });
      const cacheControl = async (path: string): Promise<string | null> =>
        (await app.request(path)).headers.get("Cache-Control");

      assertEquals(
        await cacheControl("/assets/app-1a2b.js"),
        "public, max-age=31536000, immutable",
      );
      assertEquals(await cacheControl("/assets.js"), "no-cache");
      assertEquals(await cacheControl("/"), "no-cache");
    });
  });

  describe("rejected paths", () => {
    const paths = [
      "/.env",
      "/.git/config",
      "/assets/.secret",
      "/assets/.well-known/key",
      "//robots.txt",
      "/assets%2Fapp.js",
      "/assets%5Capp.js",
      "/robots.txt%00",
      "/%E0%A4%A",
    ];

    for (const path of paths) {
      it(`passes on ${path}`, async () => {
        await using root = await makeRoot({
          ".env": "SECRET",
          ".git/config": "SECRET",
          "assets/.secret": "SECRET",
          "assets/.well-known/key": "SECRET",
          "assets/app.js": "SECRET",
          "robots.txt": "SECRET",
        });
        const app = await makeApp({ root: root.path });

        assertEquals(await fetchText(app, path), [404, "404 Not Found"]);
      });
    }

    it("serves well-known URIs", async () => {
      await using root = await makeRoot({
        ".well-known/security.txt": "Contact: x",
      });
      const app = await makeApp({ root: root.path });

      assertEquals(
        await fetchText(app, "/.well-known/security.txt"),
        [200, "Contact: x"],
      );
    });
  });

  describe("conditional requests", () => {
    interface ConditionalFixture extends TempRoot {
      app: Hono;
      etag: string;
    }

    async function makeConditionalApp(): Promise<ConditionalFixture> {
      const root = await makeRoot({ "robots.txt": "User-agent: *" });
      const app = await makeApp({ root: root.path });
      const etag = (await app.request("/robots.txt")).headers.get("ETag");

      return { ...root, app, etag: etag ?? "" };
    }

    async function status(
      app: Hono,
      headers: Record<string, string>,
    ): Promise<number> {
      return (await app.request("/robots.txt", { headers })).status;
    }

    it("answers 304 with the validators when the entity tag matches", async () => {
      await using fixture = await makeConditionalApp();
      const response = await fixture.app.request("/robots.txt", {
        headers: { "If-None-Match": fixture.etag },
      });

      assertEquals(response.status, 304);
      assertEquals(response.body, null);
      assertEquals(response.headers.get("ETag"), fixture.etag);
      assertEquals(response.headers.get("Cache-Control"), "no-cache");
      assertEquals(response.headers.get("Last-Modified"), MTIME.toUTCString());
    });

    it("compares entity tags weakly", async () => {
      await using fixture = await makeConditionalApp();
      const { app, etag } = fixture;

      assertEquals(await status(app, { "If-None-Match": `W/${etag}` }), 304);
      assertEquals(
        await status(app, { "If-None-Match": `"other", ${etag}` }),
        304,
      );
      assertEquals(await status(app, { "If-None-Match": "*" }), 304);
      assertEquals(await status(app, { "If-None-Match": '"other"' }), 200);
    });

    it("changes the entity tag when the file changes", async () => {
      await using fixture = await makeConditionalApp();

      await Deno.writeTextFile(
        join(fixture.path, "robots.txt"),
        "User-agent: none",
      );

      const response = await fixture.app.request("/robots.txt", {
        headers: { "If-None-Match": fixture.etag },
      });

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "User-agent: none");
    });

    it("compares If-Modified-Since with second precision", async () => {
      await using fixture = await makeConditionalApp();
      const since = (date: Date): Promise<number> =>
        status(fixture.app, { "If-Modified-Since": date.toUTCString() });

      assertEquals(await since(MTIME), 304);
      assertEquals(await since(new Date(MTIME.getTime() + 60_000)), 304);
      assertEquals(await since(new Date(MTIME.getTime() - 1_000)), 200);
      assertEquals(
        await status(fixture.app, { "If-Modified-Since": "yesterday" }),
        200,
      );
    });

    it("prefers If-None-Match over If-Modified-Since", async () => {
      await using fixture = await makeConditionalApp();

      assertEquals(
        await status(fixture.app, {
          "If-None-Match": '"other"',
          "If-Modified-Since": MTIME.toUTCString(),
        }),
        200,
      );
    });
  });

  describe("range requests", () => {
    const CONTENT = "0123456789abcdefghij";

    interface RangeFixture extends TempRoot {
      app: Hono;
      etag: string;
    }

    async function makeRangeApp(
      runtime?: RuntimeGlobals,
    ): Promise<RangeFixture> {
      const root = await makeRoot({ "data.bin": CONTENT, "empty.bin": "" });
      const app = new Hono();

      app.get(
        "*",
        await createStaticFilesHandler({ root: root.path }, "/", runtime),
      );

      const etag = (await app.request("/data.bin")).headers.get("ETag");

      return { ...root, app, etag: etag ?? "" };
    }

    /** Status, `Content-Range`, `Content-Length` and body of a response. */
    async function fetchRange(
      app: Hono,
      headers: Record<string, string>,
      init: { path?: string; method?: string } = {},
    ): Promise<[number, string | null, string | null, string]> {
      const response = await app.request(init.path ?? "/data.bin", {
        method: init.method,
        headers,
      });

      return [
        response.status,
        response.headers.get("Content-Range"),
        response.headers.get("Content-Length"),
        await response.text(),
      ];
    }

    const satisfiable: [string, string, string][] = [
      ["bytes=2-5", "bytes 2-5/20", "2345"],
      ["bytes=15-", "bytes 15-19/20", "fghij"],
      ["bytes=-3", "bytes 17-19/20", "hij"],
      ["bytes=-100", "bytes 0-19/20", CONTENT],
      ["bytes=18-99", "bytes 18-19/20", "ij"],
      [" Bytes=0-0 ", "bytes 0-0/20", "0"],
    ];

    for (const [range, contentRange, body] of satisfiable) {
      it(`answers ${JSON.stringify(range)} with 206 ${contentRange}`, async () => {
        await using fixture = await makeRangeApp();

        assertEquals(
          await fetchRange(fixture.app, { Range: range }),
          [206, contentRange, String(body.length), body],
        );
      });
    }

    for (const range of ["bytes=20-", "bytes=-0"]) {
      it(`answers ${JSON.stringify(range)} with 416`, async () => {
        await using fixture = await makeRangeApp();

        assertEquals(
          await fetchRange(fixture.app, { Range: range }),
          [416, "bytes */20", "0", ""],
        );
      });
    }

    for (
      const range of [
        "bytes=5-2",
        "bytes=-",
        "bytes=0-1,4-5",
        "items=0-1",
        "bytes=a-b",
      ]
    ) {
      it(`ignores ${JSON.stringify(range)} and sends the whole file`, async () => {
        await using fixture = await makeRangeApp();

        assertEquals(
          await fetchRange(fixture.app, { Range: range }),
          [200, null, "20", CONTENT],
        );
      });
    }

    it("ignores ranges of empty files", async () => {
      await using fixture = await makeRangeApp();

      assertEquals(
        await fetchRange(fixture.app, { Range: "bytes=0-" }, {
          path: "/empty.bin",
        }),
        [200, null, "0", ""],
      );
    });

    it("ignores ranges of HEAD requests", async () => {
      await using fixture = await makeRangeApp();

      assertEquals(
        await fetchRange(fixture.app, { Range: "bytes=2-5" }, {
          method: "HEAD",
        }),
        [200, null, "20", ""],
      );
    });

    it("sends the range while If-Range matches", async () => {
      await using fixture = await makeRangeApp();

      for (const ifRange of [fixture.etag, MTIME.toUTCString()]) {
        assertEquals(
          await fetchRange(fixture.app, {
            Range: "bytes=2-5",
            "If-Range": ifRange,
          }),
          [206, "bytes 2-5/20", "4", "2345"],
        );
      }
    });

    it("sends the whole file once If-Range no longer matches", async () => {
      await using fixture = await makeRangeApp();
      const stale = [
        '"other"',
        `W/${fixture.etag}`,
        new Date(MTIME.getTime() - 1_000).toUTCString(),
      ];

      for (const ifRange of stale) {
        assertEquals(
          await fetchRange(fixture.app, {
            Range: "bytes=2-5",
            "If-Range": ifRange,
          }),
          [200, null, "20", CONTENT],
        );
      }
    });

    it("answers 304 before evaluating the range", async () => {
      await using fixture = await makeRangeApp();
      const [status] = await fetchRange(fixture.app, {
        Range: "bytes=2-5",
        "If-None-Match": fixture.etag,
      });

      assertEquals(status, 304);
    });

    it("slices Bun file blobs for ranges", async () => {
      const file = spy((path: string) => new Blob([Deno.readFileSync(path)]));
      await using fixture = await makeRangeApp({ Bun: { file } });

      assertEquals(
        await fetchRange(fixture.app, { Range: "bytes=2-5" }),
        [206, "bytes 2-5/20", "4", "2345"],
      );
      assertSpyCalls(file, 2);
    });

    it("streams whole files to range requests on Bun", async () => {
      const file = spy((path: string) => new Blob([Deno.readFileSync(path)]));
      await using fixture = await makeRangeApp({ Bun: { file } });

      assertEquals(
        await fetchRange(fixture.app, {
          Range: "bytes=2-5",
          "If-Range": '"other"',
        }),
        [200, null, "20", CONTENT],
      );
      // Only the setup request without a Range header read a Bun file blob.
      assertSpyCalls(file, 1);
    });
  });

  describe("fallback", () => {
    it("answers page requests nothing else matches", async () => {
      await using root = await makeRoot({ "index.html": "<spa>" });
      const app = await makeApp({ root: root.path, fallback: "index.html" });
      const response = await app.request("/users/42", { headers: HTML });

      assertEquals(response.status, 200);
      assertEquals(await response.text(), "<spa>");
      assertEquals(
        response.headers.get("Content-Type"),
        "text/html; charset=utf-8",
      );
      assertEquals(response.headers.get("Cache-Control"), "no-cache");
      assertEquals(response.headers.get("Vary"), "Accept");
    });

    it("answers page requests for rejected paths without exposing them", async () => {
      await using root = await makeRoot({
        ".env": "SECRET",
        "index.html": "<spa>",
      });
      const app = await makeApp({ root: root.path, fallback: "index.html" });

      assertEquals(
        await fetchText(app, "/.env", { headers: HTML }),
        [200, "<spa>"],
      );
    });

    it("passes on requests that do not accept HTML", async () => {
      await using root = await makeRoot({ "index.html": "<spa>" });
      const app = await makeApp({ root: root.path, fallback: "index.html" });

      assertEquals((await app.request("/app.js")).status, 404);
      assertEquals(
        (await app.request("/app.js", { headers: { Accept: "*/*" } })).status,
        404,
      );
    });

    it("passes on page requests without a configured fallback", async () => {
      await using root = await makeRoot({ "index.html": "<spa>" });
      const app = await makeApp({ root: root.path });

      assertEquals(
        (await app.request("/users", { headers: HTML })).status,
        404,
      );
    });

    it("passes on page requests once the fallback was removed", async () => {
      await using root = await makeRoot({ "index.html": "<spa>" });
      const app = await makeApp({ root: root.path, fallback: "index.html" });

      await Deno.remove(join(root.path, "index.html"));

      assertEquals(
        (await app.request("/users", { headers: HTML })).status,
        404,
      );
    });
  });

  describe("base path", () => {
    it("passes on requests at or below the base path", async () => {
      await using root = await makeRoot({
        "api/data.json": "SECRET",
        "index.html": "<spa>",
      });
      const app = await makeApp(
        { root: root.path, fallback: "index.html" },
        "/api",
      );

      assertEquals((await app.request("/api/data.json")).status, 404);
      assertEquals((await app.request("/api", { headers: HTML })).status, 404);
      assertEquals(
        (await app.request("/api/users", { headers: HTML })).status,
        404,
      );
    });

    it("serves paths that only share a prefix with the base path", async () => {
      await using root = await makeRoot({ "apidocs.txt": "docs" });
      const app = await makeApp({ root: root.path }, "/api");

      assertEquals(await fetchText(app, "/apidocs.txt"), [200, "docs"]);
    });
  });
});
