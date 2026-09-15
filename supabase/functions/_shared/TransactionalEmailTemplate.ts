export const renderTransactionalEmail = (params: {
    type: 'WELCOME' | 'INVITATION' | 'TRIAL_WELCOME' | 'BILLING_NOTICE' | 'SUSPENSION_WARNING';
    recipientName: string;
    stationName?: string;
    loginUrl: string;
    senderName?: string;
    trialEndDate?: string;
    billingAmount?: string;
    dueDate?: string;
}) => {
    const isInvite = params.type === 'INVITATION';
    const isTrial = params.type === 'TRIAL_WELCOME';
    const isBilling = params.type === 'BILLING_NOTICE';
    const isSuspension = params.type === 'SUSPENSION_WARNING';

    let title = 'Welcome to the IoTank AI Grid';
    let actionLabel = 'ACCESS DASHBOARD';
    let themeColor = '#6366f1'; // Indigo

    if (isInvite) {
        title = 'Team Invitation: IoTank Fuel Intelligence';
        actionLabel = 'ACCEPT INVITATION';
    } else if (isTrial) {
        title = '🚀 Your 14-Day Free Trial has Started';
        themeColor = '#10b981'; // Emerald
    } else if (isBilling) {
        title = '📊 Monthly Billing Statement';
        actionLabel = 'VIEW INVOICE';
    } else if (isSuspension) {
        title = '⚠️ CRITICAL: Service Suspension Warning';
        themeColor = '#ef4444'; // Red
        actionLabel = 'PAY NOW';
    }

    const renderMessage = () => {
        switch (params.type) {
            case 'INVITATION':
                return `<b>${params.senderName || 'An administrator'}</b> has invited you to join the team at <b>${params.stationName}</b>. You will have access to real-time telemetry, forensic monitoring, and automated fuel logistics.`;
            case 'TRIAL_WELCOME':
                return `Your station <b>${params.stationName}</b> is now active on a <b>14-day free trial</b>. Explore full forensic monitoring and AI analytics until <b>${params.trialEndDate}</b>.<br/><br/>After the trial, your monthly subscription of Ksh 5,000 will begin.`;
            case 'BILLING_NOTICE':
                return `Your monthly billing statement for <b>${params.stationName}</b> is ready. The total amount due is <b>${params.billingAmount}</b>. Please ensure payment is made by <b>${params.dueDate}</b> to maintain uninterrupted service.`;
            case 'SUSPENSION_WARNING':
                return `Your account <b>${params.stationName}</b> has an outstanding balance that is more than 5 days overdue. <b>Failure to pay immediately will result in hardware signal suspension and dashboard lockout.</b>`;
            default:
                return `Your registration for <b>${params.stationName}</b> has been approved. You now have full access to the most advanced fuel monitoring grid in the region.`;
        }
    };

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet">
    </head>
    <body style="margin: 0; padding: 0; background-color: #020617; font-family: 'Inter', -apple-system, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #020617; padding: 40px 20px;">
            <tr>
                <td align="center">
                    <div style="max-width: 600px; width: 100%; text-align: left;">
                        <!-- Logo / Brand Bar -->
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                            <tr>
                                <td>
                                    <div style="display: inline-block; background: linear-gradient(135deg, ${themeColor} 0%, #a855f7 100%); padding: 8px 16px; border-radius: 12px; font-weight: 800; font-size: 14px; color: white; letter-spacing: 1.5px; text-transform: uppercase;">
                                        IOTANK V2.0
                                    </div>
                                </td>
                                <td align="right">
                                    <div style="font-size: 10px; color: #64748b; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">
                                        Forensic Verification System
                                    </div>
                                </td>
                            </tr>
                        </table>

                        <!-- Main Content Card -->
                        <div style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                            <!-- Header Accent -->
                            <div style="height: 4px; background: linear-gradient(90deg, ${themeColor} 0%, #a855f7 100%);"></div>
                            
                            <div style="padding: 48px 40px;">
                                <!-- Icon / State Indicator -->
                                <div style="margin-bottom: 32px; font-size: 48px;">
                                    ${isTrial ? '🚀' : isSuspension ? '⚠️' : isBilling ? '📊' : '🛡️'}
                                </div>

                                <h1 style="color: #ffffff; font-size: 28px; font-weight: 800; line-height: 1.2; margin: 0 0 16px;">
                                    ${title}
                                </h1>
                                
                                <p style="color: #94a3b8; font-size: 16px; margin: 0 0 32px;">
                                    Hello ${params.recipientName},
                                </p>

                                <!-- Glassmorphism Message Box -->
                                <div style="background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 16px; padding: 32px; margin-bottom: 40px;">
                                    <div style="color: #f1f5f9; font-size: 17px; line-height: 1.7; font-weight: 400;">
                                        ${renderMessage()}
                                    </div>
                                    
                                    ${isBilling || isTrial ? `
                                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 24px; border-top: 1px solid rgba(51, 65, 85, 0.5); padding-top: 24px;">
                                        <tr>
                                            <td style="color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                                                ${isTrial ? 'Trial End Date' : 'Amount Due'}
                                            </td>
                                            <td align="right" style="color: #ffffff; font-size: 14px; font-weight: 700; font-family: 'Inter', monospace;">
                                                ${isTrial ? params.trialEndDate : params.billingAmount}
                                            </td>
                                        </tr>
                                    </table>
                                    ` : ''}
                                </div>

                                <!-- CTA -->
                                <div style="text-align: center;">
                                    <a href="${params.loginUrl}" style="display: inline-block; background: ${themeColor}; color: #ffffff; padding: 18px 48px; border-radius: 12px; font-weight: 700; font-size: 16px; text-decoration: none; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); transition: all 0.2s ease;">
                                        ${actionLabel}
                                    </a>
                                </div>
                            </div>

                            <!-- Footer Stats/Meta -->
                            <div style="background-color: #020617; padding: 24px 40px; border-top: 1px solid #1e293b;">
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td style="color: #475569; font-size: 11px;">
                                            Ref ID: ${Math.random().toString(36).substring(7).toUpperCase()}<br/>
                                            Auth Level: Tier 1 • Forensic Primary
                                        </td>
                                        <td align="right" style="color: #475569; font-size: 11px;">
                                            © 2026 IoTank Intelligence<br/>
                                            Nairobi • Cloud Operations
                                        </td>
                                    </tr>
                                </table>
                            </div>
                        </div>

                        <!-- Unsubscribe / Compliance -->
                        <div style="padding: 32px 20px; text-align: center;">
                            <p style="color: #334155; font-size: 12px; line-height: 1.5;">
                                This is a mandatory transactional alert regarding your IoTank subscription.<br/>
                                Security managed by <b>IoTank Shield AI</b>
                            </p>
                        </div>
                    </div>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
};

