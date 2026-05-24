/**
 * CryptValt — AI Scoring Engine
 * Real Anthropic API calls only
 */

async function scoreIdea(ideaData) {
  const prompt = `You are CryptValt's AI scoring engine. Analyze this idea and return ONLY a valid JSON object with no markdown, no preamble.

IDEA:
Title: ${ideaData.title}
Category: ${ideaData.category}
Teaser: ${ideaData.teaser}
Problem: ${ideaData.problem}
Target Market: ${ideaData.market}
Market Size: ${ideaData.marketSize}
Description: ${ideaData.description}

Return this exact JSON structure:
{
  "overallScore": <0-100>,
  "dollarValueMin": <number>,
  "dollarValueMax": <number>,
  "dollarValueMid": <number>,
  "scores": {
    "marketability": <0-100>,
    "scalability": <0-100>,
    "consumerPotential": <0-100>,
    "competitiveMoat": <0-100>,
    "executionFeasibility": <0-100>,
    "revenueClarity": <0-100>
  },
  "executiveSummary": "<string>",
  "marketability": "<string>",
  "scalability": "<string>",
  "consumerPotential": "<string>",
  "competitiveMoat": "<string>",
  "revenueModel": "<string>",
  "riskFactors": "<string>",
  "investorVerdict": "<string>"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error('AI scoring failed: ' + response.status + ' — ' + err);
  }

  const data  = await response.json();
  const text  = data.content[0].text;
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}
