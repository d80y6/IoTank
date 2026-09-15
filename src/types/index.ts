/* eslint-disable @typescript-eslint/no-explicit-any */
// TypeScript interfaces for IoTank data structures

export interface FuelTransaction {
    id: string;
    type: 'delivery' | 'reconciliation' | 'adjustment' | 'loss' | 'sale' | 'purchase';
    tankId: string;
    amount: number; // Volume in liters
    timestamp: any;
    performedBy: string;
    metadata?: {
        atgVolume?: number;
        physicalVolume?: number;
        variance?: number;
        notes?: string;
        deliveryTicketId?: string;
        pricePerLiter?: number;
        totalCost?: number;
        temperature?: number;
        varianceStatus?: 'MATCH' | 'WARNING' | 'CRITICAL';
        thermalVariance?: number;
    };
}

export interface TankReading {
    id: string;
    tankId: string;
    timestamp: number;
    temperature: number; // Celsius
    volume: number;      // Liters (Measured)
    fuelLevel: number;   // Percentage (0-100)
    volumeCorrected: number; // Standardized volume
    signalQuality: string | number; // Percentage (0-100) or Text Label
    rssi: number;        // Signal strength (dBm)
    deviceId: string;    // ESP32 unique identifier
    processingLocation: 'edge' | 'cloud';
    metadata?: any;
}

export type TankState = 'idle' | 'dispensing' | 'delivery' | 'leak_suspicion' | 'rapid_defill' | 'offline';

export interface Tank {
    id: string;
    stationId: string;
    siteId: string;
    name: string;
    location: string;
    capacity: number; // Total capacity in liters
    fuelType: 'diesel' | 'petrol' | 'kerosene' | 'lpg' | 'jet_fuel' | 'biodiesel';
    shape: 'cylinder' | 'rectangular' | 'capsule' | 'spherical' | 'compartmentalized';
    height: number;      // meters (as stored in DB: tank_height column)
    diameter?: number;   // meters (for cylinder/capsule, derived from tank_radius * 2)
    length?: number;     // meters (for horizontal/capsule)

    // Alert thresholds
    lowLevelThreshold: number; // Percentage (e.g., 20%)
    highLevelThreshold: number; // Percentage (e.g., 90%)
    criticalLevelThreshold: number; // Percentage (e.g., 10%)
    rapidDefillThreshold: number; // L/hr
    leakageThreshold: number;     // L/hr
    temperatureAlertThreshold: number; // Celsius
    leakDetectionSensitivity: number; // Percentage drop per hour (legacy)
    thermalCoefficient: number; // α for thermal expansion (per °C)
    density: number; // kg/L at 15.5°C
    sensorOffset: number; // Calibration offset in mm (as stored in DB: sensor_offset column)
    sensorHeight: number; // Sensor installation height from tank bottom (mm)
    sensorEmptyDistance?: number; // Distance sensor reads when tank is EMPTY (mm)
    sensorFullDistance?: number;  // Distance sensor reads when tank is FULL (mm)

    // State (Last known values)
    currentVolume?: number;
    lastReading?: number;
    currentState?: TankState;
    leakProbability?: number; // 0-100
    telemetryIntegrity?: number; // 0-100

    // Metadata
    installationYear?: number;
    sensorId?: string;
    sensorChannel?: number; // 1-4
    createdAt: number;
    updatedAt: number;
    isActive: boolean;
    metadata?: any;
    lastMaintenanceDate?: number;
    lastCalibrationDate?: number;
    lastConfigUpdate?: number;
    thresholds?: Record<string, any>; // For custom temperature thresholds etc.
    esp32Address?: string; // ESP32 board address/serial
}

export interface FuelStation {
    id: string;
    name: string;
    industry: string;
    country: string;
    region: string; // For data sovereignty
    contactEmail: string;
    createdAt: number;
    subscriptionTier: 'basic' | 'professional' | 'enterprise' | 'standard';
}

export interface Site {
    id: string;
    stationId: string;
    siteName: string;
    address: string;
    gpsCoordinates: {
        latitude: number;
        longitude: number;
    };
    tankCount: number;
    managerName?: string;
    contactPhone?: string;
    uid?: string;
}

export type AlertState = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'ESCALATED';
export type AlertSeverityLabel = 'INFO' | 'WATCH' | 'HIGH' | 'CRITICAL';

export interface Alert {
    id: string;
    tankId?: string;
    siteId?: string;
    type: 'leak' | 'theft' | 'theft_detected' | 'leak_detected' | 'overfill' | 'low_level' | 'low_level_critical' | 'low_level_warning' | 'high_temperature' | 'sensor_failure' | 'anomaly' | 'refill' | 'refill_detected' | 'unauthorized_refill' | 'connectivity_lost' | 'market_news' | 'regulatory_update' | 'delivery' | 'delivery_variance' | 'telemetry_gap' | 'compliance_deadline' | 'composite' | 'info';
    severity: 'info' | 'warning' | 'critical';
    severityLabel?: AlertSeverityLabel;  // INFO | WATCH | HIGH | CRITICAL
    score?: number;            // 0-100 calculated severity score
    state?: AlertState;        // ACTIVE | ACKNOWLEDGED | RESOLVED | ESCALATED
    // Title & detail (new structure)
    title?: string;            // Headline, e.g. "Gasoline Super below critical threshold"
    description?: string;      // Detail, e.g. "Level at 9.8%. Predicted depletion 12h."
    message: string;           // Legacy field kept for compat
    source?: 'system' | 'user' | 'ai';
    aiConfidence?: number;     // 0-1
    detectionMethod: 'deterministic' | 'ai-assisted';
    evidence?: {
        dataPoints: TankReading[];
        aiConfidence?: number;
        aiExplanation?: string;
    };
    timestamp: number;
    acknowledgedBy?: string;
    acknowledgedAt?: number;
    escalatedAt?: number;
    resolved: boolean;
    resolvedAt?: number;
    resolvedBy?: string;
    // Correlation
    correlatedAlertIds?: string[];  // IDs of grouped child alerts
    isComposite?: boolean;
    // Investigation link
    rootCauseLink?: {
        type: 'tank' | 'delivery' | 'shift' | 'event';
        id: string;
        label?: string;
    };
    metadata?: {
        volumeBefore?: number;
        volumeAfter?: number;
        deliveredVolume?: number;
        expectedVolume?: number;
        awaitingVerification?: boolean;
        atgVolume?: number;
        startVolume?: number;
        endVolume?: number;
        currVol?: number;
        volumeIncrease?: number;
        tankCapacity?: number;
        startTimestamp?: number;
        endTimestamp?: number;
        endTemperature?: number | null;
        detectedAt?: string;
        type?: string;
        // Escalation ladder
        escalationLevel?: 1 | 2 | 3;  // 1=supervisor, 2=manager, 3=governance
        telemetryGapMinutes?: number;
        deliveryVariancePct?: number;
        lossVolume?: number;
        dropRate?: number;
        suspectedType?: 'theft' | 'leak';
        // Market/Price
        oldPrice?: number;
        newPrice?: number;
        priceDiff?: number;
        // Shift/Forensic
        nodeId?: string;
        openedBy?: any;
        closing_volume?: number;
        tankName?: string;
        maxPumpFlow?: number;
        volumeLost?: number;
        // Correlation
        correlatedCount?: number;
        correlatedIds?: string[];
        correlatedTypes?: string[];
    };
}

export interface MarketData {
    id: string;
    fuelType: string;
    region: string;
    pricePerLiter: number;
    currency: string;
    timestamp: number;
    source: 'platts' | 'argus' | 'bloomberg' | 'eia' | 'mock' | 'epra' | 'api';
    volatilityIndex?: number;
    effective_date?: string;
    metadata?: any;
}

export type SignalSourceType = 'API' | 'Public Notice' | 'Corporate Announcement' | 'News Outlet' | 'Commodity' | 'Operational Alert' | 'Price Impact' | 'Supply Chain' | 'Regulatory' | 'General News';

export interface MarketSignal {
    id: string;
    type?: 'market' | 'logistics' | 'regulatory' | 'corporate';
    source?: string;
    sourceType?: SignalSourceType;
    title: string;
    summary: string;
    timestamp: number;
    relevanceScore?: number; // 0-1 (e.g., 0.9 for direct EPRA notice)
    confidenceScore?: number; // 0-1
    externalUrl?: string; // Link to authoritative source
    attribution?: string; // e.g., "Kenya Ports Authority", "Daily Nation"
    priority?: number; // 1-3
    metadata?: Record<string, any>;
}

export interface MarketActionItem {
    id: string;
    stationId: string;
    fuelType: string;
    oldPrice: number | null;
    newPrice: number;
    effectiveDate: string;
    actionType: 'price_adjustment' | 'procurement_hedge' | 'compliance_review';
    status: 'pending' | 'completed' | 'ignored';
    metadata: {
        source_url?: string;
        signal_id?: string;
        variance?: number;
    };
    createdAt: string;
    updatedAt: string;
}

export interface SupplyRisk {
    id: string;
    category: 'port' | 'pipeline' | 'omc' | 'weather'; // Port congestion, KPC flows, OMC outages
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    affectedRegions: string[];
    timestamp: number;
    source: string;
}

export interface RegulatoryNotice {
    id: string;
    authority: 'EPRA' | 'KRA' | 'NEMA' | 'MOT';
    noticeType: 'price_cycle' | 'tax_adjustment' | 'safety_mandate' | 'environmental';
    title: string;
    effectiveDate: number;
    summary: string;
    documentUrl?: string;
}

export interface GeminiInsight {
    id: string;
    type: 'forecast' | 'anomaly' | 'procurement' | 'maintenance' | 'sustainability';
    tankId?: string;
    title: string; // Strategic title
    summary: string; // Concise summary
    recommendation: string; // Actionable advice
    prompt: string;
    response: string; // Raw LLM response
    structuredData?: any;
    confidence: number;
    timestamp: number;
    modelVersion: string;
    supportingData?: any; // Charts/Evidence
    userFeedback?: 'positive' | 'negative';
    feedbackComment?: string;
}

export interface UserPreferences {
    authUserId: string;
    theme: 'light' | 'dark' | 'auto';
    colorblindMode: 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
    language: 'en' | 'es' | 'fr' | 'de' | 'sw';
    units: {
        volume: 'liters' | 'gallons';
        temperature: 'celsius' | 'fahrenheit';
        distance: 'metric' | 'imperial';
    };
    currency: 'USD' | 'EUR' | 'KES' | 'GBP';
    dashboardLayout?: GridLayout[];
    notifications: {
        email: boolean;
        push: boolean;
        sms: boolean;
        alertTypes: Alert['type'][];
    };
}

export interface GridLayout {
    i: string; // Widget ID
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface User {
    authUserId: string;
    email: string;
    displayName?: string;
    photoURL?: string;
    /**
     * Level 8: viewer        = Read-only analyst/auditor (Minimum Portal Level)
     * Level 7: operator      = Station Operator (monitor-only, assigned tanks)
     * Level 6: supervisor    = Station Supervisor (operational tasks, no billing/users)
     * Level 5: admin         = Station Admin (full control of their station)
     * 
     * Level 4: Global Auditor = Governance read-only compliance
     * Level 3: Global Support = Governance incident response / troubleshooting
     * Level 2: Global Ops     = Governance deployment / infrastructure control
     * Level 1: Global Apex    = Governance full system sovereignty
     */
    role: 'admin' | 'owner' | 'supervisor' | 'operator' | 'viewer';
    authLevel: number;
    stationId: string;
    companyName?: string;
    logoUrl?: string;
    address?: {
        street: string;
        unit?: string;
        city: string;
        state: string;
        zip: string;
    };
    phoneNumber?: string;
    siteIds: string[]; // Sites user has access to
    mfaEnabled: boolean;
    securityPinEnabled?: boolean;
    isSystemAccount?: boolean;
    stationEmail?: string;
    isProvisional?: boolean;
    /** @deprecated Use re-authentication with login password instead */
    masterAccessPassword?: string;
    createdAt: number;
    lastLoginAt: number;
}


export interface Report {
    id: string;
    name: string;
    type: 'inventory' | 'compliance' | 'financial' | 'environmental' | 'custom';
    stationId: string;
    siteIds?: string[];
    tankIds?: string[];
    dateRange: {
        start: number;
        end: number;
    };
    widgets: ReportWidget[];
    scheduledExecution?: {
        frequency: 'daily' | 'weekly' | 'monthly';
        recipientEmails: string[];
    };
    createdBy: string;
    createdAt: number;
    lastGeneratedAt?: number;
}

export interface ReportWidget {
    id: string;
    type: 'summary' | 'chart' | 'table' | 'compliance-statement' | 'ai-insight';
    title: string;
    dataSource: string;
    configuration: any;
}

// File Analysis Types
export interface FileUpload {
    id: string;
    fileName: string;
    fileType: 'csv' | 'pdf';
    fileSize: number;
    storageUrl: string;
    publicUrl?: string;
    uploadedBy: string;
    uploadedAt: number;
    stationId: string;
    analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
    errorMessage?: string;
}

export interface CSVAnalysisResult {
    id: string;
    fileId: string;
    analysisType: 'fuel-consumption' | 'inventory' | 'sensor-logs' | 'market-data' | 'general';
    summary: string;
    insights: string[];
    dataQuality: {
        completeness: number; // 0-100
        accuracy: number; // 0-100
        issues: string[];
    };
    keyMetrics: Record<string, any>;
    recommendations: string[];
    visualizations?: {
        type: 'chart' | 'table' | 'heatmap';
        data: any;
    }[];
    timestamp: number;
    confidence: number; // 0-1
}

export interface PDFAnalysisResult {
    id: string;
    fileId: string;
    analysisType: 'invoice' | 'compliance' | 'regulatory' | 'maintenance' | 'general';
    documentType: string;
    extractedData: Record<string, any>;
    summary: string;
    keyFindings: string[];
    actionItems: string[];
    entities?: {
        dates: string[];
        amounts: number[];
        organizations: string[];
        locations: string[];
    };
    timestamp: number;
    confidence: number; // 0-1
}

export interface AnalysisHistory {
    id: string;
    fileUpload: FileUpload;
    result: CSVAnalysisResult | PDFAnalysisResult;
    createdAt: number;
}

// Utility types
export type ThemeMode = 'light' | 'dark';
export type ColorBlindMode = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
/**
 * Client-layer role hierarchy:
 * Level 5: admin         = Station Admin
 * Level 6: supervisor    = Station Supervisor
 * Level 7: operator      = Station Operator
 * Level 8: viewer        = Read-only access (Minimum)
 * 
 * Governance-layer hierarchy: 1 (Apex) to 4 (Auditor)
 */
export type UserRole = 'admin' | 'owner' | 'supervisor' | 'operator' | 'viewer';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export type ProcessingLocation = 'edge' | 'cloud';
export type CSVAnalysisCategory = 'fuel-consumption' | 'inventory' | 'sensor-logs' | 'market-data' | 'general';
export type PDFAnalysisCategory = 'invoice' | 'compliance' | 'regulatory' | 'maintenance' | 'general';

// Risk Index for executive summary
export interface RiskIndex {
    fuel: { score: number; label: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' };
    system: { score: number; label: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' };
    compliance: { score: number; label: 'STABLE' | 'WATCH' | 'AT_RISK' };
}

// --- Shift Management Types (New Schema) ---

export interface ShiftPumpReading {
    start: number;
    end: number;
}

export interface ShiftDocument {
    id: string; // Document ID: shiftId
    openedAt: string; // ISO String
    closedAt: string; // ISO String
    durationMin: number;
    siteId: string;
    nodeId: string;
    tankId: string;

    pumpReadings: Record<string, ShiftPumpReading>; // e.g., { p1: { start: 125000, end: 125420 } }
    volumeSoldLiters: number;

    expected: { cash: number; mpesa: number; pos: number; total: number };
    received: { cash: number; mpesa: number; pos: number; total: number; spending: number };
    variance: { amount: number; pct: number };

    status: 'BALANCED' | 'SHORT' | 'OVER' | 'NEEDS_REVIEW';
    reviewState: 'OPEN' | 'CLOSED' | 'APPROVED';

    openedBy: { authUserId: string; display: string };
    closedBy: { authUserId: string; display: string };
    closingVolume: number; // Tank volume at closure
    notes: string;
    createdAt: string; // ISO String

    // Forensic Fields (Optional for backward compatibility)
    received_collections?: any;
    variance_data?: any;
    operatorName?: string;
    operation_type?: string;
}


// --- Delivery Types (New Schema) ---

export interface DeliveryDocument {
    id: string; // Document ID: deliveryId
    ts: string; // ISO String
    ts_day: string; // YYYY-MM-DD
    siteId: string;
    nodeId: string;
    tankId: string;
    product: string;
    supplier: string;
    invoiceNo: string;
    invoiceLiters: number;

    measured: {
        observedLiters: number;
        standardizedLiters: number;
        tempC: number;
        refTempC: number;
    };

    before: { pct: number; litersStd: number };
    after: { pct: number; litersStd: number };
    variance: { liters: number; pct: number };

    status: 'VERIFIED' | 'NEEDS_REVIEW' | 'DISPUTED';
    verified: boolean;

    createdBy: { kind: 'user' | 'system'; authUserId: string; display: string };
    createdAt: string; // ISO String
    notes?: string;
    bolPhotoUrl?: string;
}

export interface FuelOrder {
    id: string;
    orderRef: string;
    supplier: string;
    product: string;
    quantity: number;
    expectedDate: string;
    status: string;
    priority: string;
    actorEmail: string;
    createdAt: string;
    notes?: string;
}

// --- Lightweight Workflow Types (Legacy) ---

export interface LossReview {
    id: string;
    date: string; // YYYY-MM-DD
    stationId: string;
    varianceLiters: number;
    selectedCause: 'Delivery Adjustment' | 'Shift ReconciliationGap' | 'Meter Calibration' | 'Tank Temperature Shift' | 'Suspected Leak' | 'Unknown';
    explanation?: string;
    photoUrl?: string;
    reviewedBy: string; // User ID
    timestamp: number;
}

// --- Support & Ticketing Types ---

export type SupportCategory =
    | 'telemetry_offline'
    | 'calibration_drift'
    | 'billing_subscription'
    | 'ai_forecasting'
    | 'user_access'
    | 'compliance_reporting'
    | 'other';

export type SupportSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SupportMessage {
    ts: string;
    sender: 'user' | 'agent' | 'system';
    text: string;
}

export interface SupportTicket {
    id: string;
    stationId: string;
    authUserId: string;
    ts: string;
    category: SupportCategory;
    severity: SupportSeverity;
    siteId?: string;
    tankId?: string;
    status: 'open' | 'in_progress' | 'waiting_on_user' | 'resolved' | 'closed';
    assignedTo: string | null;
    description: string;
    messages: SupportMessage[];
    systemSnapshot?: {
        nodesOnline: string; // e.g. "2/2"
        firmwareVersion: string;
        lastEvents: string[];
        errorLogs: string[];
        tankLevels?: Record<string, number>;
    };
}
