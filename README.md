# Dialectica

Dialectica is a lightweight MVP that orchestrates a structured debate between two AI agents (Proponent and Critic) and delivers a judged evaluation highlighting the strongest arguments and remaining trade-offs.

## Features

- Start a debate on any topic through a single input field.
- Watch the debate unfold turn-by-turn with live status updates.
- Each agent response includes citations backed by web search results.
- Automatic judge evaluation summarizing the strongest pro and con points with outstanding trade-offs.
- Copyable evaluation summary and full list of cited sources.

## Prerequisites

- [Node.js 18+](https://nodejs.org/) (for built-in `fetch` support).
- An OpenAI API key with access to GPT models.
- A SerpAPI key for real-time web search results (get one at [serpapi.com](https://serpapi.com/)).

## Getting Started

1. Clone the repository and navigate into the project directory.
2. Set up your environment variables using one of the methods below.
3. Start the server:

### Setting Environment Variables

**Option 1: Create a .env file (Recommended)**
```bash
# Create .env file in the project root
cat > .env << EOF
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5-nano
OPENAI_MAX_TOKENS=2000
OPENAI_TEMPERATURE=0.7
SERPAPI_KEY=your_serpapi_key_here
PORT=3000
DIALECTICA_TURNS=3
EOF
```

**Option 2: Command line**
```bash
OPENAI_API_KEY=your_key_here node src/server.js
```

**Option 3: Export in your shell**
```bash
export OPENAI_API_KEY=your_key_here
export OPENAI_MODEL=gpt-5-nano
node src/server.js
```

4. Start the server:

```bash
npm start
```

5. Open `http://localhost:3000` in your browser, enter a topic, and click **Start Debate**.

The server streams debate events to the browser using Server-Sent Events (SSE), so you'll see each agent's response and the judge's evaluation as soon as they are generated.

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required. OpenAI API key used to call the debate and judge models. | - |
| `OPENAI_MODEL` | Optional. OpenAI model to use for debates and judging. | `gpt-5-nano` |
| `OPENAI_MAX_TOKENS` | Optional. Maximum tokens per response. | `2000` |
| `OPENAI_TEMPERATURE` | Optional. Response randomness (0.0-2.0). | `0.7` |
| `DIALECTICA_TURNS` | Optional. Number of turns per agent. | `3` |
| `PORT` | Optional. HTTP port for the server. | `3000` |

## Project Structure

```
├── public
│   ├── app.js          # Frontend logic for managing debates and rendering UI
│   ├── index.html      # Single-page application shell
│   └── styles.css      # Minimalist styling
├── src
│   └── server.js       # Node HTTP server and debate orchestrator
└── README.md
```

## Notes

- The application requires outbound network access to the OpenAI API. Ensure the environment where you run the server permits HTTPS requests to `api.openai.com`.
- The debate agents expect to cite their sources using placeholders like `[S1]` that are automatically translated into global citation numbers for display and judging.
- The judge prompt reuses the debate transcript and shared citation list to ensure all conclusions remain grounded in the debate's evidence.
- You can use different OpenAI models by setting the `OPENAI_MODEL` environment variable (e.g., `gpt-5-nano`, `gpt-4`, `gpt-3.5-turbo`, etc.).
- **Note**: `gpt-5-nano` may not be available in all regions or API accounts. If you encounter errors, try using `gpt-4o-mini` or `gpt-3.5-turbo` instead.

## License

This project is licensed under the ISC License.
