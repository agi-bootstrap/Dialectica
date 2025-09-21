import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { getJson } from "serpapi";

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "../public");
const MODEL_NAME = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const MAX_TOKENS =
  Number.parseInt(process.env.OPENAI_MAX_TOKENS || "2000", 10) || 2000;
const TEMPERATURE =
  Number.parseFloat(process.env.OPENAI_TEMPERATURE || "0.7") || 0.7;
const DEFAULT_TURNS = Math.max(
  1,
  Number.parseInt(process.env.DIALECTICA_TURNS || "3", 10) || 3
);
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const SERPAPI_KEY = process.env.SERPAPI_KEY;

const MIME_TYPES = {
  ".html": "text/html; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".js": "application/javascript; charset=UTF-8",
  ".json": "application/json; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function createServer() {
  return http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && requestUrl.pathname === "/api/debate") {
      handleDebate(req, res, requestUrl).catch((error) => {
        console.error("Debate error:", error);
      });
      return;
    }

    serveStaticAsset(requestUrl, res);
  });
}

function serveStaticAsset(url, res) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      res.writeHead(500);
      res.end("Internal Server Error");
      return;
    }

    const ext = path.extname(safePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function formatTranscriptEntries(transcript) {
  if (transcript.length === 0) {
    return "No turns have been taken yet.";
  }

  return transcript
    .map((entry, index) => {
      const speaker = entry.role === "proponent" ? "Proponent" : "Critic";
      return `${index + 1}. ${speaker}: ${entry.argument}`;
    })
    .join("\n");
}

function formatSourceReferenceList(sourcesByNumber) {
  if (sourcesByNumber.size === 0) {
    return "No sources have been cited so far.";
  }

  const references = Array.from(sourcesByNumber.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([number, source]) => `[${number}] ${source.title} - ${source.url}`);

  return references.join("\n");
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchWeb(query, numResults = 5) {
  if (!SERPAPI_KEY) {
    console.warn("SERPAPI_KEY not found, using mock search results");
    return [
      {
        title: `Research on: ${query}`,
        url: `#mock-source-${Date.now()}`,
        snippet: `This is a mock search result for the query: ${query}. In a real implementation, this would be replaced with actual search results from SerpAPI.`,
      },
    ];
  }

  try {
    const response = await getJson({
      engine: "google",
      q: query,
      api_key: SERPAPI_KEY,
      num: numResults,
      safe: "active",
    });

    const results = [];
    if (response.organic_results) {
      for (const result of response.organic_results) {
        if (result.title && result.link) {
          results.push({
            title: result.title,
            url: result.link,
            snippet: result.snippet || "",
          });
        }
      }
    }

    return results;
  } catch (error) {
    console.error("Search error:", error);
    // Return mock results on error
    return [
      {
        title: `Search error for: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Search failed for query: ${query}. Error: ${error.message}`,
      },
    ];
  }
}

async function handleDebate(req, res, requestUrl) {
  const topic = (requestUrl.searchParams.get("topic") || "").trim();

  if (!topic) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "A topic is required to start a debate.",
      })
    );
    return;
  }

  if (topic.length > 280) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Topic is too long. Please keep it under 280 characters.",
      })
    );
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Missing OPENAI_API_KEY environment variable.",
      })
    );
    return;
  }

  // Set up Server-Sent Events
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  const transcript = [];
  const sourcesByNumber = new Map();
  const sourceNumberForUrl = new Map();
  let nextSourceNumber = 1;

  // Helper function to send SSE events
  function sendEvent(type, data) {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // Send initial status
    sendEvent("status", { message: "Starting debate..." });

    for (let turn = 1; turn <= DEFAULT_TURNS; turn += 1) {
      // Proponent turn
      sendEvent("status", { message: `Proponent preparing turn ${turn}...` });

      const proponentResult = await callAgent({
        apiKey,
        topic,
        role: "proponent",
        transcript,
        turn,
        totalTurns: DEFAULT_TURNS,
        sourcesByNumber,
        sourceNumberForUrl,
        nextSourceNumber,
      });
      nextSourceNumber = proponentResult.nextSourceNumber;

      const proponentEntry = {
        role: "proponent",
        argument: proponentResult.argument,
      };
      transcript.push(proponentEntry);

      // Send proponent turn immediately
      sendEvent("turn", {
        role: "proponent",
        turn: turn,
        argument: proponentResult.argument,
        sources: proponentResult.sources || [],
      });

      // Critic turn
      sendEvent("status", { message: `Critic preparing turn ${turn}...` });

      const criticResult = await callAgent({
        apiKey,
        topic,
        role: "critic",
        transcript,
        turn,
        totalTurns: DEFAULT_TURNS,
        sourcesByNumber,
        sourceNumberForUrl,
        nextSourceNumber,
      });
      nextSourceNumber = criticResult.nextSourceNumber;

      const criticEntry = {
        role: "critic",
        argument: criticResult.argument,
      };
      transcript.push(criticEntry);

      // Send critic turn immediately
      sendEvent("turn", {
        role: "critic",
        turn: turn,
        argument: criticResult.argument,
        sources: criticResult.sources || [],
      });
    }

    // Send evaluation status
    sendEvent("status", { message: "Judge evaluating debate..." });

    const evaluation = await callJudge({
      apiKey,
      topic,
      transcript,
      sourcesByNumber,
    });

    // Send final evaluation
    sendEvent("evaluation", {
      evaluation,
      sources: Array.from(sourcesByNumber.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([number, source]) => ({ number, ...source })),
    });

    // Send completion status
    sendEvent("status", { message: "Debate complete." });
    sendEvent("complete", {});
  } catch (error) {
    console.error("Debate orchestration failed:", error);
    sendEvent("error", {
      error: error.message || "An unexpected error occurred.",
    });
  } finally {
    res.end();
  }
}

function proponentSystemPrompt(topic) {
  return (
    `You are a world-class expert on "${topic}". ` +
    "Your objective is to argue passionately in favor of the topic. " +
    "Adopt an optimistic, constructive tone and build the strongest possible case grounded in verifiable evidence."
  );
}

function criticSystemPrompt(topic) {
  return (
    `You are a world-class critical thinker examining "${topic}". ` +
    "Your objective is to highlight flaws, risks, counterarguments, and trade-offs. " +
    "Adopt a skeptical, analytical tone while grounding every point in verifiable evidence."
  );
}

function buildAgentUserPrompt({
  topic,
  role,
  transcript,
  sourcesByNumber,
  turn,
  totalTurns,
  searchResults,
}) {
  const transcriptSummary = formatTranscriptEntries(transcript);
  const sourcesSummary = formatSourceReferenceList(sourcesByNumber);
  const roleDescription =
    role === "proponent" ? "supporting the idea" : "critiquing the idea";
  const turnDescriptor =
    turn === 1
      ? "opening statement"
      : turn === totalTurns
      ? "final turn"
      : "next turn";

  let searchContext = "";
  if (searchResults && searchResults.length > 0) {
    searchContext =
      `\nRecent search results for "${topic}":\n` +
      searchResults
        .map(
          (result, index) =>
            `[SR${index + 1}] ${result.title} - ${result.url}\n${
              result.snippet
            }`
        )
        .join("\n\n") +
      "\n\n";
  }

  return (
    `Debate topic: "${topic}"\n\n` +
    `Transcript so far (each entry already includes any citations):\n${transcriptSummary}\n\n` +
    `Available citation reference numbers and their sources:\n${sourcesSummary}\n\n` +
    searchContext +
    `You are ${roleDescription}. This is your ${turnDescriptor} (turn ${turn} of ${totalTurns}).\n` +
    "Requirements:\n" +
    "- Reference prior points as needed to maintain a coherent debate.\n" +
    "- Use the search results above and your knowledge to provide factual claims and evidence.\n" +
    "- Cite evidence inside your argument using markers like [S1], [S2], etc.\n" +
    '- Return ONLY valid JSON with exactly two properties: "argument" (string) and "sources" (array).\n' +
    '- The "sources" array must include one object per citation marker with "title" and "url" fields.\n' +
    '- If you reuse an existing source, include it again in the "sources" array with the same URL.\n' +
    '- Each citation marker in "argument" must correspond to an item in "sources" (1-indexed, e.g., [S1]).\n' +
    "- Keep the response under 250 words.\n" +
    "- Do not include any explanatory text outside of the JSON."
  );
}

function parseAgentResponse(rawText) {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("The model response did not include JSON output.");
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error("Failed to parse the model response JSON.");
  }
}

async function callAgent({
  apiKey,
  topic,
  role,
  transcript,
  turn,
  totalTurns,
  sourcesByNumber,
  sourceNumberForUrl,
  nextSourceNumber,
}) {
  // Perform web search for the topic
  const searchQuery = `${topic} ${
    role === "proponent" ? "benefits advantages" : "problems risks concerns"
  }`;
  const searchResults = await searchWeb(searchQuery, 3);

  const systemPrompt =
    role === "proponent"
      ? proponentSystemPrompt(topic)
      : criticSystemPrompt(topic);
  const userPrompt = buildAgentUserPrompt({
    topic,
    role,
    transcript,
    sourcesByNumber,
    turn,
    totalTurns,
    searchResults,
  });
  const rawResponse = await callOpenAI({
    apiKey,
    systemPrompt,
    userPrompt,
  });
  const parsed = parseAgentResponse(rawResponse);

  if (typeof parsed.argument !== "string" || !Array.isArray(parsed.sources)) {
    throw new Error("Agent response JSON is missing required fields.");
  }

  if (parsed.sources.length === 0) {
    throw new Error("Agent response must include at least one source.");
  }

  const messageSources = [];
  let updatedArgument = parsed.argument;

  parsed.sources.forEach((source, index) => {
    if (
      !source ||
      typeof source.title !== "string" ||
      typeof source.url !== "string"
    ) {
      throw new Error(
        'Each source must include both "title" and "url" fields.'
      );
    }
    const trimmedTitle = source.title.trim();
    const trimmedUrl = source.url.trim();
    if (!trimmedTitle || !trimmedUrl) {
      throw new Error("Source title and URL cannot be empty.");
    }

    const marker = `[S${index + 1}]`;
    const escapedMarker = escapeRegExp(marker);
    const markerRegex = new RegExp(escapedMarker, "g");
    // Only warn if marker is missing, don't throw error
    if (!markerRegex.test(parsed.argument)) {
      console.warn(
        `The marker ${marker} is missing from the argument. Continuing anyway.`
      );
    }

    let assignedNumber = sourceNumberForUrl.get(trimmedUrl);
    if (!assignedNumber) {
      assignedNumber = nextSourceNumber;
      sourceNumberForUrl.set(trimmedUrl, assignedNumber);
      sourcesByNumber.set(assignedNumber, {
        title: trimmedTitle,
        url: trimmedUrl,
      });
      nextSourceNumber += 1;
    }

    updatedArgument = updatedArgument.replace(
      new RegExp(escapedMarker, "g"),
      `[${assignedNumber}]`
    );
    messageSources.push({
      number: assignedNumber,
      title: trimmedTitle,
      url: trimmedUrl,
    });
  });

  // Check for unmatched markers but be more lenient
  const unmatchedMarkers = updatedArgument.match(/\[S\d+\]/g);
  if (unmatchedMarkers && unmatchedMarkers.length > 0) {
    console.warn(
      `Unmatched citation markers found: ${unmatchedMarkers.join(
        ", "
      )}. Continuing anyway.`
    );
    // Remove unmatched markers instead of throwing an error
    updatedArgument = updatedArgument.replace(/\[S\d+\]/g, "");
  }

  return {
    argument: updatedArgument.trim(),
    sources: messageSources,
    nextSourceNumber,
  };
}

async function callJudge({ apiKey, topic, transcript, sourcesByNumber }) {
  const transcriptSummary = formatTranscriptEntries(transcript);
  const sourcesSummary = formatSourceReferenceList(sourcesByNumber);

  // Perform a general search for the topic to provide context for the judge
  const searchResults = await searchWeb(topic, 2);
  let searchContext = "";
  if (searchResults && searchResults.length > 0) {
    searchContext =
      `\nAdditional context from recent search results:\n` +
      searchResults
        .map(
          (result, index) =>
            `[SR${index + 1}] ${result.title} - ${result.url}\n${
              result.snippet
            }`
        )
        .join("\n\n") +
      "\n\n";
  }

  const userPrompt =
    `You are an impartial and expert judge. The following is a debate transcript on "${topic}".\n\n` +
    `Debate transcript (with citations already embedded):\n${transcriptSummary}\n\n` +
    `Citation reference list:\n${sourcesSummary}\n\n` +
    searchContext +
    'Provide a structured evaluation containing three sections exactly: "Strongest Pro Argument", "Strongest Con Argument", and "Unresolved Trade-offs".\n' +
    "Each section should be 1-3 sentences.\n" +
    "Cite supporting evidence using the existing citation numbers in square brackets.\n" +
    'Return ONLY valid JSON with properties "strongestProArgument", "strongestConArgument", and "unresolvedTradeOffs".';

  const systemPrompt =
    "You are an impartial judge summarizing debates. Highlight the most compelling point from each side and any unresolved tensions.";

  const rawResponse = await callOpenAI({
    apiKey,
    systemPrompt,
    userPrompt,
  });
  const parsed = parseAgentResponse(rawResponse);

  if (
    typeof parsed.strongestProArgument !== "string" ||
    typeof parsed.strongestConArgument !== "string" ||
    typeof parsed.unresolvedTradeOffs !== "string"
  ) {
    throw new Error("Judge response JSON is missing required fields.");
  }

  return {
    strongestProArgument: parsed.strongestProArgument.trim(),
    strongestConArgument: parsed.strongestConArgument.trim(),
    unresolvedTradeOffs: parsed.unresolvedTradeOffs.trim(),
  };
}

async function callOpenAI({ apiKey, systemPrompt, userPrompt }) {
  const url = `${OPENAI_API_BASE}/chat/completions`;

  const messages = [];

  if (systemPrompt) {
    messages.push({
      role: "system",
      content: systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: userPrompt,
  });

  const body = {
    model: MODEL_NAME,
    messages: messages,
  };

  // Only add max_completion_tokens for models that support it well
  if (!MODEL_NAME.includes("nano")) {
    body.max_completion_tokens = MAX_TOKENS;
  }

  // Only add temperature if the model supports it
  // Some models like gpt-4o-mini, gpt-5-mini, and gpt-5-nano only support default temperature (1)
  if (!MODEL_NAME.includes("mini") && !MODEL_NAME.includes("nano")) {
    body.temperature = TEMPERATURE;
  }

  // Log model being used for debugging
  console.log(`Using OpenAI model: ${MODEL_NAME}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = `OpenAI API request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData && errorData.error && errorData.error.message) {
        errorMessage = `${errorMessage}: ${errorData.error.message}`;
      }
    } catch (parseError) {
      // Ignore JSON parse errors for error responses.
    }
    throw new Error(errorMessage);
  }

  const responseData = await response.json();

  if (
    !responseData.choices ||
    !responseData.choices[0] ||
    !responseData.choices[0].message
  ) {
    console.error(
      "OpenAI API response structure:",
      JSON.stringify(responseData, null, 2)
    );
    throw new Error("OpenAI API response did not contain expected structure.");
  }

  const content = responseData.choices[0].message.content;
  if (!content || !content.trim()) {
    console.error(
      "OpenAI API response content:",
      JSON.stringify(responseData, null, 2)
    );
    throw new Error("OpenAI API response did not contain text content.");
  }

  return content.trim();
}

const server = createServer();

server.listen(PORT, () => {
  console.log(`Dialectica server listening on http://localhost:${PORT}`);
});
