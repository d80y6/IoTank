// supabase/functions/_shared/ForensicReportTemplate.ts

export function renderForensicReport(params: {
    stationName: string;
    periodDays: number;
    supportEmail: string;
    criticalAlerts: any[];
    telemetryStats: {
        avgVolume: number;
        connectivityScore: number;
        totalIncidents: number;
    };
    tanks: any[];
}) {
    const {
        stationName,
        periodDays,
        supportEmail,
        criticalAlerts,
        telemetryStats,
        tanks
    } = params;

    const alertRows = criticalAlerts.length > 0 
        ? criticalAlerts.map(alert => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
                    <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: bold; text-transform: uppercase;">${alert.severity}</span>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1e293b;">${alert.title}</td>
                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px;">${alert.message}</td>
                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px;">${new Date(alert.created_at).toLocaleDateString()}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="4" style="padding: 20px; text-align: center; color: #94a3b8;">No critical incidents detected in this window.</td></tr>';

    const tankRows = tanks.map(tank => `
        <div style="margin-bottom: 10px; padding: 10px; background: #f8fafc; border-radius: 8px; border-left: 4px solid ${tank.isOffline ? '#ef4444' : '#22c55e'};">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color: #334155;">${tank.name}</strong>
                <span style="font-size: 12px; color: ${tank.isOffline ? '#ef4444' : '#64748b'}; font-weight: bold;">
                    ${tank.isOffline ? 'OFFLINE' : 'ONLINE'}
                </span>
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
                Last Known: ${tank.currentVolume.toLocaleString()} L | Last Handshake: ${tank.lastSeen}
            </div>
        </div>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; margin: 0; padding: 0; background-color: #f1f5f9; }
        .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 40px 30px; color: #ffffff; position: relative; }
        .header-accent { position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899); }
        .badge { background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; display: inline-block; }
        .content { padding: 30px; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
        .stat-card { background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; text-align: center; }
        .stat-value { font-size: 20px; font-weight: 800; color: #0f172a; display: block; }
        .stat-label { font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 700; margin-top: 4px; }
        .section-title { font-size: 14px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; margin: 30px 0 15px 0; display: flex; align-items: center; }
        .section-title::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; margin-left: 15px; }
        .footer { background: #f8fafc; padding: 20px 30px; border-top: 1px solid #e2e8f0; text-align: center; }
        .btn { display: inline-block; background: #3b82f6; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 700; text-decoration: none; margin-top: 20px; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="badge">Forensic Analytics Report</span>
            <h1 style="margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.02em;">${stationName}</h1>
            <p style="margin: 8px 0 0 0; opacity: 0.8; font-size: 14px;">Operational Intelligence Window: Last ${periodDays} Days</p>
            <div class="header-accent"></div>
        </div>

        <div class="content">
            <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                <p style="margin: 0; font-size: 13px; color: #1e40af; font-weight: 500;">
                    <strong>Notice:</strong> This automated forensic report has been generated for system audit purposes. Please review the connectivity and severity logs below.
                </p>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <span class="stat-value">${telemetryStats.avgVolume.toLocaleString()}L</span>
                    <span class="stat-label">Avg. Inventory</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value" style="color: ${telemetryStats.connectivityScore > 80 ? '#16a34a' : '#dc2626'}">${telemetryStats.connectivityScore}%</span>
                    <span class="stat-label">Uptime Score</span>
                </div>
                <div class="stat-card">
                    <span class="stat-value" style="color: ${telemetryStats.totalIncidents > 0 ? '#dc2626' : '#16a34a'}">${telemetryStats.totalIncidents}</span>
                    <span class="stat-label">Total Incidents</span>
                </div>
            </div>

            <div class="section-title">Critical Severity Log</div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="text-align: left; background: #f8fafc;">
                        <th style="padding: 12px; font-size: 10px; color: #64748b; text-transform: uppercase;">Type</th>
                        <th style="padding: 12px; font-size: 10px; color: #64748b; text-transform: uppercase;">Issue</th>
                        <th style="padding: 12px; font-size: 10px; color: #64748b; text-transform: uppercase;">Details</th>
                        <th style="padding: 12px; font-size: 10px; color: #64748b; text-transform: uppercase;">Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${alertRows}
                </tbody>
            </table>

            <div class="section-title">Asset Health Summary</div>
            ${tankRows}

            <div style="text-align: center; margin-top: 40px;">
                <p style="font-size: 12px; color: #64748b;">Requires technical intervention? Contact our forensic team.</p>
                <a href="mailto:${supportEmail}" class="btn">Request Technical Support</a>
            </div>
        </div>

        <div class="footer">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em;">
                IoTank Operations Intelligence &copy; 2026
            </p>
            <p style="margin: 5px 0 0 0; font-size: 10px; color: #cbd5e1;">
                This is an automated system notification. For security purposes, do not share this report.
            </p>
        </div>
    </div>
</body>
</html>
    `;
}
