const debateForm = document.getElementById('debate-form');
const topicInput = document.getElementById('topic-input');
const startButton = debateForm.querySelector('.primary-button');
const errorMessageEl = document.getElementById('error-message');
const debateSection = document.getElementById('debate-section');
const statusEl = document.getElementById('debate-status');
const turnList = document.getElementById('turn-list');
const evaluationSection = document.getElementById('evaluation-section');
const evaluationPro = document.getElementById('evaluation-pro');
const evaluationCon = document.getElementById('evaluation-con');
const evaluationTradeoffs = document.getElementById('evaluation-tradeoffs');
const evaluationSourcesSection = document.getElementById('evaluation-sources');
const evaluationSourceList = document.getElementById('evaluation-source-list');
const copyButton = document.getElementById('copy-evaluation');
const newDebateButton = document.getElementById('start-new-debate');

let eventSource = null;
let latestEvaluation = null;

function resetInterface() {
  hideError();
  turnList.innerHTML = '';
  setStatus('');
  debateSection.classList.add('hidden');
  evaluationSection.classList.add('hidden');
  evaluationSourcesSection.classList.add('hidden');
  evaluationSourceList.innerHTML = '';
  evaluationPro.textContent = '';
  evaluationCon.textContent = '';
  evaluationTradeoffs.textContent = '';
  latestEvaluation = null;
  copyButton.disabled = true;
  copyButton.textContent = 'Copy Evaluation';
}

function showError(message) {
  errorMessageEl.textContent = message;
}

function hideError() {
  errorMessageEl.textContent = '';
}

function setStatus(message) {
  if (!message) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    return;
  }
  statusEl.classList.remove('hidden');
  statusEl.textContent = message;
}

function createTurnElement({ role, turn, argument, sources }) {
  const container = document.createElement('article');
  container.className = `debate-turn ${role}`;

  const header = document.createElement('header');
  const rolePill = document.createElement('span');
  rolePill.className = `role-pill ${role}`;
  rolePill.textContent = role === 'proponent' ? 'Proponent' : 'Critic';

  const turnNumber = document.createElement('span');
  turnNumber.className = 'turn-number';
  turnNumber.textContent = `Round ${turn}`;

  header.append(rolePill, turnNumber);

  const argumentEl = document.createElement('p');
  argumentEl.className = 'argument';
  argumentEl.textContent = argument;

  container.append(header, argumentEl);

  if (Array.isArray(sources) && sources.length > 0) {
    const sourcesTitle = document.createElement('span');
    sourcesTitle.className = 'turn-sources-title';
    sourcesTitle.textContent = 'Sources';

    const list = document.createElement('ul');
    list.className = 'source-list';

    sources.forEach((source) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `[${source.number}] ${source.title}`;
      item.appendChild(link);
      list.appendChild(item);
    });

    container.append(sourcesTitle, list);
  }

  return container;
}

function appendTurn(turnData) {
  debateSection.classList.remove('hidden');
  const turnElement = createTurnElement(turnData);
  turnList.appendChild(turnElement);
  turnList.scrollTo({ top: turnList.scrollHeight, behavior: 'smooth' });
}

function handleEvaluation({ evaluation, sources }) {
  latestEvaluation = evaluation;
  evaluationSection.classList.remove('hidden');
  evaluationPro.textContent = evaluation.strongestProArgument;
  evaluationCon.textContent = evaluation.strongestConArgument;
  evaluationTradeoffs.textContent = evaluation.unresolvedTradeOffs;

  if (Array.isArray(sources) && sources.length > 0) {
    evaluationSourcesSection.classList.remove('hidden');
    evaluationSourceList.innerHTML = '';
    sources.forEach((source) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `[${source.number}] ${source.title}`;
      item.appendChild(link);
      evaluationSourceList.appendChild(item);
    });
  }

  copyButton.disabled = false;
  setStatus('Debate complete.');
  enableForm();
}

function enableForm() {
  topicInput.disabled = false;
  startButton.disabled = false;
  startButton.textContent = 'Start Debate';
}

function disableForm() {
  topicInput.disabled = true;
  startButton.disabled = true;
  startButton.textContent = 'Debate Running...';
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function mapStatus(state, turn) {
  switch (state) {
    case 'starting':
      return 'Setting up the debate...';
    case 'proponent-thinking':
      return `Proponent is preparing turn ${turn}...`;
    case 'critic-thinking':
      return `Critic is preparing turn ${turn}...`;
    case 'judging':
      return 'Judge is evaluating the debate...';
    default:
      return '';
  }
}

function handleStatusEvent(data) {
  const message = mapStatus(data.state, data.turn);
  setStatus(message);
}

function startDebate(topic) {
  closeEventSource();
  resetInterface();
  disableForm();
  debateSection.classList.remove('hidden');
  setStatus('Connecting to the debate orchestrator...');

  const url = `/api/debate/stream?topic=${encodeURIComponent(topic)}`;
  eventSource = new EventSource(url);

  eventSource.addEventListener('status', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleStatusEvent(data);
    } catch (error) {
      console.error('Failed to parse status event', error);
    }
  });

  eventSource.addEventListener('turn', (event) => {
    try {
      const data = JSON.parse(event.data);
      appendTurn(data);
    } catch (error) {
      console.error('Failed to parse turn event', error);
    }
  });

  eventSource.addEventListener('evaluation', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEvaluation(data);
    } catch (error) {
      console.error('Failed to parse evaluation event', error);
      showError('Unable to read the judge\'s evaluation.');
      enableForm();
    }
  });

  eventSource.addEventListener('error', (event) => {
    if (latestEvaluation) {
      closeEventSource();
      return;
    }
    if (event.data) {
      try {
        const data = JSON.parse(event.data);
        showError(data.message || 'The debate encountered an error.');
      } catch (parseError) {
        showError('The debate encountered an unexpected error.');
      }
    } else {
      showError('Connection lost. Please try starting the debate again.');
    }
    enableForm();
    setStatus('');
    closeEventSource();
  });

  eventSource.addEventListener('done', () => {
    closeEventSource();
  });
}

function buildEvaluationCopyText() {
  if (!latestEvaluation) {
    return '';
  }
  return [
    'Strongest Pro Argument:',
    latestEvaluation.strongestProArgument,
    '',
    'Strongest Con Argument:',
    latestEvaluation.strongestConArgument,
    '',
    'Unresolved Trade-offs:',
    latestEvaluation.unresolvedTradeOffs
  ].join('\n');
}

debateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const topic = topicInput.value.trim();
  if (!topic) {
    showError('Please enter a topic to debate.');
    return;
  }
  hideError();
  startDebate(topic);
});

copyButton.addEventListener('click', async () => {
  if (!latestEvaluation) {
    return;
  }
  const text = buildEvaluationCopyText();
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = 'Copied!';
    setTimeout(() => {
      copyButton.textContent = 'Copy Evaluation';
    }, 2000);
  } catch (error) {
    showError('Unable to copy the evaluation to your clipboard.');
  }
});

newDebateButton.addEventListener('click', () => {
  closeEventSource();
  resetInterface();
  enableForm();
  topicInput.value = '';
  topicInput.focus();
});

window.addEventListener('beforeunload', () => {
  closeEventSource();
});

resetInterface();
enableForm();
