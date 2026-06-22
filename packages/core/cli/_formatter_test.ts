import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { OutputFormatter, shouldDecorate } from "./_formatter.ts";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED_BG_WHITE_FG = "\x1b[37;41m";

describe("OutputFormatter", () => {
  describe("when undecorated", () => {
    it("strips known tags and emits plain text", () => {
      const formatter = new OutputFormatter(false);

      assertEquals(
        formatter.format("<info>hello</info> world"),
        "hello world",
      );
    });

    it("strips nested tags", () => {
      const formatter = new OutputFormatter(false);

      assertEquals(
        formatter.format("<info>a <comment>b</comment> c</info>"),
        "a b c",
      );
    });

    it("passes unknown tags through unchanged", () => {
      const formatter = new OutputFormatter(false);

      assertEquals(
        formatter.format("<unknown>hi</unknown>"),
        "<unknown>hi</unknown>",
      );
    });

    it("returns plain text from apply() regardless of style", () => {
      const formatter = new OutputFormatter(false);

      assertEquals(formatter.apply("hello", "info"), "hello");
    });
  });

  describe("when decorated", () => {
    it("wraps a known tag in the corresponding ANSI sequence", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(
        formatter.format("<info>hello</info>"),
        `${GREEN}hello${RESET}`,
      );
    });

    it("merges fg + bg into a single SGR for compound styles", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(
        formatter.format("<error>boom</error>"),
        `${RED_BG_WHITE_FG}boom${RESET}`,
      );
    });

    it("renders each nested segment with the inner style overriding the outer", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(
        formatter.format("<info>a <comment>b</comment> c</info>"),
        `${GREEN}a ${RESET}${YELLOW}b${RESET}${GREEN} c${RESET}`,
      );
    });

    it("emits literal text outside any tag without escapes", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(
        formatter.format("prefix <info>x</info> suffix"),
        `prefix ${GREEN}x${RESET} suffix`,
      );
    });

    it("treats an unmatched closing tag as a literal", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(
        formatter.format("hello </info> world"),
        "hello </info> world",
      );
    });

    it("treats an unknown opening tag as a literal", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(
        formatter.format("<bogus>x</bogus>"),
        "<bogus>x</bogus>",
      );
    });

    it("apply() wraps a string with the named style", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(formatter.apply("ok", "info"), `${GREEN}ok${RESET}`);
    });

    it("apply() returns text unchanged when the style is unknown", () => {
      const formatter = new OutputFormatter(true);

      assertEquals(formatter.apply("ok", "bogus"), "ok");
    });

    it("setStyle() registers a custom palette entry usable by both format() and apply()", () => {
      const formatter = new OutputFormatter(true);
      formatter.setStyle("highlight", { fg: "blue", effects: ["bold"] });

      assertEquals(
        formatter.format("<highlight>X</highlight>"),
        "\x1b[34;1mX\x1b[0m",
      );
      assertEquals(formatter.apply("X", "highlight"), "\x1b[34;1mX\x1b[0m");
    });

    it("emits text unchanged when the named style carries no fg/bg/effects", () => {
      const formatter = new OutputFormatter(true);
      formatter.setStyle("noop", {});

      assertEquals(formatter.format("<noop>plain</noop>"), "plain");
      assertEquals(formatter.apply("plain", "noop"), "plain");
    });

    it("toggling `decorated` after construction strips escapes from subsequent calls", () => {
      const formatter = new OutputFormatter(true);
      formatter.decorated = false;

      assertEquals(formatter.format("<info>x</info>"), "x");
    });
  });

  describe("regex state safety", () => {
    it("repeated format() calls do not interfere because lastIndex is reset", () => {
      const formatter = new OutputFormatter(true);
      const out1 = formatter.format("<info>a</info>");
      const out2 = formatter.format("<info>b</info>");

      assertEquals(out1, `${GREEN}a${RESET}`);
      assertEquals(out2, `${GREEN}b${RESET}`);
    });
  });
});

describe("shouldDecorate()", () => {
  const previous = Deno.env.get("NO_COLOR");

  beforeEach(() => {
    Deno.env.delete("NO_COLOR");
  });

  afterEach(() => {
    if (previous === undefined) {
      Deno.env.delete("NO_COLOR");
    } else {
      Deno.env.set("NO_COLOR", previous);
    }
  });

  it("returns false when NO_COLOR is set (regardless of value)", () => {
    Deno.env.set("NO_COLOR", "1");
    assertEquals(shouldDecorate(), false);
  });

  it("returns false when NO_COLOR is set to empty string", () => {
    Deno.env.set("NO_COLOR", "");
    assertEquals(shouldDecorate(), false);
  });

  it("delegates to Deno.stdout.isTerminal() when NO_COLOR is unset", () => {
    using _terminal = stub(Deno.stdout, "isTerminal", () => true);

    assertEquals(shouldDecorate(), true);
  });

  it("returns false when NO_COLOR is unset and stdout is not a TTY", () => {
    using _terminal = stub(Deno.stdout, "isTerminal", () => false);

    assertEquals(shouldDecorate(), false);
  });

  it("returns false when Deno.stdout.isTerminal() throws", () => {
    using _terminal = stub(Deno.stdout, "isTerminal", () => {
      throw new Error("not a tty");
    });

    assertEquals(shouldDecorate(), false);
  });
});
