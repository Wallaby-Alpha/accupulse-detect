import { getWeexSupportedSymbols, normalizeSymbol } from "../src/lib/weex/symbols.server";

async function testSymbolMappingAndGate() {
  console.log("=== Testing WEEX Symbol Mapping & Availability Gate ===");

  const symbols = await getWeexSupportedSymbols();
  console.log(`Fetched ${symbols.size} supported symbol variants from WEEX.`);

  const testCases = [
    { input: "TRUMPUSDT", expected: "TRUMPUSDT" },
    { input: "#TRUMPUSDT", expected: "TRUMPUSDT" },
    { input: "GOLD(PAXG)USDT", expected: "PAXGUSDT" },
    { input: "PAXGUSDT", expected: "PAXGUSDT" },
    { input: "BELDEXUSDT", expected: "BDXUSDT" },
    { input: "NONEXISTENTCOIN123USDT", expected: "NONEXISTENTCOIN123USDT" },
  ];

  for (const { input, expected } of testCases) {
    const normalized = normalizeSymbol(input);
    const supported = symbols.has(normalized);
    console.log(
      `Input: '${input}' -> Normalized: '${normalized}' | Supported on WEEX: ${supported}`,
    );
  }
}

testSymbolMappingAndGate();
