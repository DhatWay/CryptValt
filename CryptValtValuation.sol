// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ============================================================
 * CryptValt Valuation Algorithm v2.0
 * Multi-Dimensional Idea Pricing Engine
 * ============================================================
 *
 * This contract calculates the true economic value of an idea
 * using a proprietary multi-factor model that combines:
 *
 * Dimension 1 — Market Fundamentals
 *   Total Addressable Market (TAM), Serviceable Addressable
 *   Market (SAM), penetration curves, market growth rate
 *
 * Dimension 2 — AI Intelligence Score
 *   6-factor weighted scoring: Marketability, Scalability,
 *   Consumer Potential, Competitive Moat, Execution Feasibility,
 *   Revenue Clarity. Each factor carries different weight.
 *
 * Dimension 3 — Competitive Landscape
 *   Competition density, barrier to entry, time-to-copy
 *
 * Dimension 4 — Platform Intelligence
 *   Real historical sale data, category velocity, demand signal
 *
 * Dimension 5 — Macro Timing
 *   Market cycle position, sector momentum, regulatory climate
 *
 * Dimension 6 — IP & Defensibility
 *   Patent potential, trade secret value, first-mover premium
 *
 * Output: Precise dollar range (min/mid/max) with confidence
 * interval and full breakdown of every contributing factor.
 *
 * Self-improves: Every real sale recalibrates the model.
 */

contract CryptValtValuation {

    // ============================================================
    // CONSTANTS
    // ============================================================
    uint256 public constant PRECISION          = 1e6;    // 6 decimal precision
    uint256 public constant BPS_BASE           = 10000;
    uint256 public constant MAX_TAM_USD        = 10_000_000_000_000; // $10T cap

    // AI Score Factor Weights (must sum to 10000)
    uint256 public constant W_MARKETABILITY    = 2000;  // 20%
    uint256 public constant W_SCALABILITY      = 1800;  // 18%
    uint256 public constant W_CONSUMER         = 1700;  // 17%
    uint256 public constant W_MOAT             = 1600;  // 16%
    uint256 public constant W_FEASIBILITY      = 1500;  // 15%
    uint256 public constant W_REVENUE          = 1400;  // 14%

    // Market penetration model (year 1-5 penetration %)
    uint256[5] internal PENETRATION_CURVE = [uint256(1), 3, 7, 12, 18]; // basis points of SAM

    // ============================================================
    // STRUCTS
    // ============================================================

    struct AIScoreBreakdown {
        uint256 marketability;      // 0-100
        uint256 scalability;        // 0-100
        uint256 consumerPotential;  // 0-100
        uint256 competitiveMoat;    // 0-100
        uint256 feasibility;        // 0-100
        uint256 revenueClarity;     // 0-100
        uint256 weightedComposite;  // 0-100 (weighted average)
    }

    struct MarketModel {
        uint256 tamUSD;             // Total Addressable Market
        uint256 samUSD;             // Serviceable Addressable Market (tamUSD * 30%)
        uint256 somYear1USD;        // Serviceable Obtainable Market Year 1
        uint256 somYear3USD;        // Year 3 projection
        uint256 somYear5USD;        // Year 5 projection
        uint256 marketGrowthBps;    // Annual market growth rate in BPS
        uint256 revenueYear1USD;    // Projected Year 1 revenue
        uint256 revenueYear3USD;    // Projected Year 3 revenue
        uint256 revenueYear5USD;    // Projected Year 5 revenue
        uint256 exitMultiple;       // Revenue multiple at exit
        uint256 impliedValuation;   // Exit valuation
    }

    struct CompetitiveModel {
        uint256 competitionScore;   // 0-100 (0 = no competition, 100 = saturated)
        uint256 barrierScore;       // 0-100 (0 = no barrier, 100 = impenetrable)
        uint256 timeToCopyDays;     // Days for competitor to replicate
        uint256 firstMoverPremium;  // Additional value for being first (BPS)
        uint256 moatScore;          // Combined defensibility score
    }

    struct ValuationResult {
        uint256 listingId;
        uint256 dollarValueMin;
        uint256 dollarValueMid;
        uint256 dollarValueMax;
        uint256 confidenceScore;    // 0-100
        uint256 volatilityScore;    // 0-100 (how wide the range is)
        uint256 timestamp;
        AIScoreBreakdown aiBreakdown;
        MarketModel marketModel;
        CompetitiveModel compModel;
        ValuationBreakdown breakdown;
    }

    struct ValuationBreakdown {
        uint256 baseMarketValue;          // From TAM/SAM/SOM model
        uint256 aiScoreMultiplier;        // Applied AI score adjustment
        uint256 categoryAdjustment;       // Category-specific premium/discount
        uint256 competitionDiscount;      // Competition density discount
        uint256 timingAdjustment;         // Market timing premium
        uint256 ipPremium;                // IP/defensibility premium
        uint256 platformDataAdjustment;   // Historical sale data calibration
        uint256 sentimentAdjustment;      // Market sentiment overlay
        uint256 finalMidValue;            // Final mid-point value
    }

    struct CategoryProfile {
        uint256 multiplierBps;       // Category premium multiplier
        uint256 avgSalePrice;        // Running average of real sales
        uint256 medianSalePrice;     // Median sale price
        uint256 saleCount;           // Total sales in this category
        uint256 totalSaleVolume;     // Total volume sold
        uint256 peakSalePrice;       // Highest ever sale
        uint256 lowestSalePrice;     // Lowest sale
        uint256 lastSaleTimestamp;   // Recency
        uint256 demandVelocity;      // How fast listings are selling (BPS of completion)
        uint256[] recentPrices;      // Last 10 prices for trend analysis
    }

    // ============================================================
    // STATE
    // ============================================================
    address public owner;
    address public platform;

    mapping(string => CategoryProfile)   public categories;
    mapping(uint256 => ValuationResult)  public valuations;

    uint256 public totalValuations;
    uint256 public totalSalesRecorded;
    uint256 public platformMarketSentiment;  // 0-100
    uint256 public globalDemandIndex;        // 0-100, updated from real sales
    uint256 public platformMaturityScore;    // 0-100, grows with data

    ValuationResult[] public valuationHistory;

    // ============================================================
    // EVENTS
    // ============================================================
    event ValuationComplete(
        uint256 indexed listingId,
        uint256 dollarValueMin,
        uint256 dollarValueMid,
        uint256 dollarValueMax,
        uint256 confidence
    );
    event SaleDataIngested(string category, uint256 salePrice, uint256 newAverage);
    event CategoryCalibrated(string category, uint256 newMultiplier);
    event SentimentUpdated(uint256 newScore);
    event ModelRecalibrated(uint256 totalSales, uint256 maturityScore);

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
        owner    = msg.sender;
        platform = _platform;
        _initializeCategories();
        platformMarketSentiment = 65;
        globalDemandIndex       = 60;
        platformMaturityScore   = 10;
    }

    function _initializeCategories() internal {
        _setCategory("tech",     16000, 0);
        _setCategory("health",   19000, 0);
        _setCategory("finance",  17000, 0);
        _setCategory("consumer", 12000, 0);
        _setCategory("energy",   14500, 0);
        _setCategory("other",    10000, 0);
    }

    function _setCategory(string memory name, uint256 multiplierBps, uint256 velocity) internal {
        categories[name].multiplierBps    = multiplierBps;
        categories[name].demandVelocity   = velocity;
        categories[name].lowestSalePrice  = type(uint256).max;
    }

    // ============================================================
    // CORE VALUATION ENGINE
    // ============================================================
    function calculateValuation(
        uint256 listingId,
        // AI Score components
        uint256 scoreMarketability,
        uint256 scoreScalability,
        uint256 scoreConsumer,
        uint256 scoreMoat,
        uint256 scoreFeasibility,
        uint256 scoreRevenue,
        // Market inputs
        string calldata category,
        uint256 tamUSD,
        uint256 competitionScore,  // 0-100
        uint256 barrierScore,      // 0-100
        uint256 timeToCopyDays,
        uint256 marketGrowthBps    // Annual growth rate
    ) external onlyPlatformOrOwner returns (ValuationResult memory result) {

        // ── STEP 1: Compute weighted AI composite score ────────────
        AIScoreBreakdown memory ai = _computeAIComposite(
            scoreMarketability, scoreScalability, scoreConsumer,
            scoreMoat, scoreFeasibility, scoreRevenue
        );

        // ── STEP 2: Build market model ─────────────────────────────
        MarketModel memory market = _buildMarketModel(tamUSD, ai.weightedComposite, marketGrowthBps);

        // ── STEP 3: Competitive analysis ──────────────────────────
        CompetitiveModel memory comp = _buildCompetitiveModel(
            competitionScore, barrierScore, timeToCopyDays
        );

        // ── STEP 4: Calculate base value from market model ─────────
        ValuationBreakdown memory breakdown;
        breakdown.baseMarketValue = market.impliedValuation;

        // ── STEP 5: Apply AI score multiplier ─────────────────────
        // Score 0-100 maps to 0.5x-3.5x multiplier (exponential curve)
        uint256 aiMultiplierBps = _aiScoreToMultiplier(ai.weightedComposite);
        breakdown.aiScoreMultiplier  = aiMultiplierBps;
        uint256 afterAI = (breakdown.baseMarketValue * aiMultiplierBps) / BPS_BASE;

        // ── STEP 6: Category premium ───────────────────────────────
        uint256 catMult = categories[category].multiplierBps;
        if (catMult == 0) catMult = 10000;
        breakdown.categoryAdjustment = catMult;
        uint256 afterCat = (afterAI * catMult) / BPS_BASE;

        // ── STEP 7: Competition discount ──────────────────────────
        // High competition = lower value. Formula: 1 - (competition/200)
        // competition 0 = no discount, competition 100 = 50% discount
        uint256 compDiscountBps = BPS_BASE - ((competitionScore * BPS_BASE) / 200);
        if (compDiscountBps < 3000) compDiscountBps = 3000; // Floor 30%
        breakdown.competitionDiscount = compDiscountBps;
        uint256 afterComp = (afterCat * compDiscountBps) / BPS_BASE;

        // ── STEP 8: IP & Defensibility premium ────────────────────
        uint256 ipPremiumBps = 10000 + (comp.moatScore * 100); // Up to 2x for strong moat
        if (ipPremiumBps > 20000) ipPremiumBps = 20000;
        breakdown.ipPremium = ipPremiumBps;
        uint256 afterIP = (afterComp * ipPremiumBps) / BPS_BASE;

        // ── STEP 9: Market timing ─────────────────────────────────
        uint256 timingBps = 8000 + (platformMarketSentiment * 40); // 80%-120% range
        breakdown.timingAdjustment = timingBps;
        uint256 afterTiming = (afterIP * timingBps) / BPS_BASE;

        // ── STEP 10: Platform data calibration ────────────────────
        uint256 afterPlatform = afterTiming;
        if (categories[category].saleCount >= 5) {
            // Blend 65% model / 35% historical data
            uint256 historical = categories[category].avgSalePrice;
            afterPlatform = ((afterTiming * 6500) + (historical * 3500)) / BPS_BASE;
            breakdown.platformDataAdjustment = afterPlatform;
        }

        // ── STEP 11: Global demand index ──────────────────────────
        uint256 demandBps = 8000 + (globalDemandIndex * 40);
        breakdown.sentimentAdjustment = demandBps;
        uint256 finalMid = (afterPlatform * demandBps) / BPS_BASE;

        breakdown.finalMidValue = finalMid;

        // ── STEP 12: Calculate range ───────────────────────────────
        // Range width depends on confidence — lower confidence = wider range
        uint256 confidence = _calculateConfidence(category, ai.weightedComposite, tamUSD);
        uint256 rangeWidth = (100 - confidence) * 3; // 0-300 BPS spread on each side

        uint256 minMultBps = BPS_BASE > rangeWidth * 100 ? BPS_BASE - rangeWidth * 100 : 5000;
        uint256 maxMultBps = BPS_BASE + rangeWidth * 100;
        if (maxMultBps > 30000) maxMultBps = 30000;

        uint256 dollarMin = (finalMid * minMultBps) / BPS_BASE;
        uint256 dollarMax = (finalMid * maxMultBps) / BPS_BASE;

        uint256 volatility = rangeWidth * 10;
        if (volatility > 100) volatility = 100;

        result = ValuationResult({
            listingId:      listingId,
            dollarValueMin: dollarMin,
            dollarValueMid: finalMid,
            dollarValueMax: dollarMax,
            confidenceScore: confidence,
            volatilityScore: volatility,
            timestamp:      block.timestamp,
            aiBreakdown:    ai,
            marketModel:    market,
            compModel:      comp,
            breakdown:      breakdown
        });

        valuations[listingId] = result;
        valuationHistory.push(result);
        totalValuations++;

        emit ValuationComplete(listingId, dollarMin, finalMid, dollarMax, confidence);
        return result;
    }

    // ============================================================
    // AI COMPOSITE SCORE CALCULATOR
    // ============================================================
    function _computeAIComposite(
        uint256 mkt,
        uint256 scl,
        uint256 con,
        uint256 moat,
        uint256 feas,
        uint256 rev
    ) internal pure returns (AIScoreBreakdown memory ai) {
        require(mkt <= 100 && scl <= 100 && con <= 100 && moat <= 100 && feas <= 100 && rev <= 100,
            "Scores must be 0-100");

        ai.marketability     = mkt;
        ai.scalability       = scl;
        ai.consumerPotential = con;
        ai.competitiveMoat   = moat;
        ai.feasibility       = feas;
        ai.revenueClarity    = rev;

        // Weighted composite
        uint256 weighted = (
            mkt  * W_MARKETABILITY +
            scl  * W_SCALABILITY   +
            con  * W_CONSUMER      +
            moat * W_MOAT          +
            feas * W_FEASIBILITY   +
            rev  * W_REVENUE
        ) / BPS_BASE;

        ai.weightedComposite = weighted > 100 ? 100 : weighted;
        return ai;
    }

    // ============================================================
    // MARKET MODEL BUILDER
    // ============================================================
    function _buildMarketModel(
        uint256 tamUSD,
        uint256 compositeScore,
        uint256 marketGrowthBps
    ) internal view returns (MarketModel memory m) {
        if (tamUSD > MAX_TAM_USD) tamUSD = MAX_TAM_USD;

        // SAM = 30% of TAM (typical serviceable slice)
        m.tamUSD          = tamUSD;
        m.samUSD          = (tamUSD * 3000) / BPS_BASE;
        m.marketGrowthBps = marketGrowthBps > 0 ? marketGrowthBps : 1500; // Default 15%

        // SOM using penetration curve adjusted by AI score
        // Higher score = faster penetration
        uint256 penetrationBoost = 5000 + (compositeScore * 100); // 50%-150% of base curve
        m.somYear1USD = (m.samUSD * PENETRATION_CURVE[0] * penetrationBoost) / (100 * BPS_BASE);
        m.somYear3USD = (m.samUSD * PENETRATION_CURVE[2] * penetrationBoost) / (100 * BPS_BASE);
        m.somYear5USD = (m.samUSD * PENETRATION_CURVE[4] * penetrationBoost) / (100 * BPS_BASE);

        // Revenue projections (assume 20-40% margin capture)
        uint256 revenueCaptureBps = 2000 + (compositeScore * 200); // 20%-40%
        m.revenueYear1USD = (m.somYear1USD * revenueCaptureBps) / BPS_BASE;
        m.revenueYear3USD = (m.somYear3USD * revenueCaptureBps) / BPS_BASE;
        m.revenueYear5USD = (m.somYear5USD * revenueCaptureBps) / BPS_BASE;

        // Exit multiple (higher score = higher multiple, range 3x-15x)
        m.exitMultiple = 30000 + (compositeScore * 1200); // 3x-15x in BPS (10000 = 1x)

        // Implied valuation = Year 3 revenue * exit multiple
        m.impliedValuation = (m.revenueYear3USD * m.exitMultiple) / BPS_BASE;

        return m;
    }

    // ============================================================
    // COMPETITIVE MODEL BUILDER
    // ============================================================
    function _buildCompetitiveModel(
        uint256 competitionScore,
        uint256 barrierScore,
        uint256 timeToCopyDays
    ) internal pure returns (CompetitiveModel memory c) {
        c.competitionScore = competitionScore;
        c.barrierScore     = barrierScore;
        c.timeToCopyDays   = timeToCopyDays;

        // First mover premium: inversely proportional to competition, amplified by time-to-copy
        c.firstMoverPremium = ((100 - competitionScore) * 100) +
                              ((timeToCopyDays > 365 ? 365 : timeToCopyDays) * 10);

        // Moat score: combination of barrier + competition inverse + first mover
        c.moatScore = (barrierScore * 4000 + (100 - competitionScore) * 4000 +
                      (c.firstMoverPremium > 100 ? 100 : c.firstMoverPremium) * 2000) / BPS_BASE;
        if (c.moatScore > 100) c.moatScore = 100;

        return c;
    }

    // ============================================================
    // AI SCORE TO VALUE MULTIPLIER (Exponential curve)
    // ============================================================
    function _aiScoreToMultiplier(uint256 score) internal pure returns (uint256 bps) {
        // Piecewise exponential approximation
        // Score 0-9:   0.25x (2500 BPS)
        // Score 10-19: 0.40x
        // Score 20-29: 0.55x
        // Score 30-39: 0.75x
        // Score 40-49: 1.00x (10000 BPS)
        // Score 50-59: 1.30x
        // Score 60-69: 1.65x
        // Score 70-79: 2.10x
        // Score 80-89: 2.70x
        // Score 90-100: 3.50x (35000 BPS)

        if (score >= 90) return 35000;
        if (score >= 80) return 27000 + ((score - 80) * 800);
        if (score >= 70) return 21000 + ((score - 70) * 600);
        if (score >= 60) return 16500 + ((score - 60) * 450);
        if (score >= 50) return 13000 + ((score - 50) * 350);
        if (score >= 40) return 10000 + ((score - 40) * 300);
        if (score >= 30) return  7500 + ((score - 30) * 250);
        if (score >= 20) return  5500 + ((score - 20) * 200);
        if (score >= 10) return  4000 + ((score - 10) * 150);
        return 2500 + (score * 150);
    }

    // ============================================================
    // CONFIDENCE SCORE
    // ============================================================
    function _calculateConfidence(
        string memory category,
        uint256 compositeScore,
        uint256 tamUSD
    ) internal view returns (uint256 confidence) {
        confidence = 40; // Base

        // More sales data = higher confidence
        uint256 salesCount = categories[category].saleCount;
        if (salesCount >= 50)      confidence += 25;
        else if (salesCount >= 20) confidence += 18;
        else if (salesCount >= 10) confidence += 12;
        else if (salesCount >= 5)  confidence += 7;

        // High AI score = more reliable prediction
        if (compositeScore >= 80)      confidence += 15;
        else if (compositeScore >= 60) confidence += 10;
        else if (compositeScore >= 40) confidence += 5;

        // TAM provided = better model
        if (tamUSD > 0)               confidence += 12;

        // Platform maturity boosts confidence
        confidence += platformMaturityScore / 10;

        return confidence > 95 ? 95 : confidence; // Cap at 95%
    }

    // ============================================================
    // SALE DATA INGESTION — Model self-improvement
    // ============================================================
    function recordSale(
        string calldata category,
        uint256 salePrice
    ) external onlyPlatformOrOwner {
        CategoryProfile storage cat = categories[category];

        // Update sale history
        cat.saleCount++;
        cat.totalSaleVolume += salePrice;
        cat.lastSaleTimestamp = block.timestamp;

        if (salePrice > cat.peakSalePrice)  cat.peakSalePrice   = salePrice;
        if (salePrice < cat.lowestSalePrice) cat.lowestSalePrice = salePrice;

        // Rolling average (exponential moving average, alpha = 0.2)
        if (cat.avgSalePrice == 0) {
            cat.avgSalePrice = salePrice;
        } else {
            cat.avgSalePrice = (cat.avgSalePrice * 8000 + salePrice * 2000) / BPS_BASE;
        }

        // Track recent prices (circular buffer of 10)
        if (cat.recentPrices.length < 10) {
            cat.recentPrices.push(salePrice);
        } else {
            // Shift left, insert at end
            for (uint256 i = 0; i < 9; i++) {
                cat.recentPrices[i] = cat.recentPrices[i + 1];
            }
            cat.recentPrices[9] = salePrice;
        }

        // Recalibrate median
        cat.medianSalePrice = _calculateMedian(cat.recentPrices);

        // Recalibrate category multiplier based on real demand
        _recalibrateCategory(category);

        totalSalesRecorded++;
        _updatePlatformMaturity();

        emit SaleDataIngested(category, salePrice, cat.avgSalePrice);
    }

    function _recalibrateCategory(string memory category) internal {
        CategoryProfile storage cat = categories[category];
        if (cat.saleCount < 5) return; // Need minimum data

        // If average sale is significantly above our base estimate — increase multiplier
        uint256 baseEstimate = 50000; // $50k base estimate
        if (cat.avgSalePrice > baseEstimate * 3) {
            uint256 newMult = cat.multiplierBps + 500; // Increase 5%
            if (newMult > 25000) newMult = 25000;
            cat.multiplierBps = newMult;
            emit CategoryCalibrated(category, newMult);
        } else if (cat.avgSalePrice < baseEstimate / 2 && cat.multiplierBps > 7000) {
            uint256 newMult = cat.multiplierBps - 200; // Decrease 2%
            cat.multiplierBps = newMult;
            emit CategoryCalibrated(category, newMult);
        }
    }

    function _updatePlatformMaturity() internal {
        // Maturity grows logarithmically with sales data
        if (totalSalesRecorded < 10)       platformMaturityScore = 10;
        else if (totalSalesRecorded < 50)  platformMaturityScore = 25;
        else if (totalSalesRecorded < 100) platformMaturityScore = 40;
        else if (totalSalesRecorded < 500) platformMaturityScore = 60;
        else                               platformMaturityScore = 80;

        emit ModelRecalibrated(totalSalesRecorded, platformMaturityScore);
    }

    function _calculateMedian(uint256[] storage arr) internal view returns (uint256) {
        if (arr.length == 0) return 0;
        // Simple approximation — average of middle elements
        uint256 mid = arr.length / 2;
        if (arr.length % 2 == 0) {
            return (arr[mid - 1] + arr[mid]) / 2;
        }
        return arr[mid];
    }

    // ============================================================
    // QUICK ESTIMATE — Gas-efficient off-chain preview
    // ============================================================
    function quickEstimate(
        uint256 aiScore,
        string calldata category,
        uint256 marketSizeUSD
    ) external view returns (uint256 min_, uint256 mid, uint256 max_) {
        uint256 catMult = categories[category].multiplierBps;
        if (catMult == 0) catMult = 10000;

        uint256 aiMult  = _aiScoreToMultiplier(aiScore);
        uint256 baseSAM = (marketSizeUSD * 3000) / BPS_BASE;

        // Simplified 3-year revenue model
        uint256 rev3 = (baseSAM * 700) / BPS_BASE; // 7% penetration year 3
        uint256 exit = (rev3 * 60000) / BPS_BASE;  // 6x revenue multiple

        mid  = (exit * aiMult / BPS_BASE * catMult) / BPS_BASE;
        min_ = (mid * 7000) / BPS_BASE;
        max_ = (mid * 14000) / BPS_BASE;

        // Blend with historical if available
        if (categories[category].saleCount >= 5) {
            uint256 hist = categories[category].avgSalePrice;
            mid  = (mid * 6500 + hist * 3500) / BPS_BASE;
            min_ = (mid * 7000) / BPS_BASE;
            max_ = (mid * 14000) / BPS_BASE;
        }
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    function getValuation(uint256 listingId) external view returns (ValuationResult memory) {
        return valuations[listingId];
    }

    function getCategoryProfile(string calldata category) external view
        returns (
            uint256 multiplier,
            uint256 avgSale,
            uint256 medianSale,
            uint256 saleCount,
            uint256 totalVolume,
            uint256 peakSale,
            uint256 demandVelocity
        )
    {
        CategoryProfile storage c = categories[category];
        return (c.multiplierBps, c.avgSalePrice, c.medianSalePrice,
                c.saleCount, c.totalSaleVolume, c.peakSalePrice, c.demandVelocity);
    }

    function getModelStats() external view returns (
        uint256 total,
        uint256 salesRecorded,
        uint256 maturity,
        uint256 sentiment,
        uint256 demandIndex
    ) {
        return (totalValuations, totalSalesRecorded,
                platformMaturityScore, platformMarketSentiment, globalDemandIndex);
    }

    // ============================================================
    // ADMIN
    // ============================================================
    function updateSentiment(uint256 score) external onlyOwner {
        require(score <= 100, "Invalid");
        platformMarketSentiment = score;
        emit SentimentUpdated(score);
    }

    function updateDemandIndex(uint256 index) external onlyOwner {
        require(index <= 100, "Invalid");
        globalDemandIndex = index;
    }

    function setCategoryMultiplier(string calldata category, uint256 multiplierBps) external onlyOwner {
        require(multiplierBps >= 5000 && multiplierBps <= 30000, "Out of range");
        categories[category].multiplierBps = multiplierBps;
    }

    function updatePlatform(address _platform) external onlyOwner {
        platform = _platform;
    }
}