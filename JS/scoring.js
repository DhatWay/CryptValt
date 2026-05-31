/**
 * CryptValt — AI Scoring Engine v3.0
 * Routes through secure backend proxy
 */

const ScoringEngine = (() => {

  const rateLimit = {
    requests: [],
    maxPerMin: 10,
    isAllowed() {
      const now = Date.now();
      this.requests = this.requests.filter(t => now - t < 60_000);
      if (this.requests.length >= this.maxPerMin) return false;
      this.requests.push(now);
      return true;
    },
  };

  function validateInputs(data) {
    const errors = [];
    if (!data.title       || data.title.trim().length       < 3)  errors.push('Title too short');
    if (!data.category)                                             errors.push('Category required');
    if (!data.description || data.description.trim().length < 50)  errors.push('Description too short (min 50 chars)');
    if (!data.problem     || data.problem.trim().length     < 20)  errors.push('Problem statement too short');
    if (!data.market      || data.market.trim().length      < 5)   errors.push('Target market required');
    return errors;
  }

  async function scoreIdea(ideaData) {
    const errors = validateInputs(ideaData);
    if (errors.length > 0) throw new Error('Validation failed: ' + errors.join(', '));
    if (!rateLimit.isAllowed()) throw new Error('Rate limit exceeded — wait 60 seconds');

    const response = await fetch(CONFIG.BACKEND_URL + '/api/score', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Wallet-Address':   state.wallet || '0x0000000000000000000000000000000000000000',
        'X-Timestamp':        Date.now().toString(),
      },
      body: JSON.stringify(ideaData),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 503) throw new Error('AI temporarily overloaded. Please retry in 30 seconds.');
      throw new Error(err.message || 'Scoring failed: ' + response.status);
    }

    const result = await response.json();
    if (!result.success) throw new Error(result.message || 'Scoring failed');
    return result.data;
  }

  async function queryClaudeAssist(query, platformContext) {
    const response = await fetch(CONFIG.BACKEND_URL + '/api/score/assist', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Wallet-Address': state.wallet || '0x0000000000000000000000000000000000000000',
      },
      body: JSON.stringify({ query, platformContext }),
    });

    if (!response.ok) throw new Error('Claude Assist unavailable');
    const result = await response.json();
    return result.data?.response || '';
  }

  return { scoreIdea, queryClaudeAssist, validateInputs };

})();

async function scoreIdea(ideaData) {
  return ScoringEngine.scoreIdea(ideaData);
}
