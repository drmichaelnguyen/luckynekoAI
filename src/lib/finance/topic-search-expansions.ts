/**
 * Maps abstract spend topics to merchant / memo keywords that typically appear
 * on ledger rows. Used when the user asks about a theme ("photography") rather
 * than a literal store name ("Nikon").
 */

export type TopicExpansionResult = {
  /** Terms to search (original + synonyms). */
  terms: string[];
  /** Original topic tokens for scope labels (e.g. "photography"). */
  topicTerms: string[];
  /** True when synonyms were added beyond the user's words. */
  expanded: boolean;
};

type TopicRule = {
  /** User tokens that trigger this topic. */
  triggers: string[];
  /** Merchant / memo / brand keywords that should match. */
  keywords: string[];
};

const TOPIC_RULES: TopicRule[] = [
  {
    triggers: ["photography", "photograph", "photographer", "photographers", "photo", "photos"],
    keywords: [
      "photography",
      "photograph",
      "photographer",
      "photo",
      "photos",
      "camera",
      "cameras",
      "lens",
      "lenses",
      "nikkor",
      "nikon",
      "canon",
      "sony",
      "fujifilm",
      "fuji",
      "leica",
      "panasonic",
      "olympus",
      "sigma",
      "tamron",
      "gopro",
      "insta360",
      "adobe",
      "lightroom",
      "photoshop",
      "capture one",
      "adorama",
      "bhphoto",
      "keh",
      "mpb",
      "tripod",
      "studio",
      "portrait",
      "dslr",
      "mirrorless",
      "flash",
      "strobe",
      "godox",
      "profoto",
    ],
  },
  {
    triggers: ["coffee", "cafe", "caffeine"],
    keywords: [
      "coffee",
      "cafe",
      "café",
      "starbucks",
      "tim hortons",
      "timhortons",
      "second cup",
      "espresso",
      "latte",
      "cappuccino",
    ],
  },
  {
    triggers: ["gas", "fuel", "petrol", "gasoline"],
    keywords: [
      "gas",
      "fuel",
      "petrol",
      "gasoline",
      "shell",
      "esso",
      "petro",
      "chevron",
      "husky",
      "pioneer",
      "ultramar",
    ],
  },
  {
    triggers: ["gym", "fitness", "workout"],
    keywords: [
      "gym",
      "fitness",
      "workout",
      "goodlife",
      "planet fitness",
      "yoga",
      "crossfit",
      "membership",
    ],
  },
  {
    triggers: ["streaming", "subscriptions", "subscription"],
    keywords: [
      "streaming",
      "subscription",
      "subscriptions",
      "netflix",
      "spotify",
      "disney",
      "youtube",
      "apple music",
      "amazon prime",
      "crave",
    ],
  },
  {
    triggers: ["rideshare", "ridesharing"],
    keywords: ["rideshare", "uber", "lyft", "grab", "taxi", "cab"],
  },
];

function normalizeToken(value: string): string {
  // Match ledger-query haystack normalization so keywords like "b&h" become "b h".
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expand abstract topic tokens into merchant/memo search keywords.
 * Unmatched terms pass through unchanged.
 */
export function expandTopicSearchTerms(searchTerms: string[]): TopicExpansionResult {
  if (searchTerms.length === 0) {
    return { terms: [], topicTerms: [], expanded: false };
  }

  const normalizedTerms = searchTerms
    .map((term) => normalizeToken(term))
    .filter((term) => term.length >= 2);
  const termSet = new Set(normalizedTerms);
  const out = new Set<string>(normalizedTerms);
  const topicTerms: string[] = [];
  let expanded = false;

  for (const rule of TOPIC_RULES) {
    const matchedTriggers = rule.triggers.filter((trigger) => termSet.has(normalizeToken(trigger)));
    if (matchedTriggers.length === 0) continue;

    for (const trigger of matchedTriggers) {
      if (!topicTerms.includes(trigger)) topicTerms.push(trigger);
    }
    for (const keyword of rule.keywords) {
      const normalized = normalizeToken(keyword);
      if (!normalized || normalized.length < 2) continue;
      if (!out.has(normalized)) {
        out.add(normalized);
        expanded = true;
      }
    }
  }

  return {
    terms: [...out],
    topicTerms: topicTerms.length > 0 ? topicTerms : normalizedTerms.slice(0, 3),
    expanded,
  };
}

/** Merge LLM / extra keywords onto an already-parsed term list (OR match). */
export function mergeSearchKeywords(baseTerms: string[], extraKeywords: string[]): string[] {
  const out = new Set(
    baseTerms.map((term) => normalizeToken(term)).filter((term) => term.length >= 2),
  );
  for (const keyword of extraKeywords) {
    const normalized = normalizeToken(keyword);
    if (normalized.length >= 2) out.add(normalized);
  }
  return [...out];
}
