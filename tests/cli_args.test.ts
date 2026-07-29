// CLI argument hardening — the wrapper scripts previously ignored unrecognized flags,
// so a mistyped `--dryrun` was silently dropped and the injector ran for real. These
// tests pin the pure validators behind that fix (findUnknownArgs / isHelpRequested).
const cli = require("../scripts/lib/cli-args");

const KNOWN = { flags: ["--dry-run", "--verbose"], opts: ["--out", "--glob"] };

describe("cli-args — isHelpRequested", () => {
  test("detects -h and --help, nothing else", () => {
    expect(cli.isHelpRequested(["-h"])).toBe(true);
    expect(cli.isHelpRequested(["root", "--help"])).toBe(true);
    expect(cli.isHelpRequested(["root", "--dry-run"])).toBe(false);
    expect(cli.isHelpRequested([])).toBe(false);
  });
});

describe("cli-args — findUnknownArgs", () => {
  test("accepts a fully valid argv (root + flags + option values)", () => {
    const argv = ["/some/root", "--dry-run", "--out", "d", "--glob", "**/*.ts"];
    expect(cli.findUnknownArgs(argv, KNOWN)).toEqual([]);
  });

  test("flags a mistyped flag instead of ignoring it", () => {
    expect(cli.findUnknownArgs(["/root", "--dryrun"], KNOWN)).toEqual(["--dryrun"]);
    expect(cli.findUnknownArgs(["/root", "--out", "d", "--bogus"], KNOWN)).toEqual(["--bogus"]);
  });

  test("skips the value token of a known option (even if it looks like a flag)", () => {
    // `--out` consumes the next token as its value, so it is never mis-read as unknown.
    expect(cli.findUnknownArgs(["/root", "--out", "--weird-value"], KNOWN)).toEqual([]);
  });

  test("always accepts -h/--help and a bare -- separator", () => {
    expect(cli.findUnknownArgs(["/root", "--", "--dry-run"], KNOWN)).toEqual([]);
    expect(cli.findUnknownArgs(["/root", "-h"], KNOWN)).toEqual([]);
  });

  test("reports an unexpected extra positional argument", () => {
    expect(cli.findUnknownArgs(["/root", "extra-positional"], KNOWN)).toEqual(["extra-positional"]);
  });

  test("skips the positional root at argv[0]", () => {
    // argv[0] is the <root> dir and is never treated as an unknown argument.
    expect(cli.findUnknownArgs(["--looks-like-a-flag-but-is-root"], KNOWN)).toEqual([]);
  });
});
