import crypto from "crypto";
import fs from "fs";
import path from "path";

type Endpoint = "health" | "events" | "transactions";

type HarnessConfig = {
  baseUrl: string;
  endpoint: Endpoint | "all";
  secret: string;
  userId?: string;
  userEmail?: string;
  traceId: string;
  sourceAgent: string;
  eventType: string;
  status: string;
  amount: number;
  description: string;
  currency: string;
};

type HarnessResponse = {
  endpoint: Endpoint;
  status: number;
  body: unknown;
};

const DEFAULT_BASE_URL = "http://localhost:3200";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function loadLocalEnv() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.log(`Usage:
  npm run agent:harness -- --endpoint=all --user-id=<user_id>
  npm run agent:harness -- --endpoint=events --user-email=<email>
  npm run agent:harness -- --endpoint=transactions --user-email=<email> --amount=12.34

Options:
  --endpoint       health | events | transactions | all (default: all)
  --base-url       Target app URL (default: ${DEFAULT_BASE_URL})
  --secret         Shared integration secret (default: INTEGRATION_SHARED_SECRET)
  --user-id        User id for the request (default: AGENT_HARNESS_USER_ID)
  --user-email     User email for events/transactions (default: AGENT_HARNESS_USER_EMAIL)
  --trace-id       Trace id for this run (default: generated)
  --source-agent   Event source agent (default: local-agent-harness)
  --event-type     Event type for events endpoint (default: harness.ping)
  --status         Event status (default: received)
  --amount         Transaction amount; positive is out, negative is in (default: 12.34)
  --description    Transaction description (default: Agent harness transaction)
  --currency       Transaction currency (default: CAD)
  --help           Show this help
`);
  process.exit(0);
}

function readConfig(): HarnessConfig {
  loadLocalEnv();

  if (hasFlag("help")) usage();

  const endpoint = (readArg("endpoint") ?? process.env.AGENT_HARNESS_ENDPOINT ?? "all") as HarnessConfig["endpoint"];
  if (!["health", "events", "transactions", "all"].includes(endpoint)) {
    throw new Error(`Invalid --endpoint "${endpoint}". Use health, events, transactions, or all.`);
  }

  const secret = readArg("secret") ?? process.env.INTEGRATION_SHARED_SECRET;
  if (!secret?.trim()) {
    throw new Error("Missing integration secret. Set INTEGRATION_SHARED_SECRET or pass --secret.");
  }

  const amountRaw = readArg("amount") ?? process.env.AGENT_HARNESS_AMOUNT ?? "12.34";
  const amount = Number.parseFloat(amountRaw);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid --amount "${amountRaw}".`);
  }

  const traceId = readArg("trace-id") ?? process.env.AGENT_HARNESS_TRACE_ID ?? `agent-harness-${Date.now()}`;

  return {
    baseUrl: readArg("base-url") ?? process.env.AGENT_HARNESS_BASE_URL ?? DEFAULT_BASE_URL,
    endpoint,
    secret,
    userId: readArg("user-id") ?? process.env.AGENT_HARNESS_USER_ID,
    userEmail: readArg("user-email") ?? process.env.AGENT_HARNESS_USER_EMAIL,
    traceId,
    sourceAgent: readArg("source-agent") ?? process.env.AGENT_HARNESS_SOURCE_AGENT ?? "local-agent-harness",
    eventType: readArg("event-type") ?? process.env.AGENT_HARNESS_EVENT_TYPE ?? "harness.ping",
    status: readArg("status") ?? process.env.AGENT_HARNESS_STATUS ?? "received",
    amount,
    description:
      readArg("description") ?? process.env.AGENT_HARNESS_DESCRIPTION ?? "Agent harness transaction",
    currency: readArg("currency") ?? process.env.AGENT_HARNESS_CURRENCY ?? "CAD",
  };
}

function requireUserIdentifier(config: HarnessConfig, endpoint: Endpoint) {
  if (endpoint === "health" && !config.userId?.trim()) {
    throw new Error("The health endpoint requires --user-id or AGENT_HARNESS_USER_ID.");
  }

  if (endpoint !== "health" && !config.userId?.trim() && !config.userEmail?.trim()) {
    throw new Error(`${endpoint} requires --user-id/AGENT_HARNESS_USER_ID or --user-email/AGENT_HARNESS_USER_EMAIL.`);
  }
}

function buildPayload(config: HarnessConfig, endpoint: Endpoint) {
  if (endpoint === "health") {
    return {
      trace_id: config.traceId,
      user_id: config.userId,
    };
  }

  if (endpoint === "events") {
    return {
      event_type: config.eventType,
      source_agent: config.sourceAgent,
      user_id: config.userId,
      user_email: config.userEmail,
      trace_id: config.traceId,
      status: config.status,
      payload: {
        harness: true,
        run_at: new Date().toISOString(),
      },
    };
  }

  return {
    user_id: config.userId,
    user_email: config.userEmail,
    trace_id: config.traceId,
    description: config.description,
    amount: config.amount,
    currency: config.currency,
    metadata: {
      source: "agent_harness",
      harness: true,
    },
  };
}

function signBody(secret: string, rawBody: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");

  return { timestamp, nonce, signature };
}

async function postSigned(config: HarnessConfig, endpoint: Endpoint): Promise<HarnessResponse> {
  requireUserIdentifier(config, endpoint);

  const payload = buildPayload(config, endpoint);
  const rawBody = JSON.stringify(payload);
  const { timestamp, nonce, signature } = signBody(config.secret, rawBody);
  const idempotencyKey = `${config.traceId}:${endpoint}:${crypto.randomUUID()}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.secret}`,
    "x-agent-timestamp": timestamp,
    "x-agent-nonce": nonce,
    "x-agent-signature": signature,
  };

  if (config.userId) headers["x-agent-user-id"] = config.userId;
  if (endpoint !== "health") headers["x-idempotency-key"] = idempotencyKey;

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/integrations/agent/${endpoint}`, {
    method: "POST",
    headers,
    body: rawBody,
  });

  const responseText = await response.text();
  const body = (() => {
    try {
      return responseText ? JSON.parse(responseText) : null;
    } catch {
      return responseText;
    }
  })();

  return {
    endpoint,
    status: response.status,
    body,
  };
}

async function main() {
  const config = readConfig();
  const endpoints: Endpoint[] =
    config.endpoint === "all" ? ["health", "events", "transactions"] : [config.endpoint];

  console.log(`Agent harness target: ${config.baseUrl}`);
  console.log(`Trace id: ${config.traceId}`);

  for (const endpoint of endpoints) {
    const result = await postSigned(config, endpoint);
    console.log(`\n[${result.endpoint}] HTTP ${result.status}`);
    console.log(JSON.stringify(result.body, null, 2));

    if (result.status >= 400) {
      process.exitCode = 1;
      break;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
