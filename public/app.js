const debateForm = document.getElementById("debate-form");
const topicInput = document.getElementById("topic-input");
const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const errorMessageEl = document.getElementById("error-message");
const debateSection = document.getElementById("debate-section");
const statusEl = document.getElementById("debate-status");
const turnList = document.getElementById("turn-list");
const evaluationSection = document.getElementById("evaluation-section");
const evaluationPro = document.getElementById("evaluation-pro");
const evaluationCon = document.getElementById("evaluation-con");
const evaluationTradeoffs = document.getElementById("evaluation-tradeoffs");
const evaluationSourcesSection = document.getElementById("evaluation-sources");
const evaluationSourceList = document.getElementById("evaluation-source-list");
const copyButton = document.getElementById("copy-evaluation");
const newDebateButton = document.getElementById("start-new-debate");

let latestEvaluation = null;
let currentEventSource = null;

function resetInterface() {
  hideError();
  turnList.innerHTML = "";
  setStatus("");
  debateSection.classList.add("hidden");
  evaluationSection.classList.add("hidden");
  evaluationSourcesSection.classList.add("hidden");
  evaluationSourceList.innerHTML = "";
  evaluationPro.textContent = "";
  evaluationCon.textContent = "";
  evaluationTradeoffs.textContent = "";
  latestEvaluation = null;
  copyButton.disabled = true;
  copyButton.textContent = "Copy Evaluation";
}

function showError(message) {
  errorMessageEl.textContent = message;
}

function hideError() {
  errorMessageEl.textContent = "";
}

function setStatus(message) {
  if (!message) {
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
    return;
  }
  statusEl.classList.remove("hidden");
  statusEl.textContent = message;
}

function createTurnElement({ role, turn, argument, sources }) {
  const container = document.createElement("article");
  container.className = `debate-turn ${role}`;

  const header = document.createElement("header");
  const rolePill = document.createElement("span");
  rolePill.className = `role-pill ${role}`;
  rolePill.textContent = role === "proponent" ? "Proponent" : "Critic";

  const turnNumber = document.createElement("span");
  turnNumber.className = "turn-number";
  turnNumber.textContent = `Round ${turn}`;

  header.append(rolePill, turnNumber);

  const argumentEl = document.createElement("p");
  argumentEl.className = "argument";
  argumentEl.textContent = argument;

  container.append(header, argumentEl);

  if (Array.isArray(sources) && sources.length > 0) {
    const sourcesTitle = document.createElement("span");
    sourcesTitle.className = "turn-sources-title";
    sourcesTitle.textContent = "Sources";

    const list = document.createElement("ul");
    list.className = "source-list";

    sources.forEach((source) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `[${source.number}] ${source.title}`;

      // Handle mock sources
      if (source.url.startsWith("#mock-")) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          alert(
            "This is a mock reference. In a real implementation, this would link to actual research sources."
          );
        });
      }

      item.appendChild(link);
      list.appendChild(item);
    });

    container.append(sourcesTitle, list);
  }

  return container;
}

function appendTurn(turnData) {
  debateSection.classList.remove("hidden");
  const turnElement = createTurnElement(turnData);
  turnList.appendChild(turnElement);
  turnList.scrollTo({ top: turnList.scrollHeight, behavior: "smooth" });
}

function handleEvaluation({ evaluation, sources }) {
  latestEvaluation = evaluation;
  evaluationSection.classList.remove("hidden");
  evaluationPro.textContent = evaluation.strongestProArgument;
  evaluationCon.textContent = evaluation.strongestConArgument;
  evaluationTradeoffs.textContent = evaluation.unresolvedTradeOffs;

  if (Array.isArray(sources) && sources.length > 0) {
    evaluationSourcesSection.classList.remove("hidden");
    evaluationSourceList.innerHTML = "";
    sources.forEach((source) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `[${source.number}] ${source.title}`;

      // Handle mock sources
      if (source.url.startsWith("#mock-")) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          alert(
            "This is a mock reference. In a real implementation, this would link to actual research sources."
          );
        });
      }

      item.appendChild(link);
      evaluationSourceList.appendChild(item);
    });
  }

  copyButton.disabled = false;
  setStatus("Debate complete.");
  enableForm();
}

function enableForm() {
  topicInput.disabled = false;
  startButton.disabled = false;
  startButton.textContent = "Start Debate";
  startButton.classList.remove("hidden");
  stopButton.classList.add("hidden");
}

function disableForm() {
  topicInput.disabled = true;
  startButton.disabled = true;
  startButton.textContent = "Debate Running...";
  startButton.classList.add("hidden");
  stopButton.classList.remove("hidden");
}

function stopDebate() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  setStatus("Debate stopped.");
  enableForm();
}

async function startDebate(topic) {
  resetInterface();
  disableForm();
  debateSection.classList.remove("hidden");
  setStatus("Starting debate...");

  try {
    const url = `/api/debate?topic=${encodeURIComponent(topic)}`;

    // Use EventSource for Server-Sent Events
    const eventSource = new EventSource(url);
    currentEventSource = eventSource;

    eventSource.addEventListener("status", (event) => {
      const data = JSON.parse(event.data);
      setStatus(data.message);
    });

    eventSource.addEventListener("turn", (event) => {
      const data = JSON.parse(event.data);
      appendTurn({
        role: data.role,
        turn: data.turn,
        argument: data.argument,
        sources: data.sources || [],
      });
    });

    eventSource.addEventListener("evaluation", (event) => {
      const data = JSON.parse(event.data);
      handleEvaluation({
        evaluation: data.evaluation,
        sources: data.sources || [],
      });
    });

    eventSource.addEventListener("complete", () => {
      eventSource.close();
      currentEventSource = null;
    });

    eventSource.addEventListener("error", (event) => {
      const data = JSON.parse(event.data);
      console.error("Debate error:", data.error);
      showError(data.error || "The debate encountered an error.");
      enableForm();
      setStatus("");
      eventSource.close();
      currentEventSource = null;
    });

    // Handle connection errors
    eventSource.onerror = (error) => {
      console.error("EventSource failed:", error);
      showError("Connection to debate server failed.");
      enableForm();
      setStatus("");
      eventSource.close();
      currentEventSource = null;
    };
  } catch (error) {
    console.error("Debate error:", error);
    showError(error.message || "The debate encountered an error.");
    enableForm();
    setStatus("");
  }
}

function buildEvaluationCopyText() {
  if (!latestEvaluation) {
    return "";
  }
  return [
    "Strongest Pro Argument:",
    latestEvaluation.strongestProArgument,
    "",
    "Strongest Con Argument:",
    latestEvaluation.strongestConArgument,
    "",
    "Unresolved Trade-offs:",
    latestEvaluation.unresolvedTradeOffs,
  ].join("\n");
}

debateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = topicInput.value.trim();
  if (!topic) {
    showError("Please enter a topic to debate.");
    return;
  }
  hideError();
  startDebate(topic);
});

stopButton.addEventListener("click", () => {
  stopDebate();
});

copyButton.addEventListener("click", async () => {
  if (!latestEvaluation) {
    return;
  }
  const text = buildEvaluationCopyText();
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "Copied!";
    setTimeout(() => {
      copyButton.textContent = "Copy Evaluation";
    }, 2000);
  } catch (error) {
    showError("Unable to copy the evaluation to your clipboard.");
  }
});

newDebateButton.addEventListener("click", () => {
  resetInterface();
  enableForm();
  topicInput.value = "";
  topicInput.focus();
});

resetInterface();
enableForm();
