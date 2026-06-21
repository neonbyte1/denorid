import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createConnectionMap } from "./_connections.ts";
import { DuplicateS3ConnectionNameError } from "./exceptions.ts";
import { StorageClient } from "./storage_client.ts";

const baseConfig = {
  region: "us-east-1",
  credentials: { accessKeyId: "x", secretAccessKey: "y" },
};

describe("createConnectionMap", () => {
  it("registers the single-form connection under the default name", () => {
    const map = createConnectionMap({ connection: baseConfig });

    assertEquals([...map.keys()], ["default"]);
    assertInstanceOf(map.get("default"), StorageClient);
  });

  it("registers every multi-form entry under its declared name", () => {
    const map = createConnectionMap({
      connections: [
        { name: "primary", ...baseConfig },
        { name: "backup", ...baseConfig, region: "eu-central-1" },
      ],
    });

    assertEquals([...map.keys()].sort(), ["backup", "primary"]);
    assertInstanceOf(map.get("primary"), StorageClient);
    assertInstanceOf(map.get("backup"), StorageClient);
  });

  it("forwards SDK config into the constructed client", async () => {
    const map = createConnectionMap({
      connections: [{ name: "eu", ...baseConfig, region: "eu-central-1" }],
    });
    const client = map.get("eu")!;

    assertEquals(await client.config.region(), "eu-central-1");
  });

  it("throws DuplicateS3ConnectionNameError on a repeated name", () => {
    const error = assertThrows(
      () =>
        createConnectionMap({
          connections: [
            { name: "same", ...baseConfig },
            { name: "same", ...baseConfig, region: "eu-central-1" },
          ],
        }),
      DuplicateS3ConnectionNameError,
    );

    assertEquals(error.connectionName, "same");
  });

  it("strips the synthetic name field from the SDK config it forwards", async () => {
    // Regression: the SDK rejects unknown top-level fields; ensure `name`
    // is consumed by the registry rather than passed to `new StorageClient`.
    const map = createConnectionMap({
      connections: [{ name: "probe", ...baseConfig }],
    });
    const client = map.get("probe")!;

    assertEquals(await client.config.region(), "us-east-1");
    // Best-effort sanity: SDK config does not surface a stray `name`.
    assertEquals(
      Object.prototype.hasOwnProperty.call(client.config, "name"),
      false,
    );
  });
});
