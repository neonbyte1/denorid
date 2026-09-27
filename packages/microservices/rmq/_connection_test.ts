import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import amqplib from "amqplib";
import { describe, it } from "node:test";
import { connectWithRetry } from "./_connection.ts";

describe(connectWithRetry.name, () => {
  const model = { fake: "model" };

  function failTimes(failures: number): () => Promise<never> {
    let calls = 0;

    return () => {
      calls++;

      return calls <= failures
        ? Promise.reject(new Error(`attempt ${calls} failed`))
        : Promise.resolve(model as never);
    };
  }

  it("connects to amqp://localhost unless a url is configured", async () => {
    using connect = stub(amqplib, "connect", failTimes(0));
    const url = { hostname: "broker", port: 5673 };

    await connectWithRetry({});
    await connectWithRetry({ url });

    assertEquals(connect.calls[0].args, ["amqp://localhost"]);
    assertStrictEquals(connect.calls[1].args[0], url);
  });

  it("makes a single attempt by default and for values below 1", async () => {
    for (const maxConnectionAttempts of [undefined, 0, -1, Number.NaN]) {
      using connect = stub(amqplib, "connect", failTimes(1));

      await assertRejects(
        () => connectWithRetry({ maxConnectionAttempts }),
        Error,
        "attempt 1 failed",
      );
      assertEquals(connect.calls.length, 1);
    }
  });

  it("waits retryDelay between attempts and resolves once one succeeds", async () => {
    using time = new FakeTime();
    using connect = stub(amqplib, "connect", failTimes(2));

    const connecting = connectWithRetry(
      { maxConnectionAttempts: 3, retryDelay: 500 },
      new AbortController().signal,
    );

    await time.tickAsync(499);
    assertEquals(connect.calls.length, 1);
    await time.tickAsync(1);
    assertEquals(connect.calls.length, 2);
    await time.tickAsync(500);
    assertEquals(connect.calls.length, 3);
    assertStrictEquals(await connecting, model as never);
  });

  it("waits 1000ms between attempts by default", async () => {
    using time = new FakeTime();
    using connect = stub(amqplib, "connect", failTimes(1));

    const connecting = connectWithRetry({ maxConnectionAttempts: 2 });

    await time.tickAsync(999);
    assertEquals(connect.calls.length, 1);
    await time.tickAsync(1);
    assertStrictEquals(await connecting, model as never);
  });

  it("rethrows the last error once every attempt failed", async () => {
    using connect = stub(amqplib, "connect", failTimes(Infinity));

    await assertRejects(
      () => connectWithRetry({ maxConnectionAttempts: 3, retryDelay: 0 }),
      Error,
      "attempt 3 failed",
    );
    assertEquals(connect.calls.length, 3);
  });

  it("stops retrying with the abort reason when the signal aborts during the delay", async () => {
    using time = new FakeTime();
    using connect = stub(amqplib, "connect", failTimes(Infinity));
    const controller = new AbortController();

    const connecting = connectWithRetry(
      { maxConnectionAttempts: 5, retryDelay: 1000 },
      controller.signal,
    );
    const outcome = connecting.catch((err: unknown) => err);

    await time.tickAsync(500);
    controller.abort(new Error("stopped"));

    assertEquals((await outcome as Error).message, "stopped");
    await time.tickAsync(5000);
    assertEquals(connect.calls.length, 1);
  });

  it("does not retry when the signal aborted during a failing attempt", async () => {
    const attempt = Promise.withResolvers<never>();
    using connect = stub(amqplib, "connect", () => attempt.promise);
    const controller = new AbortController();

    const connecting = connectWithRetry(
      { maxConnectionAttempts: 5, retryDelay: 60_000 },
      controller.signal,
    );

    controller.abort(new Error("stopped"));
    attempt.reject(new Error("refused"));

    await assertRejects(() => connecting, Error, "stopped");
    assertEquals(connect.calls.length, 1);
  });
});
