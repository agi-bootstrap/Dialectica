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
- A Google Gemini API key with access to the `gemini-2.5-flash-preview-05-20` model and web search grounding.

## Getting Started

1. Clone the repository and navigate into the project directory.
2. Set the `GOOGLE_API_KEY` environment variable with your Gemini API key.
3. (Optional) Set `DIALECTICA_TURNS` to change the number of turns per agent (defaults to 3).
4. Start the server:

```bash
npm start
```

5. Open `http://localhost:3000` in your browser, enter a topic, and click **Start Debate**.

The server streams debate events to the browser using Server-Sent Events (SSE), so you'll see each agent's response and the judge's evaluation as soon as they are generated.

## Environment Variables

| Variable | Description |
| --- | --- |
| `GOOGLE_API_KEY` | Required. Gemini API key used to call the debate and judge models. |
| `DIALECTICA_TURNS` | Optional. Number of turns per agent (default is 3). |
| `PORT` | Optional. HTTP port for the server (defaults to 3000). |

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

- The application requires outbound network access to the Gemini API. Ensure the environment where you run the server permits HTTPS requests to `generativelanguage.googleapis.com`.
- The debate agents expect to cite their sources using placeholders like `[S1]` that are automatically translated into global citation numbers for display and judging.
- The judge prompt reuses the debate transcript and shared citation list to ensure all conclusions remain grounded in the debate's evidence.

## License

This project is licensed under the ISC License.
