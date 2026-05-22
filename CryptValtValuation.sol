// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CryptValt Valuation Algorithm
 * 
 * On-chain idea valuation engine.
 * Calculates true dollar value based on multiple weighted factors.
 * Updates dynamically as platform sales data accumulates.
 * All math is transparent and verifiable on-chain.
 */

contract CryptValtValuation {

    // ============================================================
    // STATE
    // ============================================================
    address public owner;
    address public platform;

    // Category multipliers (basis points, 10000 = 1x)
    mapping(string => uint256) public categoryMultipliers;

    // Historical sale data by category
    mapping(string => uint256[]) public categorySalePrices;
    mapping(string => uint256) public categoryAverageSale;
    mapping(string => uint256) public categorySaleCount;

    // Score-to-value mapping (score range => value multiplier)
    // Score 90-100 = 2.5x base, 80-89 = 2x, 70-79 = 1.5x, etc.
    uint256[10] public scoreMultipliers;

    // Market timing factors
    uint256 public marketSentimentScore;  // 0-100, updated by governor
    uint256 public platformGrowthRate;    // BPS

    // Valuation history
    ValuationRecord[] public valuationHistory;
    mapping(uint256 => ValuationRecord) public listingValuations;

    struct ValuationRecord {
        uint256 listingId;
        uint256 aiScore;
        string category;
        uint256 marketSize;        // In USD (off-chain estimated, passed in)
        uint256 competitionScore;  // 0-100, lower = less competition = higher value
        uint256 timingScore;       // 0-100, market timing
        uint256 calculatedValue;   // Final calculated value in wei equivalent
        uint256 dollarValueMin;
        uint256 dollarValueMid;
        uint256 dollarValueMax;
        uint256 confidenceScore;   // 0-100
        uint256 timestamp;
        ValuationBreakdown breakdown;
    }

    struct ValuationBreakdown {
        uint256 baseValue;
        uint256 aiScoreAdjustment;
        uint256 categoryAdjustment;
        uint256 marketSizeAdjustment;
        uint256 competitionAdjustment;
        uint256 timingAdjustment;
        uint256 platformDataAdjustment;
        uint256 finalValue;
    }

    // ============================================================
    // EVENTS
    // ============================================================
    event ValuationCalculated(
        uint256 indexed listingId,
        uint256 dollarValueMid,
        uint256 confidenceScore
    );
    event CategoryMultiplierUpdated(string category, uint256 multiplier);
    event SaleRecorded(string category, uint256 salePrice);
    event MarketSentimentUpdated(uint256 newScore);

    // ============================================================
    // MODIFIERS
    // ============================================================
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPlatformOrOwner() {
        require(msg.sender == platform || msg.sender == owner, "Unauthorized");
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================
    constructor(address _platform) {
        owner = msg.sender;
        platform = _platform;
        _initializeMultipliers();
    }

    function _initializeMultipliers() internal {
        // Score brackets 0-9 (index 0 = score 0-9, index 9 = score 90-100)
        scoreMultipliers[0] = 2500;   // Score 0-9:   0.25x
        scoreMultipliers[1] = 5000;   // Score 10-19: 0.5x
        scoreMultipliers[2] = 7500;   // Score 20-29: 0.75x
        scoreMultipliers[3] = 10000;  // Score 30-39: 1.0x
        scoreMultipliers[4] = 12500;  // Score 40-49: 1.25x
        scoreMultipliers[5] = 15000;  // Score 50-59: 1.5x
        scoreMultipliers[6] = 17500;  // Score 60-69: 1.75x
        scoreMultipliers[7] = 20000;  // Score 70-79: 2.0x
        scoreMultipliers[8] = 25000;  // Score 80-89: 2.5x
        scoreMultipliers[9] = 35000;  // Score 90-100: 3.5x

        // Category multipliers (basis points)
        categoryMultipliers["tech"] = 15000;       // 1.5x — high demand
        categoryMultipliers["health"] = 18000;     // 1.8x — high value market
        categoryMultipliers["finance"] = 16000;    // 1.6x — strong monetization
        categoryMultipliers["consumer"] = 12000;   // 1.2x — competitive
        categoryMultipliers["energy"] = 14000;     // 1.4x — growing sector
        categoryMultipliers["other"] = 10000;      // 1.0x — base

        // Initial market sentiment
        marketSentimentScore = 65;
        platformGrowthRate = 10000; // 1x initially
    }

    // ============================================================
    // CORE VALUATION ALGORITHM
    // ============================================================
    function calculateValuation(
        uint256 listingId,
        uint256 aiScore,
        string calldata category,
        uint256 estimatedMarketSizeUSD,
        uint256 competitionScore,
        uint256 timingScore
    ) external onlyPlatformOrOwner returns (ValuationRecord memory) {

        require(aiScore <= 100, "Invalid AI score");
        require(competitionScore <= 100, "Invalid competition score");
        require(timingScore <= 100, "Invalid timing score");

        ValuationBreakdown memory breakdown;

        // STEP 1: Base value from market size
        // Market size drives foundation value
        // $1B market = $100k base, $10B = $500k, etc.
        uint256 baseValue = _calculateBaseFromMarketSize(estimatedMarketSizeUSD);
        breakdown.baseValue = baseValue;

        // STEP 2: AI Score adjustment
        uint256 scoreBracket = aiScore / 10;
        if (scoreBracket > 9) scoreBracket = 9;
        uint256 aiAdjusted = (baseValue * scoreMultipliers[scoreBracket]) / 10000;
        breakdown.aiScoreAdjustment = aiAdjusted - baseValue;

        // STEP 3: Category multiplier
        uint256 catMultiplier = categoryMultipliers[category];
        if (catMultiplier == 0) catMultiplier = 10000;
        uint256 catAdjusted = (aiAdjusted * catMultiplier) / 10000;
        breakdown.categoryAdjustment = catAdjusted - aiAdjusted;

        // STEP 4: Competition adjustment
        // Lower competition = higher value
        // competition 0 = 1.5x, competition 100 = 0.5x
        uint256 compMultiplier = 15000 - (competitionScore * 100);
        if (compMultiplier < 5000) compMultiplier = 5000;
        uint256 compAdjusted = (catAdjusted * compMultiplier) / 10000;
        breakdown.competitionAdjustment = compAdjusted - catAdjusted;

        // STEP 5: Market timing adjustment
        uint256 timingMultiplier = 8000 + (timingScore * 40);
        uint256 timingAdjusted = (compAdjusted * timingMultiplier) / 10000;
        breakdown.timingAdjustment = timingAdjusted - compAdjusted;

        // STEP 6: Market sentiment adjustment
        uint256 sentimentMultiplier = 8000 + (marketSentimentScore * 40);
        uint256 sentimentAdjusted = (timingAdjusted * sentimentMultiplier) / 10000;

        // STEP 7: Platform data adjustment — if we have comparable sales
        uint256 platformAdjusted = sentimentAdjusted;
        if (categorySaleCount[category] >= 5) {
            uint256 avgSale = categoryAverageSale[category];
            // Blend 70% calculated, 30% historical average
            platformAdjusted = ((sentimentAdjusted * 7000) + (avgSale * 3000)) / 10000;
            breakdown.platformDataAdjustment = platformAdjusted - sentimentAdjusted;
        }

        breakdown.finalValue = platformAdjusted;

        // Calculate range (±30% for min/max)
        uint256 dollarValueMid = platformAdjusted;
        uint256 dollarValueMin = (dollarValueMid * 7000) / 10000;
        uint256 dollarValueMax = (dollarValueMid * 13000) / 10000;

        // Confidence score based on data availability
        uint256 confidence = _calculateConfidence(category, aiScore, estimatedMarketSizeUSD);

        ValuationRecord memory record = ValuationRecord({
            listingId: listingId,
            aiScore: aiScore,
            category: category,
            marketSize: estimatedMarketSizeUSD,
            competitionScore: competitionScore,
            timingScore: timingScore,
            calculatedValue: platformAdjusted,
            dollarValueMin: dollarValueMin,
            dollarValueMid: dollarValueMid,
            dollarValueMax: dollarValueMax,
            confidenceScore: confidence,
            timestamp: block.timestamp,
            breakdown: breakdown
        });

        listingValuations[listingId] = record;
        valuationHistory.push(record);

        emit ValuationCalculated(listingId, dollarValueMid, confidence);
        return record;
    }

    // ============================================================
    // BASE VALUE FROM MARKET SIZE
    // ============================================================
    function _calculateBaseFromMarketSize(uint256 marketSizeUSD) internal pure returns (uint256) {
        if (marketSizeUSD == 0) return 10000;           // $10k default minimum

        if (marketSizeUSD < 1_000_000) {                // Under $1M market
            return marketSizeUSD / 100;                 // 1% of market
        } else if (marketSizeUSD < 10_000_000) {        // $1M-$10M market
            return marketSizeUSD / 80;                  // 1.25%
        } else if (marketSizeUSD < 100_000_000) {       // $10M-$100M market
            return marketSizeUSD / 50;                  // 2%
        } else if (marketSizeUSD < 1_000_000_000) {     // $100M-$1B market
            return marketSizeUSD / 25;                  // 4%
        } else if (marketSizeUSD < 10_000_000_000) {    // $1B-$10B market
            return marketSizeUSD / 15;                  // 6.7%
        } else {                                        // $10B+ market
            return marketSizeUSD / 10;                  // 10% capped
        }
    }

    // ============================================================
    // CONFIDENCE SCORE
    // ============================================================
    function _calculateConfidence(
        string memory category,
        uint256 aiScore,
        uint256 marketSize
    ) internal view returns (uint256) {
        uint256 confidence = 50; // Base confidence

        // More category sales data = higher confidence
        if (categorySaleCount[category] >= 10) confidence += 20;
        else if (categorySaleCount[category] >= 5) confidence += 10;

        // Higher AI score = more reliable valuation
        if (aiScore >= 80) confidence += 15;
        else if (aiScore >= 60) confidence += 8;

        // Market size provided = higher confidence
        if (marketSize > 0) confidence += 15;

        return min(confidence, 100);
    }

    // ============================================================
    // RECORD SALE (Updates algorithm with real data)
    // ============================================================
    function recordSale(
        string calldata category,
        uint256 salePrice
    ) external onlyPlatformOrOwner {
        categorySalePrices[category].push(salePrice);
        categorySaleCount[category]++;

        // Recalculate running average
        uint256 total = 0;
        uint256[] memory prices = categorySalePrices[category];
        uint256 count = prices.length;
        uint256 useCount = count > 20 ? 20 : count; // Use last 20 sales
        uint256 start = count > 20 ? count - 20 : 0;

        for (uint256 i = start; i < count; i++) {
            total += prices[i];
        }

        categoryAverageSale[category] = total / useCount;
        emit SaleRecorded(category, salePrice);
    }

    // ============================================================
    // GOVERNANCE — UPDATE PARAMETERS
    // ============================================================
    function updateCategoryMultiplier(
        string calldata category,
        uint256 multiplier
    ) external onlyOwner {
        require(multiplier >= 5000 && multiplier <= 30000, "Multiplier out of range");
        categoryMultipliers[category] = multiplier;
        emit CategoryMultiplierUpdated(category, multiplier);
    }

    function updateMarketSentiment(uint256 score) external onlyOwner {
        require(score <= 100, "Invalid score");
        marketSentimentScore = score;
        emit MarketSentimentUpdated(score);
    }

    function updateScoreMultiplier(uint256 bracket, uint256 multiplier) external onlyOwner {
        require(bracket <= 9, "Invalid bracket");
        require(multiplier >= 1000 && multiplier <= 50000, "Out of range");
        scoreMultipliers[bracket] = multiplier;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    function getValuation(uint256 listingId) external view returns (ValuationRecord memory) {
        return listingValuations[listingId];
    }

    function getCategoryStats(string calldata category) external view returns (
        uint256 avgSale,
        uint256 saleCount,
        uint256 multiplier
    ) {
        return (
            categoryAverageSale[category],
            categorySaleCount[category],
            categoryMultipliers[category]
        );
    }

    function quickEstimate(
        uint256 aiScore,
        string calldata category,
        uint256 marketSizeUSD
    ) external view returns (uint256 min_, uint256 mid, uint256 max_) {
        uint256 base = _calculateBaseFromMarketSize(marketSizeUSD);
        uint256 scoreBracket = aiScore / 10;
        if (scoreBracket > 9) scoreBracket = 9;
        uint256 scoreAdj = (base * scoreMultipliers[scoreBracket]) / 10000;
        uint256 catMult = categoryMultipliers[category];
        if (catMult == 0) catMult = 10000;
        mid = (scoreAdj * catMult) / 10000;
        min_ = (mid * 7000) / 10000;
        max_ = (mid * 13000) / 10000;
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function updatePlatform(address newPlatform) external onlyOwner {
        platform = newPlatform;
    }
}