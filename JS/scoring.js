/**
 * CryptValt — AI Scoring Engine v4.0
 * Full Multi-Dimensional Idea Valuation
 *
 * Dimensions:
 * 1. Market Opportunity (TAM/SAM/SOM)
 * 2. Revenue Potential (projections + models)
 * 3. Problem Severity (pain level + cost of problem)
 * 4. Cost Savings Analysis
 * 5. Consumer Demand Signal
 * 6. Competitive Landscape
 * 7. Patent & IP Potential
 * 8. Time to Market
 * 9. Regulatory Landscape
 * 10. Industry Disruption Score
 * 11. Social Impact Score
 * 12. Exit Scenarios (acquisition, IPO, licensing)
 * 13. Job Creation Potential
 * 14. Investor Verdict with full narrative
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

  // ── Input Validation ───────────────────────────────────
  function validateInputs(data) {
    const errors = [];
    if (!data.title       || data.title.trim().length       < 3)  errors.push('Title too short (min 3 chars)');
    if (!data.category)                                             errors.push('Category required');
    if (!data.description || data.description.trim().length < 50)  errors.push('Description too short (min 50 chars)');
    if (!data.problem     || data.problem.trim().length     < 20)  errors.push('Problem statement too short');
    if (!data.market      || data.market.trim().length      < 5)   errors.push('Target market required');
    return errors;
  }

  // ── Input Completeness ─────────────────────────────────
  function measureCompleteness(data) {
    let score = 0;
    if (data.title        && data.title.length        > 10)   score += 8;
    if (data.description  && data.description.length  > 200)  score += 15;
    if (data.description  && data.description.length  > 500)  score += 10;
    if (data.problem      && data.problem.length      > 100)  score += 15;
    if (data.market       && data.market.length       > 20)   score += 8;
    if (data.marketSize   && data.marketSize.length   > 5)    score += 10;
    if (data.costSavings  && data.costSavings.length  > 10)   score += 8;
    if (data.competitors  && data.competitors.length  > 10)   score += 8;
    if (data.revenueModel && data.revenueModel.length > 10)   score += 8;
    if (data.hasFiles)                                          score += 10;
    return Math.min(score, 100);
  }

  // ── Master Scoring Prompt ──────────────────────────────
  function buildPrompt(data, completeness) {
    return `You are CryptValt's chief investment analyst AI. Produce a comprehensive, investor-grade valuation report for this idea. Be specific, data-driven, and brutally honest. Generic statements are not acceptable.

═══════════════════════════════════════
IDEA SUBMISSION
═══════════════════════════════════════
Title:          ${data.title}
Category:       ${data.category}
Teaser:         ${data.teaser || 'Not provided'}
Problem:        ${data.problem}
Target Market:  ${data.market}
Market Size:    ${data.marketSize || 'Not provided'}
Cost Savings:   ${data.costSavings || 'Not provided'}
Competitors:    ${data.competitors || 'Not provided'}
Revenue Model:  ${data.revenueModel || 'Not provided'}
Full Description: ${data.description}
Supporting Files: ${data.hasFiles ? 'YES — inventor submitted additional documentation' : 'No'}
Input Completeness: ${completeness}/100

═══════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════
Return ONLY a valid JSON object. No markdown. No text outside the JSON.
Every string field must contain specific, substantive analysis — not filler.
Dollar figures must be realistic and justified by the data provided.

{
  "overallScore": <integer 0-100, weighted composite of all dimensions>,
  "confidenceScore": <integer 0-100, based on input completeness and idea clarity>,
  
  "dollarValueMin": <integer USD, conservative floor valuation>,
  "dollarValueMid": <integer USD, most likely valuation>,
  "dollarValueMax": <integer USD, optimistic ceiling>,
  "valuationMethodology": "<one sentence: how the dollar values were derived>",
  
  "scores": {
    "marketability":        <0-100>,
    "scalability":          <0-100>,
    "consumerPotential":    <0-100>,
    "competitiveMoat":      <0-100>,
    "executionFeasibility": <0-100>,
    "revenueClarity":       <0-100>,
    "problemSeverity":      <0-100>,
    "ipPotential":          <0-100>,
    "disruptionScore":      <0-100>,
    "socialImpact":         <0-100>
  },

  "executiveSummary": "<3-4 sentences: what the idea is, the core value proposition, market opportunity, and why now>",

  "marketOpportunity": {
    "tam": "<Total Addressable Market with specific dollar figure and source methodology>",
    "sam": "<Serviceable Addressable Market — realistic slice of TAM>",
    "som": "<Serviceable Obtainable Market year 1, year 3, year 5>",
    "growthRate": "<market annual growth rate with context>",
    "analysis": "<detailed paragraph on the market opportunity>"
  },

  "problemAnalysis": {
    "severity": "<0-100 pain score>",
    "frequency": "<how often does this problem occur for target users>",
    "currentCost": "<what does this problem cost people/businesses today in time, money, or resources>",
    "urgency": "<is this a must-solve or nice-to-have problem>",
    "analysis": "<detailed paragraph on the problem being solved>"
  },

  "costSavingsAnalysis": {
    "annualSavingsPerUser": "<estimated annual savings per user/customer in USD>",
    "aggregateMarketSavings": "<total money saved across the market if widely adopted>",
    "roiForCustomer": "<return on investment for a customer who adopts this solution>",
    "paybackPeriod": "<how quickly does the customer recoup their investment>",
    "analysis": "<detailed paragraph on the cost savings and economic value created>"
  },

  "revenueProjections": {
    "year1": "<projected revenue year 1 with assumptions>",
    "year3": "<projected revenue year 3>",
    "year5": "<projected revenue year 5>",
    "primaryModel": "<main revenue stream — SaaS/licensing/marketplace/hardware/data>",
    "secondaryModels": "<additional revenue streams>",
    "unitEconomics": "<cost to acquire a customer vs lifetime value>",
    "analysis": "<detailed paragraph on revenue potential and path to profitability>"
  },

  "competitiveAnalysis": {
    "directCompetitors": "<list of direct competitors if any>",
    "indirectCompetitors": "<indirect alternatives users currently use>",
    "competitiveAdvantage": "<what specifically makes this better>",
    "timeToCopy": "<how long for a well-funded competitor to replicate this>",
    "moatType": "<patent/network effects/data/switching costs/brand/regulatory>",
    "analysis": "<detailed paragraph on competitive position>"
  },

  "ipAnalysis": {
    "patentPotential": "<is this patentable — yes/no/partially, and why>",
    "patentableElements": "<specific aspects that could be patented>",
    "tradeSecretValue": "<value as a trade secret if not patented>",
    "ipStrategy": "<recommended IP protection approach>",
    "ipValueAdd": "<how much does IP protection add to the valuation>"
  },

  "timeToMarket": {
    "mvpTimeline": "<estimated time to build minimum viable product>",
    "fullProductTimeline": "<time to full market-ready product>",
    "keyMilestones": "<3 critical milestones on the path to market>",
    "resourcesRequired": "<capital, team, and infrastructure needed>",
    "analysis": "<paragraph on execution feasibility>"
  },

  "regulatoryLandscape": {
    "regulatoryRisk": "<low/medium/high>",
    "applicableRegulations": "<relevant regulations or compliance requirements>",
    "regulatoryTailwinds": "<any regulations that favor this idea>",
    "complianceCost": "<estimated cost to achieve regulatory compliance>",
    "analysis": "<paragraph on regulatory environment>"
  },

  "disruptionAnalysis": {
    "disruptionScore": <0-100>,
    "incumbentsThreatened": "<which existing companies or industries are disrupted>",
    "disruptionMechanism": "<how exactly does this disrupt — price/technology/model/experience>",
    "adoptionCurve": "<expected adoption pattern — fast/slow/niche/mass market>",
    "analysis": "<paragraph on industry disruption potential>"
  },

  "socialImpact": {
    "socialScore": <0-100>,
    "jobCreation": "<estimated jobs created if this scales>",
    "environmentalImpact": "<positive or negative environmental effects>",
    "accessibilityImpact": "<does this democratize access to something>",
    "communityBenefit": "<broader societal benefit beyond profit>",
    "analysis": "<paragraph on social and economic impact>"
  },

  "exitScenarios": {
    "acquisitionTargets": "<3 specific companies that would logically acquire this>",
    "acquisitionValuation": "<estimated acquisition price range>",
    "ipoPotential": "<is this an IPO candidate — timeline and size estimate>",
    "licensingValue": "<value if licensed rather than built out>",
    "strategicPartnership": "<potential strategic partners who would pay for access>",
    "mostLikelyExit": "<which exit scenario is most realistic and why>"
  },

  "riskFactors": [
    "<Risk 1: specific risk with realistic probability and impact>",
    "<Risk 2: specific risk with realistic probability and impact>",
    "<Risk 3: specific risk with realistic probability and impact>"
  ],

  "keyAssumptions": [
    "<Assumption 1: critical thing that must be true for this to succeed>",
    "<Assumption 2>",
    "<Assumption 3>"
  ],

  "comparables": [
    "<Company/deal 1: name, what they did, their valuation>",
    "<Company/deal 2>",
    "<Company/deal 3>"
  ],

  "marketability": "<detailed paragraph: who buys this, channels, price points, sales cycle, purchase triggers>",
  "scalability": "<detailed paragraph: unit economics, marginal cost of growth, geographic expansion, network effects>",
  "consumerPotential": "<detailed paragraph: consumer pain, frequency, willingness to pay, adoption barriers, delight factor>",
  "competitiveMoat": "<detailed paragraph: specific defensibility mechanisms and their durability>",

  "investorVerdict": "<powerful, specific, 3-4 sentence investor conclusion: the bull case, what makes this a potential 10x, who should buy this idea, and what the window of opportunity is>"
}`;
  }

  // ── Response Normalization ─────────────────────────────
  function normalizeScore(parsed) {
    const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(v || 0)));

    parsed.overallScore    = clamp(parsed.overallScore);
    parsed.confidenceScore = clamp(parsed.confidenceScore);
    parsed.dollarValueMin  = Math.max(0, Math.round(parsed.dollarValueMin  || 0));
    parsed.dollarValueMid  = Math.max(0, Math.round(parsed.dollarValueMid  || 0));
    parsed.dollarValueMax  = Math.max(0, Math.round(parsed.dollarValueMax  || 0));

    if (parsed.dollarValueMin > parsed.dollarValueMid) parsed.dollarValueMin = Math.round(parsed.dollarValueMid * 0.6);
    if (parsed.dollarValueMax < parsed.dollarValueMid) parsed.dollarValueMax = Math.round(parsed.dollarValueMid * 1.5);

    if (parsed.scores) {
      Object.keys(parsed.scores).forEach(k => { parsed.scores[k] = clamp(parsed.scores[k]); });
    }

    return parsed;
  }

  // ── Core Score Function ────────────────────────────────
  async function scoreIdea(ideaData) {
    const errors = validateInputs(ideaData);
    if (errors.length > 0) throw new Error('Validation: ' + errors.join(', '));
    if (!rateLimit.isAllowed()) throw new Error('Rate limit exceeded — wait 60 seconds');

    const completeness = measureCompleteness(ideaData);
    const prompt       = buildPrompt(ideaData, completeness);

    let attempt = 0;
    let delay   = 1_000;

    while (attempt < 3) {
      attempt++;
      try {
        const response = await fetch(
          (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/score',
          {
            method:  'POST',
            headers: {
              'Content-Type':     'application/json',
              'X-Wallet-Address': (typeof state !== 'undefined' && state.wallet) || '0x0000000000000000000000000000000000000000',
              'X-Timestamp':      Date.now().toString(),
            },
            body: JSON.stringify({ ...ideaData, _prompt: prompt }),
          }
        );

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if ((response.status === 503 || response.status === 529) && attempt < 3) {
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 2, 16_000);
            continue;
          }
          throw new Error(err.message || 'Scoring failed: ' + response.status);
        }

        const result    = await response.json();
        if (!result.success) throw new Error(result.message || 'Scoring failed');

        const validated = normalizeScore(result.data);
        validated.inputCompleteness = completeness;
        validated.scoredAt          = new Date().toISOString();

        return validated;

      } catch(e) {
        if (attempt >= 3) throw e;
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, 16_000);
      }
    }
  }

  // ── Claude Assist Query ────────────────────────────────
  async function queryClaudeAssist(query, platformContext) {
    const response = await fetch(
      (typeof CONFIG !== 'undefined' ? CONFIG.BACKEND_URL : '') + '/api/score/assist',
      {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Wallet-Address': (typeof state !== 'undefined' && state.wallet) || '0x0000000000000000000000000000000000000000',
        },
        body: JSON.stringify({ query, platformContext }),
      }
    );
    if (!response.ok) throw new Error('Claude Assist unavailable');
    const result = await response.json();
    return result.data?.response || '';
  }

  return { scoreIdea, queryClaudeAssist, validateInputs, measureCompleteness };

})();

async function scoreIdea(ideaData) { return ScoringEngine.scoreIdea(ideaData); }
