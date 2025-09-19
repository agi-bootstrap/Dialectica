import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const MODEL_NAME = 'models/gemini-2.5-flash-preview-05-20';
const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TURNS = Math.max(1, Number.parseInt(process.env.DIALECTICA_TURNS || '3', 10) || 3);
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function createServer() {
  return http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && requestUrl.pathname === '/api/debate/stream') {
      handleDebateStream(req, res, requestUrl).catch((error) => {
        console.error('Debate stream error:', error);
      });
      return;
    }

    serveStaticAsset(requestUrl, res);
  });
}

function serveStaticAsset(url, res) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }

    const ext = path.extname(safePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function formatTranscriptEntries(transcript) {
  if (transcript.length === 0) {
    return 'No turns have been taken yet.';
  }

  return transcript
    .map((entry, index) => {
      const speaker = entry.role === 'proponent' ? 'Proponent' : 'Critic';
      return `${index + 1}. ${speaker}: ${entry.argument}`;
    })
    .join('\n');
}

function formatSourceReferenceList(sourcesByNumber) {
  if (sourcesByNumber.size === 0) {
    return 'No sources have been cited so far.';
  }

  const references = Array.from(sourcesByNumber.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([number, source]) => `[${number}] ${source.title} - ${source.url}`);

  return references.join('\n');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function handleDebateStream(req, res, requestUrl) {
  const topic = (requestUrl.searchParams.get('topic') || '').trim();

  if (!topic) {
    sendSse(res, 'error', { message: 'A topic is required to start a debate.' });
    res.end();
    return;
  }

  if (topic.length > 280) {
    sendSse(res, 'error', { message: 'Topic is too long. Please keep it under 280 characters.' });
    res.end();
    return;
  }

  const apiKey = process.env.GOOGLE_API_KEY || '';
  if (!apiKey) {
    sendSse(res, 'error', { message: 'Missing GOOGLE_API_KEY environment variable.' });
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=UTF-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  sendSse(res, 'status', { state: 'starting' });

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  const transcript = [];
  const sourcesByNumber = new Map();
  const sourceNumberForUrl = new Map();
  let nextSourceNumber = 1;

  try {
    for (let turn = 1; turn <= DEFAULT_TURNS; turn += 1) {
      if (aborted) {
        return;
      }

      sendSse(res, 'status', { state: 'proponent-thinking', turn });

      if (aborted) {
        return;
      }

      const proponentResult = await callAgent({
        apiKey,
        topic,
        role: 'proponent',
        transcript,
        turn,
        totalTurns: DEFAULT_TURNS,
        sourcesByNumber,
        sourceNumberForUrl,
        nextSourceNumber
      });
      nextSourceNumber = proponentResult.nextSourceNumber;
      transcript.push({
        role: 'proponent',
        argument: proponentResult.argument
      });
      sendSse(res, 'turn', {
        role: 'proponent',
        turn,
        argument: proponentResult.argument,
        sources: proponentResult.sources
      });

      if (aborted) {
        return;
      }

      sendSse(res, 'status', { state: 'critic-thinking', turn });

      if (aborted) {
        return;
      }

      const criticResult = await callAgent({
        apiKey,
        topic,
        role: 'critic',
        transcript,
        turn,
        totalTurns: DEFAULT_TURNS,
        sourcesByNumber,
        sourceNumberForUrl,
        nextSourceNumber
      });
      nextSourceNumber = criticResult.nextSourceNumber;
      transcript.push({
        role: 'critic',
        argument: criticResult.argument
      });
      sendSse(res, 'turn', {
        role: 'critic',
        turn,
        argument: criticResult.argument,
        sources: criticResult.sources
      });
    }

    if (aborted) {
      return;
    }

    sendSse(res, 'status', { state: 'judging' });

    const evaluation = await callJudge({
      apiKey,
      topic,
      transcript,
      sourcesByNumber
    });

    sendSse(res, 'evaluation', {
      evaluation,
      sources: Array.from(sourcesByNumber.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([number, source]) => ({ number, ...source }))
    });
    sendSse(res, 'done', {});
  } catch (error) {
    console.error('Debate orchestration failed:', error);
    sendSse(res, 'error', { message: error.message || 'An unexpected error occurred.' });
  } finally {
    res.end();
  }
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function proponentSystemPrompt(topic) {
  return (
    `You are a world-class expert on "${topic}". ` +
    'Your objective is to argue passionately in favor of the topic. ' +
    'Adopt an optimistic, constructive tone and build the strongest possible case grounded in verifiable evidence.'
  );
}

function criticSystemPrompt(topic) {
  return (
    `You are a world-class critical thinker examining "${topic}". ` +
    'Your objective is to highlight flaws, risks, counterarguments, and trade-offs. ' +
    'Adopt a skeptical, analytical tone while grounding every point in verifiable evidence.'
  );
}

function buildAgentUserPrompt({ topic, role, transcript, sourcesByNumber, turn, totalTurns }) {
  const transcriptSummary = formatTranscriptEntries(transcript);
  const sourcesSummary = formatSourceReferenceList(sourcesByNumber);
  const roleDescription = role === 'proponent' ? 'supporting the idea' : 'critiquing the idea';
  const turnDescriptor = turn === 1 ? 'opening statement' : turn === totalTurns ? 'final turn' : 'next turn';

  return `Debate topic: "${topic}"\n\n` +
    `Transcript so far (each entry already includes any citations):\n${transcriptSummary}\n\n` +
    `Available citation reference numbers and their sources:\n${sourcesSummary}\n\n` +
    `You are ${roleDescription}. This is your ${turnDescriptor} (turn ${turn} of ${totalTurns}).\n` +
    'Requirements:\n' +
    '- Reference prior points as needed to maintain a coherent debate.\n' +
    '- Use the google_search tool to gather fresh evidence when introducing factual claims.\n' +
    '- Cite evidence inside your argument using markers like [S1], [S2], etc.\n' +
    '- Return ONLY valid JSON with exactly two properties: "argument" (string) and "sources" (array).\n' +
    '- The "sources" array must include one object per citation marker with "title" and "url" fields.\n' +
    '- If you reuse an existing source, include it again in the "sources" array with the same URL.\n' +
    '- Each citation marker in "argument" must correspond to an item in "sources" (1-indexed, e.g., [S1]).\n' +
    '- Keep the response under 250 words.\n' +
    '- Do not include any explanatory text outside of the JSON.';
}

function parseAgentResponse(rawText) {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('The model response did not include JSON output.');
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error('Failed to parse the model response JSON.');
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
  nextSourceNumber
}) {
  const systemPrompt = role === 'proponent' ? proponentSystemPrompt(topic) : criticSystemPrompt(topic);
  const userPrompt = buildAgentUserPrompt({ topic, role, transcript, sourcesByNumber, turn, totalTurns });
  const rawResponse = await callGeminiApi({ apiKey, systemPrompt, userPrompt });
  const parsed = parseAgentResponse(rawResponse);

  if (typeof parsed.argument !== 'string' || !Array.isArray(parsed.sources)) {
    throw new Error('Agent response JSON is missing required fields.');
  }

  if (parsed.sources.length === 0) {
    throw new Error('Agent response must include at least one source.');
  }

  const messageSources = [];
  let updatedArgument = parsed.argument;

  parsed.sources.forEach((source, index) => {
    if (!source || typeof source.title !== 'string' || typeof source.url !== 'string') {
      throw new Error('Each source must include both "title" and "url" fields.');
    }
    const trimmedTitle = source.title.trim();
    const trimmedUrl = source.url.trim();
    if (!trimmedTitle || !trimmedUrl) {
      throw new Error('Source title and URL cannot be empty.');
    }

    const marker = `[S${index + 1}]`;
    const escapedMarker = escapeRegExp(marker);
    const markerRegex = new RegExp(escapedMarker, 'g');
    if (!markerRegex.test(parsed.argument)) {
      throw new Error(`The marker ${marker} is missing from the argument.`);
    }

    let assignedNumber = sourceNumberForUrl.get(trimmedUrl);
    if (!assignedNumber) {
      assignedNumber = nextSourceNumber;
      sourceNumberForUrl.set(trimmedUrl, assignedNumber);
      sourcesByNumber.set(assignedNumber, { title: trimmedTitle, url: trimmedUrl });
      nextSourceNumber += 1;
    }

    updatedArgument = updatedArgument.replace(new RegExp(escapedMarker, 'g'), `[${assignedNumber}]`);
    messageSources.push({ number: assignedNumber, title: trimmedTitle, url: trimmedUrl });
  });

  const unmatchedMarkers = updatedArgument.match(/\[S\d+\]/g);
  if (unmatchedMarkers) {
    throw new Error(`Unmatched citation markers found: ${unmatchedMarkers.join(', ')}`);
  }

  return {
    argument: updatedArgument.trim(),
    sources: messageSources,
    nextSourceNumber
  };
}

async function callJudge({ apiKey, topic, transcript, sourcesByNumber }) {
  const transcriptSummary = formatTranscriptEntries(transcript);
  const sourcesSummary = formatSourceReferenceList(sourcesByNumber);

  const userPrompt =
    `You are an impartial and expert judge. The following is a debate transcript on "${topic}".\n\n` +
    `Debate transcript (with citations already embedded):\n${transcriptSummary}\n\n` +
    `Citation reference list:\n${sourcesSummary}\n\n` +
    'Provide a structured evaluation containing three sections exactly: "Strongest Pro Argument", "Strongest Con Argument", and "Unresolved Trade-offs".\n' +
    'Each section should be 1-3 sentences.\n' +
    'Cite supporting evidence using the existing citation numbers in square brackets.\n' +
    'Return ONLY valid JSON with properties "strongestProArgument", "strongestConArgument", and "unresolvedTradeOffs".';

  const systemPrompt =
    'You are an impartial judge summarizing debates. Highlight the most compelling point from each side and any unresolved tensions.';

  const rawResponse = await callGeminiApi({ apiKey, systemPrompt, userPrompt });
  const parsed = parseAgentResponse(rawResponse);

  if (
    typeof parsed.strongestProArgument !== 'string' ||
    typeof parsed.strongestConArgument !== 'string' ||
    typeof parsed.unresolvedTradeOffs !== 'string'
  ) {
    throw new Error('Judge response JSON is missing required fields.');
  }

  return {
    strongestProArgument: parsed.strongestProArgument.trim(),
    strongestConArgument: parsed.strongestConArgument.trim(),
    unresolvedTradeOffs: parsed.unresolvedTradeOffs.trim()
  };
}

async function callGeminiApi({ apiKey, systemPrompt, userPrompt }) {
  const url = `${GOOGLE_API_BASE}/${MODEL_NAME}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ],
    // The PRD requires the google_search tool to be available to the agents.
    tools: [{ googleSearch: {} }]
  };

  if (systemPrompt) {
    body.systemInstruction = {
      role: 'system',
      parts: [{ text: systemPrompt }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorMessage = `Gemini API request failed with status ${response.status}`;
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

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new Error('Gemini API response did not include any candidates.');
  }

  const text = candidate?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini API response did not contain text content.');
  }

  return text;
}

const server = createServer();

server.listen(PORT, () => {
  console.log(`Dialectica server listening on http://localhost:${PORT}`);
});
