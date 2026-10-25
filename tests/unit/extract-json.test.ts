import { describe, expect, it } from "vitest";
import {
  dropTruncatedRewrite,
  extractJson,
  hasUnclosedObject,
  looksRepetitive,
  splitRewriteBlock,
} from "@/lib/extract-json";
import { validateReviewV1 } from "@/lib/review-schema";

describe("extractJson", () => {
  it("returns the first candidate that validates", () => {
    const text = 'noise {"summary":"s","issues":[]} trailing';
    expect(extractJson(text, validateReviewV1).summary).toBe("s");
  });

  it("reports the outer object's error, not a nested object's", () => {
    // Outer object has a bad severity; the nested object lacks `issues`.
    const text = JSON.stringify({
      summary: "outer",
      issues: [{ severity: "urgent", title: "t", explanation: "e" }],
      extra: { summary: "nested", recommendations: ["x"] },
    });
    expect(() => extractJson(text, validateReviewV1)).toThrow(/^issues\[0\]\.severity/);
  });

  it("accepts raw newlines inside strings", () => {
    // Literal newline/tab characters inside the JSON string value.
    const text = '{"summary":"s","issues":[],"rewrittenProcedure":"CREATE PROC x\nAS\n\tSELECT 1"}';
    expect(extractJson(text, validateReviewV1).rewrittenProcedure).toBe("CREATE PROC x\nAS\n\tSELECT 1");
  });

  it("reports the outer parse error over a nested object's schema error", () => {
    const text = '{"summary":"outer","issues":[{"title":"t"}],"rewrittenProcedure": CREATE PROC x}';
    expect(() => extractJson(text, validateReviewV1)).toThrow(/JSON/);
  });

  it("strips comments and trailing commas outside strings", () => {
    const text = `{
      "summary": "a // not a comment, }", // trailing note
      /* block */ "issues": [],
    }`;
    expect(extractJson(text, validateReviewV1).summary).toBe("a // not a comment, }");
  });

  it("recovers when a string value is never closed", () => {
    // Mirrors a real small-model answer: rewrittenProcedure lacks its closing quote.
    const text = `{
  "summary": "s",
  "issues": [{ "severity": "high", "title": "t", "explanation": "e" }],
  "rewrittenProcedure": "CREATE PROCEDURE dbo.p
AS EXEC sp_executesql '
    SELECT 1';
}`;
    const result = extractJson(text, validateReviewV1);
    expect(result.summary).toBe("s");
    expect(result.issues).toHaveLength(1);
    expect(result.rewrittenProcedure).toBe("CREATE PROCEDURE dbo.p\nAS EXEC sp_executesql '\n    SELECT 1';");
  });

  it("closes only a final open string when the model finished on its own", () => {
    const stopped = '{"summary": "s", "issues": [], "rewrittenProcedure": "SELECT 1;';
    expect(() => extractJson(stopped, validateReviewV1)).toThrow();
    expect(extractJson(stopped, validateReviewV1, { finished: true }).rewrittenProcedure).toBe("SELECT 1;");
    // An open list means the review itself is incomplete: never recovered.
    expect(() =>
      extractJson('{"summary": "s", "issues": [{"severity": "low", "title": "t", "explanation": "e"}', validateReviewV1, {
        finished: true,
      }),
    ).toThrow();
  });

  it("never auto-closes a cut-off answer", () => {
    const text = '{"summary": "s", "issues": [{"severity": "low", "title": "t", "explanation": "e"},';
    expect(() => extractJson(text, validateReviewV1)).toThrow();
    expect(() => extractJson('{"summary": "s", "issues": [', validateReviewV1)).toThrow();
  });

  it("repairs invalid escapes: line continuations and unknown escapes", () => {
    // `"\` + newline, `;\    \` + newline, and `\d` as written by a small model.
    const text = '{"summary": "a\\d", "issues": [], "rewrittenProcedure": "\\\n  SET NOCOUNT ON;\\    \\\n  SELECT 1;"}';
    const result = extractJson(text, validateReviewV1);
    expect(result.summary).toBe("a\\d");
    expect(result.rewrittenProcedure).toBe("\n  SET NOCOUNT ON;    \n  SELECT 1;");
  });

  it("inserts missing commas between array items and objects", () => {
    const text = '{"summary": "s", "issues": [{"severity": "low", "title": "a", "explanation": "e"}\n{"severity": "low", "title": "b", "explanation": "e"}], "rewriteNotes": ["one"\n"two" "three"]}';
    const result = extractJson(text, validateReviewV1);
    expect(result.issues.map((i) => i.title)).toEqual(["a", "b"]);
    expect(result.rewriteNotes).toEqual(["one", "two", "three"]);
  });

  it("splits the plain-SQL rewrite block from the JSON", () => {
    const sql = "CREATE PROCEDURE dbo.p AS\nSELECT 'a \"quoted\" \\ value';";
    expect(splitRewriteBlock(`{"summary": "s"}\n<rewritten_procedure>\n\`\`\`sql\n${sql}\n\`\`\`\n</rewritten_procedure>`)).toEqual({
      json: '{"summary": "s"}\n',
      rewrite: sql,
      closed: true,
    });
    expect(splitRewriteBlock('{"summary": "s"}<rewritten_procedure>\nCREATE PROC p AS SEL')).toMatchObject({ rewrite: "CREATE PROC p AS SEL", closed: false });
    // A tag inside an unfinished JSON string is not a block.
    expect(splitRewriteBlock('{"summary": "<rewritten_procedure> x').rewrite).toBeNull();
    expect(splitRewriteBlock('{"summary": "s"}').rewrite).toBeNull();
  });

  it("drops only a cut-off final rewrite", () => {
    expect(dropTruncatedRewrite('{"summary": "s", "issues": [], "rewrittenProcedure": "CREATE PROC p\nAS SEL')).toBe(
      '{"summary": "s", "issues": [], "rewrittenProcedure": ""}',
    );
    // Closed rewrite, or something else still open before it: not this case.
    expect(dropTruncatedRewrite('{"summary": "s", "rewrittenProcedure": "x", "extra": "cut')).toBeNull();
    expect(dropTruncatedRewrite('{"issues": [{"title": "t", "rewrittenProcedure": "x')).toBeNull();
  });

  it("detects looping output", () => {
    const loop = '{"summary": "s", "issues": [' + '{"title": "Use sp_executesql for safety"},\n'.repeat(8);
    expect(looksRepetitive(loop)).toBe(true);
    const sql = ["CREATE PROCEDURE dbo.p AS", "BEGIN TRY", "  SELECT a FROM t;", "END TRY", "BEGIN CATCH", "  THROW;", "END CATCH"].join("\n");
    expect(looksRepetitive(`{"rewrittenProcedure": "${sql}`)).toBe(false);
  });

  it("detects an unclosed outer object", () => {
    expect(hasUnclosedObject('{"summary": "s", "issues": [')).toBe(true);
    expect(hasUnclosedObject('{"summary": "}"} and some prose after')).toBe(false);
    expect(hasUnclosedObject("no json here")).toBe(false);
  });

  it("reports a parse error when nothing parses", () => {
    expect(() => extractJson('{"summary": "unterminated', validateReviewV1)).toThrow(
      /No complete JSON object found/,
    );
    expect(() => extractJson("{'a': 1}", validateReviewV1)).toThrow(/JSON/);
  });
});
