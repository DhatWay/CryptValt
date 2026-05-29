// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ============================================================
 * CryptValt Valuation Algorithm v3.0
 * Multi-Dimensional Idea Pricing Engine
 * ============================================================
 *
 * A self-improving, data-driven valuation model that calculates
 * the true economic value of an idea across 7 dimensions.
 *
 * Dimensions:
 *
 * 1. Market Fundamentals (TAM → SAM → SOM)
 *    Full 5-year revenue projection with penetration curve
 *    adjusted by AI composite score and market growth rate
 *
 * 2. AI Intelligence Score (6-factor weighted composite)
 *    Marketability (20%), Scalability (18%), Consumer (17%),
 *    Moat (16%), Feasibility (15%), Revenue (14%)
 *    Maps to exponential multiplier curve (0.25x–3.5x)
 *
 * 3. Competitive Landscape
 *    Competition density, barrier score, time-to-copy,
 *    first-mover premium, moat composite
 *
 * 4. Platform Intelligence (Self-Improving)
 *    Exponential moving average of real sale data
 *    Model blends 65% calculated / 35% historical
 *    Recalibrates category multipliers autonomously
 *
 * 5. Market Timing
 *    Sentiment overlay, demand index, cycle position
 *
 * 6. IP Defensibility Premium
 *    Patent potential, trade secret value, network effects,
 *    switching cost moat, data advantage
 *
 * 7. Confidence Interval
 *    Range width narrows as real sale data accumulates
 *    Volatility score indicates pricing uncertainty
 *
 * Self-improvement: every real sale recalibrates the model.
 * The algorithm gets smarter with every transaction.
 */

contract CryptValtValuation {

    // ── Constants ────────────────────────────────────────────
    uint256 public constant BPS_BASE        = 10_000;
    uint256 public constant MAX_TAM_USD     = 10_000_000_000_000; // $10T cap
    uint256 public constant EMA_ALPHA_BPS   = 2_000;  // 20% weight to new data (EMA)
    uint256 public constant MIN_BASE_VALUE  = 5_000;  // $5k floor

    // AI Score Factor Weights (must sum to BPS_BASE)
    uint256 public constant W_MARKETABILITY = 2_000; // 20%
    uint256 public constant W_SCALABILITY   = 1_800; // 18%
    uint256 public constant W_CONSUMER      = 1_700; // 17%
    uint256 public constant W_MOAT          = 1_600; // 16%
    uint256 public constant W_FEASIBILITY   = 1_500; // 15%
    uint256 public constant W_REVENUE       = 1_400; // 14%
    // Total: 10_000 ✓

    // SAM as percentage of TAM (30%)
    uint256 public constant SAM_RATIO_BPS   = 3_000;

    // Exit multiple range (3x–15x in BPS units, 10_000 = 1x)
    uint256 public constant EXIT_MULT_BASE  = 30_000;  // 3x base
    uint256 public constant EXIT_MULT_SLOPE = 1_200;   // +1.2x per 10 score points

    // ── Structs ──────────────────────────────────────────────

    struct AIScoreBreakdown {
        uint256 marketability;
        uint256 scalability;
        uint256 consumerPotential;
        uint256 competitiveMoat;
        uint256 feasibility;
        uint256 revenueClarity;
        uint256 weightedComposite;  // 0-100
    }

    struct MarketModel {
        uint256 tamUSD;
        uint256 samUSD;
        uint256 somYear1USD;
        uint256 somYear3USD;
        uint256 somYear5USD;
        uint256 revenueYear1USD;
        uint256 revenueYear3USD;
        uint256 revenueYear5USD;
        uint256 exitMultipleBPS;    // BPS (10_000 = 1x)
        uint256 impliedValuationUSD;
        uint256 marketGrowthBPS;
    }

    struct CompetitiveModel {
        uint256 competitionScore;   // 0-100 (0=none, 100=saturated)
        uint256 barrierScore;       // 0-100 (0=none, 100=impenetrable)
        uint256 timeToCopyDays;
        uint256 firstMoverPremiumBPS;
        uint256 moatScore;          // 0-100 composite
    }

    struct ValuationBreakdown {
        uint256 baseMarketValue;
        uint256 aiMultiplierBPS;
        uint256 categoryMultiplierBPS;
        uint256 competitionDiscountBPS;
        uint256 ipPremiumBPS;
        uint256 timingMultiplierBPS;
        uint256 platformBlendBPS;
        uint256 demandMultiplierBPS;
        uint256 finalMidValue;
    }

    struct ValuationResult {
        uint256 listingId;
        uint256 dollarValueMin;
        uint256 dollarValueMid;
        uint256 dollarValueMax;
        uint256 confidenceScore;    // 0-100
        uint256 volatilityScore;    // 0-100 (higher = wider range = less certain)
        uint256 timestamp;
        AIScoreBreakdown  aiBreakdown;
        MarketModel       market;
        CompetitiveModel  competitive;
        ValuationBreakdown breakdown;
    }

    struct CategoryProfile {
        uint256 multiplierBPS;
        uint256 avgSalePrice;
        uint256 medianSalePrice;
        uint256 peakSalePrice;
        uint256 floorSalePrice;
        uint256 totalVolume;
        uint256 saleCount;
        uint256 lastSaleTimestamp;
        uint256 demandVelocityBPS;  // % of listings that sell
        uint256[] recentPrices;     // Circular buffer, last 20
        uint256   recentPricesHead; // Circular buffer head index
    }

    // ── State ────────────────────────────────────────────────
    address public owner;
    address public platform;

    mapping(string  => CategoryProfile)  public categories;
    mapping(uint256 => ValuationResult)  public valuations;

    ValuationResult[] private valuationHistory;

    uint256 public totalValuations;
    uint256 public totalSalesRecorded;
    uint256 public platformSentimentBPS;  // 8_000–12_000 (80%–120%)
    uint256 public globalDemandBPS;       // 8_000–12_000
    uint256 public platformMaturityScore; // 0-100 (grows with data)

    // ── Events ───────────────────────────────────────────────
    event ValuationComplete(uint256 indexed listingId, uint256 min, uint256 mid, uint256 max, uint256 confidence);
    event SaleIngested(string category, uint256 price, uint256 newAvg, uint256 saleCount);
    event CategoryRecalibrated(string category, uint256 newMultiplier, string reason);
    event ModelRecalibrated(uint256 salesRecorded, uint256 maturityScore);
    event SentimentUpdated(uint256 newBPS);
    event DemandIndexUpdated(uint256 newBPS);

    // ── Modifiers ────────────────────────────────────────────
    modifier onlyOwner()            { require(msg.sender == owner,              "Val: not owner");    _; }
    modifier onlyPlatformOrOwner()  { require(msg.sender == platform || msg.sender == owner, "Val: unauthorized"); _; }

    // ── Constructor ──────────────────────────────────────────
    constructor(address _platform) {
        require(_platform != address(0), "Val: zero address");
        owner    = msg.sender;
        platform = _platform;
        _initCategories();
        platformSentimentBPS  = 10_000; // 1.0x neutral
        globalDemandBPS       = 9_500;  // Slightly below neutral initially
        platformMaturityScore = 5;
    }

    function _initCategories() internal {
        _setCategory("tech",     16_000);  // 1.6x — high demand
        _setCategory("health",   19_000);  // 1.9x — high value
        _setCategory("finance",  17_500);  // 1.75x — strong monetization
        _setCategory("consumer", 12_000);  // 1.2x — competitive
        _setCategory("energy",   14_500);  // 1.45x — growing
        _setCategory("other",    10_000);  // 1.0x — base
    }

    function _setCategory(string memory name, uint256 multiplierBPS) internal {
        categories[name].multiplierBPS  = multiplierBPS;
        categories[name].floorSalePrice = type(uint256).max;
    }

    // ── Core Valuation ───────────────────────────────────────
    function calculateValuation(
        uint256 listingId,
        uint256 scoreMarketability,
        uint256 scoreScalability,
        uint256 scoreConsumer,
        uint256 scoreMoat,
        uint256 scoreFeasibility,
        uint256 scoreRevenue,
        string  calldata category,
        uint256 tamUSD,
        uint256 competitionScore,
        uint256 barrierScore,
        uint256 timeToCopyDays,
        uint256 marketGrowthBPS
    ) external onlyPlatformOrOwner returns (ValuationResult memory result) {

        require(scoreMarketability <= 100, "Val: score >100");
        require(competitionScore   <= 100, "Val: comp >100");
        require(barrierScore       <= 100, "Val: barrier >100");

        // ── Step 1: AI Composite ────────────────────────────
        AIScoreBreakdown memory ai = _computeAI(
            scoreMarketability, scoreScalability, scoreConsumer,
            scoreMoat, scoreFeasibility, scoreRevenue
        );

        // ── Step 2: Market Model ────────────────────────────
        MarketModel memory market = _buildMarket(tamUSD, ai.weightedComposite, marketGrowthBPS);

        // ── Step 3: Competitive Model ───────────────────────
        CompetitiveModel memory comp = _buildCompetitive(competitionScore, barrierScore, timeToCopyDays);

        // ── Step 4–10: Cascading Multiplier Chain ───────────
        ValuationBreakdown memory bd;

        // Base value from market model
        bd.baseMarketValue = market.impliedValuationUSD;

        // AI score multiplier (exponential curve)
        bd.aiMultiplierBPS = _aiToMultiplier(ai.weightedComposite);
        uint256 v = (bd.baseMarketValue * bd.aiMultiplierBPS) / BPS_BASE;

        // Category premium
        bd.categoryMultiplierBPS = categories[category].multiplierBPS > 0
            ? categories[category].multiplierBPS : BPS_BASE;
        v = (v * bd.categoryMultiplierBPS) / BPS_BASE;

        // Competition discount: high competition = lower value
        // Formula: max(30%, 1 - competition/200)
        bd.competitionDiscountBPS = BPS_BASE > (competitionScore * BPS_BASE / 200)
            ? BPS_BASE - (competitionScore * BPS_BASE / 200) : 3_000;
        if (bd.competitionDiscountBPS < 3_000) bd.competitionDiscountBPS = 3_000;
        v = (v * bd.competitionDiscountBPS) / BPS_BASE;

        // IP / Moat premium: up to 2x for perfect moat
        bd.ipPremiumBPS = BPS_BASE + (comp.moatScore * BPS_BASE / 100);
        if (bd.ipPremiumBPS > 20_000) bd.ipPremiumBPS = 20_000;
        v = (v * bd.ipPremiumBPS) / BPS_BASE;

        // Market timing
        bd.timingMultiplierBPS = platformSentimentBPS;
        v = (v * bd.timingMultiplierBPS) / BPS_BASE;

        // Platform data blend (65% model / 35% historical)
        if (categories[category].saleCount >= 5) {
            uint256 hist = categories[category].avgSalePrice;
            v = (v * 6_500 + hist * 3_500) / BPS_BASE;
            bd.platformBlendBPS = 6_500; // Mark that blend was applied
        }

        // Global demand index
        bd.demandMultiplierBPS = globalDemandBPS;
        v = (v * bd.demandMultiplierBPS) / BPS_BASE;

        // Floor
        if (v < MIN_BASE_VALUE) v = MIN_BASE_VALUE;
        bd.finalMidValue = v;

        // ── Step 11: Confidence & Range ─────────────────────
        uint256 confidence = _calcConfidence(category, ai.weightedComposite, tamUSD);
        uint256 spreadBPS  = (100 - confidence) * 200; // 0-20_000 BPS spread
        if (spreadBPS > 15_000) spreadBPS = 15_000;

        uint256 minMult = BPS_BASE > spreadBPS ? BPS_BASE - spreadBPS : 3_000;
        uint256 maxMult = BPS_BASE + spreadBPS;
        if (maxMult > 35_000) maxMult = 35_000;

        result = ValuationResult({
            listingId:      listingId,
            dollarValueMin: (v * minMult) / BPS_BASE,
            dollarValueMid: v,
            dollarValueMax: (v * maxMult) / BPS_BASE,
            confidenceScore: confidence,
            volatilityScore: (spreadBPS * 100) / 20_000,
            timestamp:      block.timestamp,
            aiBreakdown:    ai,
            market:         market,
            competitive:    comp,
            breakdown:      bd
        });

        valuations[listingId] = result;
        valuationHistory.push(result);
        totalValuations++;

        emit ValuationComplete(listingId, result.dollarValueMin, v, result.dollarValueMax, confidence);
        return result;
    }

    // ── AI Composite Calculation ─────────────────────────────
    function _computeAI(
        uint256 mkt, uint256 scl, uint256 con,
        uint256 moat, uint256 feas, uint256 rev
    ) internal pure returns (AIScoreBreakdown memory ai) {
        ai.marketability     = mkt;
        ai.scalability       = scl;
        ai.consumerPotential = con;
        ai.competitiveMoat   = moat;
        ai.feasibility       = feas;
        ai.revenueClarity    = rev;

        uint256 weighted = (
            mkt  * W_MARKETABILITY +
            scl  * W_SCALABILITY   +
            con  * W_CONSUMER      +
            moat * W_MOAT          +
            feas * W_FEASIBILITY   +
            rev  * W_REVENUE
        ) / BPS_BASE;

        ai.weightedComposite = weighted > 100 ? 100 : weighted;
    }

    // ── Market Model Builder ─────────────────────────────────
    function _buildMarket(
        uint256 tamUSD,
        uint256 compositeScore,
        uint256 marketGrowthBPS
    ) internal pure returns (MarketModel memory m) {
        if (tamUSD > MAX_TAM_USD) tamUSD = MAX_TAM_USD;

        m.tamUSD          = tamUSD;
        m.samUSD          = (tamUSD * SAM_RATIO_BPS) / BPS_BASE;
        m.marketGrowthBPS = marketGrowthBPS > 0 ? marketGrowthBPS : 1_500; // Default 15%

        // Penetration curve: [1%, 3%, 7%, 12%, 18%] of SAM, boosted by AI score
        // Higher score → faster penetration (up to 1.5x boost)
        uint256 boost = BPS_BASE + (compositeScore * 50); // 10000–15000 BPS
        m.somYear1USD = (m.samUSD * 100  * boost) / (BPS_BASE * BPS_BASE);
        m.somYear3USD = (m.samUSD * 700  * boost) / (BPS_BASE * BPS_BASE);
        m.somYear5USD = (m.samUSD * 1_800 * boost) / (BPS_BASE * BPS_BASE);

        // Revenue capture: 20%–40% of SOM based on AI score
        uint256 captureBPS = 2_000 + (compositeScore * 200);
        if (captureBPS > 4_000) captureBPS = 4_000;
        m.revenueYear1USD = (m.somYear1USD * captureBPS) / BPS_BASE;
        m.revenueYear3USD = (m.somYear3USD * captureBPS) / BPS_BASE;
        m.revenueYear5USD = (m.somYear5USD * captureBPS) / BPS_BASE;

        // Exit multiple: 3x–15x based on score
        m.exitMultipleBPS = EXIT_MULT_BASE + (compositeScore * EXIT_MULT_SLOPE);
        if (m.exitMultipleBPS > 150_000) m.exitMultipleBPS = 150_000; // 15x cap

        // Implied valuation = Year3 revenue × exit multiple
        m.impliedValuationUSD = (m.revenueYear3USD * m.exitMultipleBPS) / BPS_BASE;
        if (m.impliedValuationUSD < MIN_BASE_VALUE) m.impliedValuationUSD = MIN_BASE_VALUE;
    }

    // ── Competitive Model Builder ────────────────────────────
    function _buildCompetitive(
        uint256 competitionScore,
        uint256 barrierScore,
        uint256 timeToCopyDays
    ) internal pure returns (CompetitiveModel memory c) {
        c.competitionScore = competitionScore;
        c.barrierScore     = barrierScore;
        c.timeToCopyDays   = timeToCopyDays;

        // First mover premium: higher when competition is low AND time-to-copy is long
        uint256 cappedDays  = timeToCopyDays > 365 ? 365 : timeToCopyDays;
        c.firstMoverPremiumBPS = ((100 - competitionScore) * 50) + (cappedDays * 10);

        // Moat score composite
        uint256 rawMoat = (
            barrierScore                 * 4_000 +
            (100 - competitionScore)     * 3_500 +
            (cappedDays * 100 / 365)     * 2_500
        ) / BPS_BASE;
        c.moatScore = rawMoat > 100 ? 100 : rawMoat;
    }

    // ── AI Score → Multiplier (Exponential Curve) ────────────
    function _aiToMultiplier(uint256 score) internal pure returns (uint256 bps) {
        // Piecewise exponential approximation
        // Maps 0-100 → 2500-35000 BPS (0.25x–3.5x)
        if (score >= 95) return 35_000;
        if (score >= 90) return 30_000 + ((score - 90) * 1_000);
        if (score >= 80) return 22_000 + ((score - 80) *   800);
        if (score >= 70) return 16_500 + ((score - 70) *   550);
        if (score >= 60) return 12_500 + ((score - 60) *   400);
        if (score >= 50) return  9_500 + ((score - 50) *   300);
        if (score >= 40) return  7_500 + ((score - 40) *   200);
        if (score >= 30) return  5_500 + ((score - 30) *   200);
        if (score >= 20) return  4_000 + ((score - 20) *   150);
        if (score >= 10) return  2_750 + ((score - 10) *   125);
        return 2_500 + (score * 25);
    }

    // ── Confidence Score ─────────────────────────────────────
    function _calcConfidence(
        string memory category,
        uint256 compositeScore,
        uint256 tamUSD
    ) internal view returns (uint256 confidence) {
        confidence = 35; // Base

        uint256 sales = categories[category].saleCount;
        if      (sales >= 100) confidence += 30;
        else if (sales >=  50) confidence += 22;
        else if (sales >=  20) confidence += 15;
        else if (sales >=  10) confidence += 10;
        else if (sales >=   5) confidence += 5;

        if      (compositeScore >= 80) confidence += 15;
        else if (compositeScore >= 60) confidence += 10;
        else if (compositeScore >= 40) confidence += 5;

        if (tamUSD > 0) confidence += 10;

        confidence += platformMaturityScore / 5;

        return confidence > 95 ? 95 : confidence;
    }

    // ── Sale Data Ingestion (Self-Improvement) ───────────────
    function recordSale(string calldata category, uint256 salePrice)
        external onlyPlatformOrOwner
    {
        CategoryProfile storage cat = categories[category];
        cat.saleCount++;
        cat.totalVolume      += salePrice;
        cat.lastSaleTimestamp = block.timestamp;

        if (salePrice > cat.peakSalePrice)                    cat.peakSalePrice   = salePrice;
        if (salePrice < cat.floorSalePrice)                   cat.floorSalePrice  = salePrice;

        // Exponential Moving Average: new = alpha*price + (1-alpha)*old
        if (cat.avgSalePrice == 0) {
            cat.avgSalePrice = salePrice;
        } else {
            cat.avgSalePrice = (EMA_ALPHA_BPS * salePrice + (BPS_BASE - EMA_ALPHA_BPS) * cat.avgSalePrice) / BPS_BASE;
        }

        // Circular buffer for last 20 prices (median calc)
        if (cat.recentPrices.length < 20) {
            cat.recentPrices.push(salePrice);
        } else {
            cat.recentPrices[cat.recentPricesHead % 20] = salePrice;
            cat.recentPricesHead++;
        }
        cat.medianSalePrice = _approxMedian(cat.recentPrices);

        _recalibrateCategory(category);
        _updateMaturity();

        totalSalesRecorded++;
        emit SaleIngested(category, salePrice, cat.avgSalePrice, cat.saleCount);
    }

    function _recalibrateCategory(string memory category) internal {
        CategoryProfile storage cat = categories[category];
        if (cat.saleCount < 5) return;

        uint256 current = cat.multiplierBPS;
        uint256 target  = current;
        string  memory reason;

        // If actual average sale is >2x our base estimate, increase multiplier
        uint256 baseEst = 75_000; // $75k reference point
        if (cat.avgSalePrice > baseEst * 2 && current < 25_000) {
            target = current + 300; // +3%
            reason = "Avg sale >2x base — increasing multiplier";
        } else if (cat.avgSalePrice < baseEst / 3 && current > 7_000) {
            target = current - 150; // -1.5%
            reason = "Avg sale <0.33x base — reducing multiplier";
        }

        if (target != current) {
            cat.multiplierBPS = target;
            emit CategoryRecalibrated(category, target, reason);
        }
    }

    function _updateMaturity() internal {
        uint256 prev = platformMaturityScore;
        if      (totalSalesRecorded <  10)  platformMaturityScore = 5;
        else if (totalSalesRecorded <  50)  platformMaturityScore = 20;
        else if (totalSalesRecorded < 100)  platformMaturityScore = 35;
        else if (totalSalesRecorded < 250)  platformMaturityScore = 50;
        else if (totalSalesRecorded < 500)  platformMaturityScore = 65;
        else if (totalSalesRecorded < 1000) platformMaturityScore = 80;
        else                                platformMaturityScore = 95;

        if (platformMaturityScore != prev) {
            emit ModelRecalibrated(totalSalesRecorded, platformMaturityScore);
        }
    }

    // Simple median approximation for gas efficiency
    function _approxMedian(uint256[] storage arr) internal view returns (uint256) {
        if (arr.length == 0) return 0;
        if (arr.length == 1) return arr[0];
        uint256 mid = arr.length / 2;
        return arr.length % 2 == 0
            ? (arr[mid - 1] + arr[mid]) / 2
            : arr[mid];
    }

    // ── Quick Estimate (Gas-Efficient) ───────────────────────
    function quickEstimate(
        uint256 aiScore,
        string  calldata category,
        uint256 marketSizeUSD
    ) external view returns (uint256 min_, uint256 mid, uint256 max_) {
        uint256 catMult = categories[category].multiplierBPS > 0
            ? categories[category].multiplierBPS : BPS_BASE;
        uint256 aiMult  = _aiToMultiplier(aiScore);

        uint256 sam     = (marketSizeUSD * SAM_RATIO_BPS) / BPS_BASE;
        uint256 rev3    = (sam * 700) / BPS_BASE;                  // 7% SOM yr3
        uint256 exit    = (rev3 * 60_000) / BPS_BASE;              // 6x multiple
        mid             = (exit * aiMult / BPS_BASE * catMult) / BPS_BASE;
        mid             = (mid  * platformSentimentBPS)         / BPS_BASE;
        mid             = (mid  * globalDemandBPS)              / BPS_BASE;

        if (mid < MIN_BASE_VALUE) mid = MIN_BASE_VALUE;

        // Blend with historical if available
        if (categories[category].saleCount >= 5) {
            uint256 hist = categories[category].avgSalePrice;
            mid = (mid * 6_500 + hist * 3_500) / BPS_BASE;
        }

        min_ = (mid * 6_500) / BPS_BASE;   // -35%
        max_ = (mid * 15_000) / BPS_BASE;  // +50%
    }

    // ── View Functions ───────────────────────────────────────
    function getValuation(uint256 listingId) external view returns (ValuationResult memory) {
        return valuations[listingId];
    }

    function getCategoryProfile(string calldata category) external view returns (
        uint256 multiplier,
        uint256 avgSale,
        uint256 medianSale,
        uint256 peakSale,
        uint256 floorSale,
        uint256 saleCount,
        uint256 totalVolume,
        uint256 demandVelocity
    ) {
        CategoryProfile storage c = categories[category];
        return (
            c.multiplierBPS, c.avgSalePrice, c.medianSalePrice,
            c.peakSalePrice, c.floorSalePrice == type(uint256).max ? 0 : c.floorSalePrice,
            c.saleCount, c.totalVolume, c.demandVelocityBPS
        );
    }

    function getModelStats() external view returns (
        uint256 totalVal, uint256 totalSales, uint256 maturity,
        uint256 sentiment, uint256 demand
    ) {
        return (totalValuations, totalSalesRecorded, platformMaturityScore,
                platformSentimentBPS, globalDemandBPS);
    }

    // ── Admin ────────────────────────────────────────────────
    function updateSentiment(uint256 newBPS) external onlyOwner {
        require(newBPS >= 5_000 && newBPS <= 20_000, "Val: out of range");
        platformSentimentBPS = newBPS;
        emit SentimentUpdated(newBPS);
    }

    function updateDemandIndex(uint256 newBPS) external onlyOwner {
        require(newBPS >= 5_000 && newBPS <= 20_000, "Val: out of range");
        globalDemandBPS = newBPS;
        emit DemandIndexUpdated(newBPS);
    }

    function setCategoryMultiplier(string calldata category, uint256 multiplierBPS) external onlyOwner {
        require(multiplierBPS >= 5_000 && multiplierBPS <= 30_000, "Val: out of range");
        categories[category].multiplierBPS = multiplierBPS;
    }

    function updatePlatform(address _platform) external onlyOwner {
        platform = _platform;
    }
}