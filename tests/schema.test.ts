import { UNKNOWN, PRIMITIVE_TAXONOMY } from "../src/schema";
test("UNKNOWN constant", () => expect(UNKNOWN).toBe("Unknown"));
test("skill is callable", () => expect(PRIMITIVE_TAXONOMY.skill.callable).toBe(true));
test("skill mcp_primitive is tool", () => expect(PRIMITIVE_TAXONOMY.skill.mcpPrimitive).toBe("tool"));
test("doctrine is not callable", () => expect(PRIMITIVE_TAXONOMY.doctrine.callable).toBe(false));
test("test is not injectable", () => expect(PRIMITIVE_TAXONOMY.test.injectable).toBe(false));
