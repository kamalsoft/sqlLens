import { describe, expect, it } from "vitest";
import { MAX_HIGHLIGHT_CHARS, MAX_XML_SQL_CHARS, detectLanguage, highlightSegments } from "@/lib/code-highlight";

const classOf = (code: string, lang: Parameters<typeof highlightSegments>[1], text: string) =>
  highlightSegments(code, lang)?.find((s) => s.text === text)?.cls;
const joined = (code: string, lang: Parameters<typeof highlightSegments>[1]) =>
  highlightSegments(code, lang)!.map((s) => s.text).join("");

describe("code highlighting (HL-2)", () => {
  it("highlights JSON keys, strings, numbers and literals, keeping the text unchanged", () => {
    const json = '{\n  "summary": "ok",\n  "confidence": 0.8,\n  "lowConfidence": false,\n  "detail": null\n}';
    expect(classOf(json, "json", '"summary"')).toBe("tok-property");
    expect(classOf(json, "json", '"ok"')).toBe("tok-string");
    expect(classOf(json, "json", "0.8")).toBe("tok-number");
    expect(classOf(json, "json", "false")).toBe("tok-number");
    expect(classOf(json, "json", "null")).toBe("tok-number");
    expect(joined(json, "json")).toBe(json);
  });

  it("highlights XML tags, attributes, values and comments (execution plans)", () => {
    const xml = '<ShowPlanXML Version="1.6"><!-- plan --><RelOp PhysicalOp="Index Seek"/></ShowPlanXML>';
    expect(classOf(xml, "xml", "ShowPlanXML")).toBe("tok-tag");
    expect(classOf(xml, "xml", "PhysicalOp")).toBe("tok-attr");
    expect(classOf(xml, "xml", '"Index Seek"')).toBe("tok-string");
    expect(highlightSegments(xml, "xml")!.some((s) => s.cls === "tok-comment")).toBe(true);
    expect(joined(xml, "xml")).toBe(xml);
  });

  it("highlights T-SQL keywords, strings and variables", () => {
    const sql = "CREATE NONCLUSTERED INDEX IX ON dbo.T (Id) WHERE Name = 'x' AND Id = @Id;";
    expect(classOf(sql, "sql", "CREATE")).toBe("tok-keyword");
    expect(classOf(sql, "sql", "'x'")).toBe("tok-string");
    expect(classOf(sql, "sql", "@Id")).toBe("tok-variable");
  });

  it("auto detects JSON and XML; other text, and very large text, stays plain", () => {
    expect(detectLanguage('  {"a":1}')).toBe("json");
    expect(detectLanguage("[1,2]")).toBe("json");
    expect(detectLanguage("<a/>")).toBe("xml");
    expect(detectLanguage("Table 'Orders'. Scan count 1")).toBeNull();
    expect(detectLanguage('{\n  "summary": "cut off')).toBeNull();
    expect(detectLanguage('<?xml version="1.0"?><a/>')).toBe("xml");
    // Look-alikes stay plain (architect review, finding 1).
    expect(detectLanguage("[dbo].[GetOrders] failed: timeout")).toBeNull();
    expect(detectLanguage("<no rows>")).toBeNull();
    expect(detectLanguage("{ not json at all }")).toBeNull();
    expect(highlightSegments("[dbo].[GetOrders] failed", "auto")).toBeNull();
    expect(highlightSegments("Table 'Orders'. Scan count 1", "auto")).toBeNull();
    expect(highlightSegments("{" + " ".repeat(MAX_HIGHLIGHT_CHARS) + "}", "json")).toBeNull();
    expect(highlightSegments("", "json")).toBeNull();
  });
});

describe("crafted input cannot crash or freeze the page (security review)", () => {
  const timed = (code: string, lang: Parameters<typeof highlightSegments>[1]) => {
    const start = performance.now();
    const out = highlightSegments(code, lang);
    return { out, ms: performance.now() - start };
  };
  it.each([
    ["deep JSON nesting", "[".repeat(30_000), "json"],
    ["deep valid JSON nesting", "[".repeat(5_000) + "]".repeat(5_000), "json"],
    ["malformed JSON with escapes", "{" + '"\\'.repeat(99_000), "json"],
    ["deep XML nesting", "<a>".repeat(16_000), "xml"],
    ["unclosed XML attributes", '<a b="'.repeat(8_000), "xml"],
    ["XML garbage", "<" + "</<!--<![CDATA[".repeat(3_000), "xml"],
    ["deep SQL brackets", "(".repeat(40_000), "sql"],
    ["auto: deep XML", "<a>".repeat(16_000) + "</a>", "auto"],
  ] as const)("%s: no exception, under 2 s", (_name, code, lang) => {
    const { ms } = timed(code, lang);
    expect(ms).toBeLessThan(2000);
  });
  it("XML and SQL above their lower limit stay plain", () => {
    expect(highlightSegments("<a>" + "x".repeat(MAX_XML_SQL_CHARS) + "</a>", "xml")).toBeNull();
    expect(highlightSegments("SELECT " + "1,".repeat(MAX_XML_SQL_CHARS), "sql")).toBeNull();
  });
});
