import { S3, S3Client } from "@aws-sdk/client-s3";
import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { StorageClient } from "./storage_client.ts";

describe("StorageClient", () => {
  it("extends the @aws-sdk/client-s3 aggregated S3 class (and therefore S3Client)", () => {
    const client = new StorageClient({ region: "us-east-1" });

    assertInstanceOf(client, StorageClient);
    assertInstanceOf(client, S3);
    assertInstanceOf(client, S3Client);
  });

  it("exposes a method for every aggregated S3 command and the lifecycle hooks", () => {
    const client = new StorageClient({ region: "us-east-1" });

    // Spot-check one command from each major area + the destroy lifecycle hook.
    // The intent is structural coverage, not an exhaustive enumeration that
    // would drift every time the SDK adds an operation.
    const surface: Array<keyof StorageClient> = [
      "putObject",
      "getObject",
      "deleteObject",
      "deleteObjects",
      "headObject",
      "copyObject",
      "listObjectsV2",
      "listObjects",
      "listObjectVersions",
      "createBucket",
      "deleteBucket",
      "headBucket",
      "listBuckets",
      "getBucketAcl",
      "putBucketAcl",
      "putBucketCors",
      "putBucketPolicy",
      "putBucketTagging",
      "createMultipartUpload",
      "uploadPart",
      "uploadPartCopy",
      "completeMultipartUpload",
      "abortMultipartUpload",
      "listParts",
      "selectObjectContent",
      "waitUntilBucketExists",
      "waitUntilObjectExists",
      "paginateListObjectsV2",
      "destroy",
    ];

    for (const name of surface) {
      assertEquals(
        typeof client[name],
        "function",
        `StorageClient is missing method ${String(name)}`,
      );
    }

    // Sanity: the inherited prototype really does carry the SDK surface
    // (~115 methods at the time of writing). If this ever shrinks below 100
    // something has regressed in the SDK or the subclass.
    const proto = Object.getPrototypeOf(client);
    const inherited = Object.getPrototypeOf(proto);
    const inheritedMethods = Object.getOwnPropertyNames(inherited).filter(
      (n) => n !== "constructor" && typeof Reflect.get(inherited, n) === "function",
    );
    assert(
      inheritedMethods.length >= 100,
      `Expected StorageClient to inherit >= 100 SDK methods, got ${inheritedMethods.length}`,
    );

    client.destroy();
  });
});
