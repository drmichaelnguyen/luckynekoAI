import {
  decidePlanSuggestion,
} from "../src/lib/finance/plan-suggestion";
import {
  extractSearchTerms,
  looksLikeCompletedPurchase,
  looksLikeDeclarativePurchase,
  parseLedgerQuery,
} from "../src/lib/finance/ledger-query";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

export function runLedgerQueryChecks(): void {
  assert(looksLikeCompletedPurchase("I bought an 85mm 1.8 Nikkor lens for 220"), "bought is a completed purchase");
  assert(looksLikeCompletedPurchase("Đã mua ống kính 85mm"), "Vietnamese đã mua is a completed purchase");
  assert(looksLikeCompletedPurchase("vừa mua cà phê"), "vua mua is a completed purchase");
  assert(!looksLikeCompletedPurchase("I want to buy an 85mm lens for 220"), "want to buy is not completed");
  assert(!looksLikeCompletedPurchase("85mm 1.8 Nikkor G Afs 220"), "bare item and price is not completed");
  assert(!looksLikeCompletedPurchase("định mua lens"), "dinh mua is intent, not completed");

  assert(
    looksLikeDeclarativePurchase("I bought an 85mm 1.8 Nikkor lens for 220"),
    "declarative purchase stays true",
  );
  assert(
    !looksLikeDeclarativePurchase("do we have data about i bought a nikon lens 85mm"),
    "lookup containing i bought is not a declarative purchase",
  );
  assert(!looksLikeDeclarativePurchase("did i buy coffee"), "did i is a lookup");
  assert(!looksLikeDeclarativePurchase("is there a nikon lens"), "is there is a lookup");

  const lookup = parseLedgerQuery("do we have data about i bought a nikon lens 85mm");
  assert(lookup !== null, "lookup runs ledger search");
  assert(lookup?.terms.includes("85mm"), "lookup keeps 85mm");
  assert(lookup?.terms.includes("nikon"), "lookup keeps nikon");
  assert(lookup?.terms.includes("lens"), "lookup keeps lens");
  assert(!lookup?.terms.includes("bought"), "bought is not a required search term");

  assert(parseLedgerQuery("I bought an 85mm 1.8 Nikkor lens for 220") === null, "a purchase is not a search");

  const terms = extractSearchTerms("i bought a nikon lens 85mm");
  assert(terms.includes("nikon") && terms.includes("lens") && terms.includes("85mm"), "search terms keep the item");
  assert(!terms.includes("bought") && !terms.includes("buy"), "purchase verbs are ignored");

  const bought = decidePlanSuggestion("I bought an 85mm 1.8 Nikkor lens for 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    description: "Camera lens",
    amountCents: 22000,
    currency: "CAD",
  });
  assert(bought.kind === "transaction_draft", "completed purchase becomes a transaction draft");
  if (bought.kind === "transaction_draft") {
    assert(bought.amountCents === 22000, "draft keeps the amount");
    assert(bought.merchant === "85mm 1.8 Nikkor G Afs lens", "leading Buy is removed");
    assert(bought.confirmReason.includes("bought this"), "draft explains why it is not a plan");
  }

  const intent = decidePlanSuggestion("I want to buy an 85mm lens for 220", {
    title: "Buy 85mm lens",
    amountCents: 22000,
  });
  assert(intent.kind === "create_plan", "explicit intent creates a plan");

  const bare = decidePlanSuggestion("85mm 1.8 Nikkor G Afs 220", {
    title: "Buy 85mm 1.8 Nikkor G Afs lens",
    amountCents: 22000,
  });
  assert(bare.kind === "ask_intent", "bare item asks instead of saving a plan");
  if (bare.kind === "ask_intent") {
    assert(
      bare.followUpQuestion.toLowerCase().includes("already buy") &&
        bare.followUpQuestion.toLowerCase().includes("planning"),
      "follow-up asks already bought or planning",
    );
  }

  const noPrice = decidePlanSuggestion("I bought a lens", { title: "Buy a lens" });
  assert(noPrice.kind === "ask_price", "completed purchase without a price asks for one");

  console.log("ledger query checks passed");
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("debug-ledger-query.ts")) {
  runLedgerQueryChecks();
}
