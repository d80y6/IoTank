export const renderSecurityEmail = (params: {
    type: 'THEFT' | 'LEAK' | 'COLLUSION' | 'SYSTEM_CRITICAL' | 'UNAUTHORIZED_REFILL' | 'REFILL' | 'DISCONNECT' | 'LOW_FUEL' | 'OVERFILL' | 'SHIFT_REPORT';
    siteName: string;
    tankName?: string;
    lossVolume?: number;
    dropRate?: number;
    varianceValue?: number;
    timestamp: string | number;
    details?: string;
    operator?: string;
    totalLiters?: number;
    totalSales?: number;
    duration?: string;
}) => {
    const isCritical = params.type === 'THEFT' || params.type === 'COLLUSION' || params.type === 'SYSTEM_CRITICAL' || params.type === 'UNAUTHORIZED_REFILL' || params.type === 'DISCONNECT';
    const accentColor = isCritical ? '#ef4444' : (params.type === 'REFILL' || params.type === 'SHIFT_REPORT' ? '#10b981' : '#f59e0b');
    const title = params.type === 'THEFT' ? 'SECURITY BREACH: THEFT DETECTED' : 
                  params.type === 'COLLUSION' ? 'SECURITY BREACH: COLLUSION SUSPECTED' : 
                  params.type === 'UNAUTHORIZED_REFILL' ? 'SECURITY BREACH: UNAUTHORIZED REFILL' :
                  params.type === 'REFILL' ? 'OPERATIONAL SUCCESS: REFILL DETECTED' :
                  params.type === 'DISCONNECT' ? 'CRITICAL ERROR: TANK DISCONNECTED' :
                  params.type === 'SYSTEM_CRITICAL' ? 'FORENSIC ALERT: 72HR SENSOR BLACKOUT' :
                  params.type === 'LOW_FUEL' ? 'LOGISTICS ALERT: LOW FUEL LEVEL' :
                  params.type === 'OVERFILL' ? 'SAFETY ALERT: TANK OVERFILL' :
                  params.type === 'SHIFT_REPORT' ? 'OPERATIONAL SUMMARY: SHIFT CLOSED' :
                  'MAINTENANCE ALERT: ANOMALY DETECTED';

    return `
    <div style="font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; border-radius: 16px; border: 1px solid #334155; max-width: 600px; margin: 0 auto;">
        <!-- Header -->
        <div style="background: ${accentColor}; color: white; padding: 12px 20px; border-radius: 8px; font-weight: 800; text-transform: uppercase; text-align: center; letter-spacing: 1px;">
            🛡️ IoTank Forensic Alert
        </div>

        <!-- Alert Title -->
        <h1 style="font-size: 22px; margin: 24px 0 8px; text-align: center; color: white;">${title}</h1>
        <p style="color: #94a3b8; margin: 0 0 24px; text-align: center;">Terminal: <b>${params.siteName}</b> | Resource: ${params.tankName || 'Facility'}</p>

        <!-- Stats Grid -->
        <div style="margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 16px; background: #1e293b; border-radius: 12px 0 0 12px; border: 1px solid #334155;">
                        <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">${params.type === 'SHIFT_REPORT' ? 'Liters Sold' : (params.type === 'SYSTEM_CRITICAL' ? 'Downtime' : 'Impact')}</span><br/>
                        <b style="font-size: 18px; color: ${accentColor};">${params.type === 'SHIFT_REPORT' ? `${params.totalLiters?.toFixed(1)}L` : (params.type === 'SYSTEM_CRITICAL' ? '72+ Hours' : (params.lossVolume ? `${params.lossVolume.toFixed(1)}L Change` : params.varianceValue ? `$${params.varianceValue.toFixed(2)} Volumetric Gap` : 'Potential Breach'))}</b>
                    </td>
                    <td style="padding: 16px; background: #1e293b; border-radius: 0 12px 12px 0; border: 1px solid #334155; border-left: 0;">
                        <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">${params.type === 'SHIFT_REPORT' ? 'Revenue' : 'Last Check-in'}</span><br/>
                        <b style="font-size: 14px;">${params.type === 'SHIFT_REPORT' ? `Ksh ${params.totalSales?.toLocaleString()}` : new Date(params.timestamp).toLocaleString()}</b>
                    </td>
                </tr>
            </table>
        </div>

        <!-- Intelligence Summary -->
        <div style="background: rgba(168, 85, 247, 0.05); border-left: 4px solid #a855f7; padding: 16px; margin-bottom: 32px; border-radius: 0 8px 8px 0;">
            <b style="color: #a855f7; display: block; margin-bottom: 4px;">Issue Context & Intelligence:</b>
            <span style="font-size: 14px; color: #cbd5e1; line-height: 1.5;">
                ${params.details ? `<strong style="color: #f8fafc;">Specific Issue: ${params.details}</strong><br/><br/>` : ''}
                ${params.type === 'THEFT' ? 'Rapid volumetric drawdown detected during zero-movement window (Shift Closed). Immediate verification of physical locks and pump status required.' : 
                  params.type === 'COLLUSION' ? 'Financial deficit exceeds 0.5% system error margin for this shift. Discrepancy between metered sales and ATG drawdown indicates possible internal manipulation.' : 
                  params.type === 'REFILL' ? 'Inbound fuel delivery successfully detected and verified against system expectations. Volume has been updated in the primary ledger.' :
                  params.type === 'UNAUTHORIZED_REFILL' ? 'Sudden volume increase detected during an unauthorized window or without a logged delivery ticket. Potential integrity breach or unlogged shipment.' :
                  params.type === 'DISCONNECT' ? 'Tank sensor has stopped reporting data for over 15 minutes. Check power supply, network link, and physical sensor integrity immediately.' :
                  params.type === 'SYSTEM_CRITICAL' ? '<b>CRITICAL SYSTEM FAILURE:</b> This terminal has been completely dark for over 3 consecutive days. This exceeds normal intermittent offline behavior and indicates a total power loss, hardware destruction, or network disconnection. Support has been notified.' :
                  params.type === 'LOW_FUEL' ? 'Tank level has dropped below the reorder threshold. Schedule fuel delivery to prevent air-lock in pumps and operational downtime.' :
                  params.type === 'OVERFILL' ? 'Tank level has reached a critical high point. Halt all delivery operations immediately to prevent environmental contamination and spill damage.' :
                  params.type === 'SHIFT_REPORT' ? `Operational cycle complete. Duration: <b>${params.duration || 'N/A'}</b>. Operator: <b>${params.operator || 'System'}</b>. Reconciliation variance: <b>Ksh ${params.varianceValue?.toFixed(2) || '0.00'}</b>.` :
                  'Persistent low-rate loss detected during quiet hours. Discrepancy matches leakage signature rather than operational draw. Schedule mechanical inspection.'}
            </span>
        </div>

        <!-- Call to Action -->
        <div style="text-align: center; margin-top: 32px;">
            <a href="https://iotank.app/operations/alerts" style="display: inline-block; background: #a855f7; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(168,85,247,0.3);">OPEN COMMAND CENTER</a>
        </div>

        <!-- Footer -->
        <hr style="border: 0; border-top: 1px solid #334155; margin: 40px 0 20px;"/>
        <p style="font-size: 11px; color: #64748b; text-align: center; line-height: 1.6;">
            This is an automated forensic report generated by the IoTank AI Grid.<br/>
            Ref ID: ${params.type.substring(0,3)}-${Math.floor(Math.random()*1000000)} • <a href="#" style="color: #64748b;">Manage Preferences</a>
        </p>
    </div>
    `;
};
