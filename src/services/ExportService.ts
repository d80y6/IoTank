/* eslint-disable @typescript-eslint/no-explicit-any */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { THRESHOLDS } from '@/constants/forensicThresholds';

interface jsPDFWithAutoTable extends jsPDF {
    lastAutoTable?: { finalY: number };
}

/** Daily snapshot type for compliance pack generation (L-06: replaces any[]) */
export interface DailyLog {
    date: string;
    opening?: number;
    deliveries?: number;
    sales?: number;
    closing?: number;
}

/**
 * Core Export Service for client-side PDF and CSV generation.
 * Spark-plan safe (zero functions required).
 */
export class ExportService {

    // --- UTILITIES ---

    /**
     * Helper to trigger a browser file download
     */
    private static downloadFile(content: BlobPart, filename: string, type: string) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Converts an array of objects to CSV format and downloads it
     */
    public static exportToCSV(data: any[], filename: string) {
        if (!data || data.length === 0) return;

        // Get headers from the first object
        const headers = Object.keys(data[0]);

        // Escape and format rows
        const rows = data.map(row => {
            return headers.map(header => {
                let cell = row[header] === null || row[header] === undefined ? '' : String(row[header]);
                // Wrap in quotes if it contains commas, quotes, or newlines
                if (cell.search(/("|,|\n)/g) >= 0) {
                    cell = `"${cell.replace(/"/g, '""')}"`;
                }
                return cell;
            }).join(',');
        });

        const csvContent = [
            headers.join(','),
            ...rows
        ].join('\n');

        this.downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
    }

    // --- REPORT GENERATORS ---

    /**
     * Generates a generic PDF report from tabulated data
     */
    public static generateGenericPDF(
        title: string,
        organizationName: string,
        headers: string[],
        data: (string | number)[][],
        summaryData?: Record<string, string | number>
    ) {
        const doc = new jsPDF() as jsPDFWithAutoTable;
        const generatedDate = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

        // Document Header
        doc.setFontSize(22);
        doc.setTextColor(40, 40, 40);
        doc.text(title, 14, 20);

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(organizationName, 14, 28);
        doc.text(`Generated: ${generatedDate}`, 14, 33);

        doc.setDrawColor(200, 200, 200);
        doc.line(14, 38, 196, 38);

        let currentY = 45;

        // Optional Summary Section
        if (summaryData && Object.keys(summaryData).length > 0) {
            doc.setFontSize(14);
            doc.setTextColor(60, 60, 60);
            doc.text('Report Summary', 14, currentY);

            const summaryBody = Object.entries(summaryData).map(([key, value]) => [key, value]);

            autoTable(doc, {
                startY: currentY + 5,
                body: summaryBody,
                theme: 'plain',
                styles: { fontSize: 10, cellPadding: 3 },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 60 },
                    1: { cellWidth: 'auto' }
                }
            });

            currentY = (doc.lastAutoTable?.finalY || currentY) + 15;
        }

        // Main Data Table
        if (data && data.length > 0) {
            autoTable(doc, {
                startY: currentY,
                head: [headers],
                body: data,
                headStyles: { fillColor: [41, 128, 185], textColor: 255 },
                alternateRowStyles: { fillColor: [245, 245, 245] },
                styles: { fontSize: 9 }
            });
        }

        // Footer Pagination
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text('IoTank Reporting Engine - ' + organizationName, 14, 285);
            doc.text(`Page ${i} of ${pageCount}`, 185, 285);
        }

        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        doc.save(`${safeTitle}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    }

    /**
     * Generates a stylized EPRA Compliance Pack PDF
     */
    public static generateCompliancePack(
        orgName: string,
        userName: string,
        period: { start: string; end: string },
        summaryMetrics: {
            totalThroughput: number;
            totalDeliveries: number;
            averageVariancePct: number;
            incidents: number;
        },
        dailyLogs: any[] // Would be strongly typed in prod
    ) {
        const doc = new jsPDF() as jsPDFWithAutoTable;

        // Header (EPRA style, rigorous)
        doc.setFontSize(24);
        doc.setTextColor(30, 58, 138); // Deep blue
        doc.text('EPRA Compliance Pack', 14, 25);

        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        doc.text(`Digital Witness: ${userName}`, 14, 30);

        doc.setFontSize(12);
        doc.setTextColor(71, 85, 105);
        doc.text('90-Day Inventory & Reconciliation Log', 14, 33);

        doc.setFontSize(10);
        doc.text(`Organization: ${orgName}`, 14, 42);
        doc.text(`Period: ${period.start} to ${period.end}`, 14, 47);
        doc.text(`Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`, 14, 52);

        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(14, 58, 196, 58);

        // Core Metrics
        doc.setFontSize(14);
        doc.setTextColor(51, 65, 85);
        doc.text('Facility Overview', 14, 70);

        const metricsData = [
            ['Total Throughput (90 Days)', `${summaryMetrics.totalThroughput.toLocaleString()} L`],
            ['Verified Deliveries', summaryMetrics.totalDeliveries.toString()],
            ['Average Variance', `${summaryMetrics.averageVariancePct.toFixed(2)}%`],
            ['Recorded Exceptions', summaryMetrics.incidents.toString()]
        ];

        autoTable(doc, {
            startY: 75,
            body: metricsData,
            theme: 'striped',
            headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105] },
            styles: { fontSize: 10, cellPadding: 4 },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 80 }
            }
        });

        // Daily Logs Table
        const logStartY = (doc.lastAutoTable?.finalY || 80) + 15;
        doc.setFontSize(14);
        doc.text('Daily Operations Log', 14, logStartY);

        if (dailyLogs.length > 0) {
            const headers = ['Date', 'Opening', 'Refills', 'Sales', 'Theoretical', 'Actual', 'Var (L)', 'Var (%)'];
            const rows = dailyLogs.map(log => {
                const theoretical = (log.opening || 0) + (log.deliveries || 0) - (log.sales || 0);
                const actual = log.closing || 0;
                const variance = actual - theoretical;
                const totalThroughput = (log.sales || 0) + (log.deliveries || 0);
                const variancePct = totalThroughput > 0 ? (variance / totalThroughput) * 100 : 0;

                return [
                    log.date,
                    (log.opening || 0).toFixed(0),
                    (log.deliveries || 0).toFixed(0),
                    (log.sales || 0).toFixed(0),
                    theoretical.toFixed(0),
                    actual.toFixed(0),
                    variance.toFixed(1),
                    variancePct.toFixed(2) + '%'
                ];
            });

            autoTable(doc, {
                startY: logStartY + 5,
                head: [headers],
                body: rows,
                theme: 'grid',
                headStyles: { fillColor: [30, 58, 138], textColor: 255 },
                styles: { fontSize: 8, cellPadding: 2 }
            });
        } else {
            doc.setFontSize(10);
            doc.setTextColor(148, 163, 184);
            doc.text('No log entries found for this period.', 14, logStartY + 10);
        }

        // Pagination
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text('Official Document - IoTank Compliance Engine', 14, 285);
            doc.text(`Page ${i} of ${pageCount}`, 185, 285);
        }

        doc.save(`EPRA_Report_${orgName.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);
    }

    /**
     * RECONSTRUCTION: Rebuilds a report from stored forensic data
     */
    public static reconstructReport(
        reportName: string,
        orgName: string,
        data: any,
        fmt: 'PDF' | 'CSV' | 'Excel' | 'ZIP'
    ) {
        if (fmt === 'PDF') {
            // Specialized reconstruction for Compliance Packs
            if (reportName.includes('Compliance')) {
                this.generateCompliancePack(
                    orgName,
                    data.generated_by || 'FORENSIC_RECON',
                    { start: data.window?.split(' → ')[0] || 'Unknown', end: data.window?.split(' → ')[1] || 'Unknown' },
                    { 
                        totalThroughput: data.metrics?.totalThroughput || 0, 
                        totalDeliveries: data.metrics?.totalDeliveries || 0,
                        averageVariancePct: data.metrics?.avgVariancePct || 0,
                        incidents: data.metrics?.incidentCount || 0
                    },
                    data.logs || []
                );
            } else {
                // Generalized Forensic PDF reconstruction
                const headers = ['Date', 'Theoretical', 'Actual', 'Variance (L)', 'Variance (%)'];
                const body = (data.logs || []).map((l: any) => [
                    l.date,
                    l.theoretical?.toFixed(1) || '0.0',
                    l.closing?.toFixed(1) || '0.0',
                    l.variance?.toFixed(1) || '0.0',
                    (l.variancePct?.toFixed(2) || '0.00') + '%'
                ]);

                this.generateGenericPDF(
                    reportName,
                    orgName,
                    headers,
                    body,
                    { 
                        'Period': data.window || 'Unknown',
                        'Total Throughput': `${(data.metrics?.totalThroughput || 0).toLocaleString()} L`,
                        'Net Variance': `${(data.metrics?.netVariance || 0).toFixed(1)} L`,
                        'Avg Variance %': `${(data.metrics?.avgVariancePct || 0).toFixed(2)}%`
                    }
                );
            }
        } else if (fmt === 'CSV') {
            const exportData = data.logs || (data.metrics ? [data.metrics] : [data]);
            this.exportToCSV(exportData, reportName.replace(/\s+/g, '_').toLowerCase());
        }
    }

    /**
     * PREMIUM: Generates a high-fidelity Delivery Verification Audit PDF (Amethyst Theme)
     */
    public static generateDeliveryAuditPDF(
        delivery: any,
        orgName: string,
        userName: string
    ) {
        const doc = new jsPDF() as jsPDFWithAutoTable;
        const now = new Date();
        const dateStr = format(now, 'dd MMM yyyy, HH:mm');
        const isDisputed = delivery.status === 'DISPUTED' || (delivery.variance && Math.abs(delivery.variance) > THRESHOLDS.FORENSICS.DELIVERY_VARIANCE_TOLERANCE_L);

        // --- BRANDING & HEADER ---
        // Top accent bar (Amethyst Tint)
        doc.setFillColor(99, 102, 241); // Indigo-ish (Amethyst Primary)
        doc.rect(0, 0, 210, 15, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.setTextColor(30, 41, 59);
        doc.text('Delivery Verification Audit', 14, 30);

        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('OFFICIAL TAMPER-EVIDENT DOCUMENT', 14, 36);

        // Header Metadata Box
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(14, 42, 182, 25, 3, 3, 'FD');

        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text('ORGANIZATION', 20, 50);
        doc.text('GENERATED BY', 80, 50);
        doc.text('TIMESTAMP', 140, 50);

        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'bold');
        doc.text(orgName, 20, 57);
        doc.text(userName, 80, 57);
        doc.text(dateStr, 140, 57);

        // --- HERO METRICS (VARIANCE CARD) ---
        const statusColor = isDisputed ? [239, 68, 68] : [16, 185, 129];
        doc.setDrawColor(statusColor[0], statusColor[1], statusColor[2]);
        doc.setFillColor(isDisputed ? 254 : 240, isDisputed ? 242 : 253, isDisputed ? 242 : 249);
        doc.roundedRect(14, 75, 182, 40, 4, 4, 'FD');

        doc.setFontSize(11);
        doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
        doc.text('AUDIT RESULT:', 20, 85);
        
        doc.setFontSize(28);
        doc.text(isDisputed ? 'DISCREPANCY DETECTED' : 'VERIFIED MATCH', 20, 100);

        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(`Variance: ${delivery.variance || 0} Litres`, 140, 100);

        // --- FORENSIC DATA TABLE ---
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text('Forensic Evidence Log', 14, 130);

        const forensicData = [
            ['Waybill / Invoice Volume', `${(delivery.invoiceLiters || 0).toLocaleString()} L`],
            ['System Measured Volume', `${(delivery.measuredStandardized || 0).toLocaleString()} L`],
            ['Variance (Physical vs Digital)', `${delivery.variance || 0} L`],
            ['Delivery Temperature', `${delivery.deliveryTemp || 'N/A'} °C`],
            ['Physical Dip Check', `${delivery.physicalDip || 'N/A'} L`],
            ['Supplier Reported Status', delivery.supplierStatus || 'Confirmed Full'],
            ['Audit Status', delivery.status || 'VERIFIED']
        ];

        autoTable(doc, {
            startY: 135,
            body: forensicData,
            theme: 'striped',
            styles: { fontSize: 10, cellPadding: 5 },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 80, textColor: [71, 85, 105] },
                1: { cellWidth: 'auto', textColor: [30, 41, 59] }
            }
        });

        // --- NOTES SECTION ---
        if (delivery.notes || delivery.explanation) {
            // C-04 FIX: lastAutoTable can be undefined if no autoTable rendered above (e.g. empty delivery).
            // Use optional chaining + fallback to prevent TypeError crash during PDF export.
            const notesY = (doc.lastAutoTable?.finalY ?? 135) + 15;
            doc.setFontSize(12);
            doc.text('Auditor / Operator Notes', 14, notesY);
            
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(71, 85, 105);
            const notes = delivery.notes || delivery.explanation;
            const splitNotes = doc.splitTextToSize(notes, 182);
            doc.text(splitNotes, 14, notesY + 7);
        }

        // --- FOOTER ---
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text(`Doc ID: ${delivery.id || 'N/A'} | Page ${i} of ${pageCount}`, 14, 285);
            doc.text('IoTank Fuel Intelligence - Amethyst Compliance Engine 2.0', 120, 285);
        }

        doc.save(`Delivery_Audit_${delivery.id || format(now, 'yyyyMMdd')}.pdf`);
    }

    /**
     * MULTI-TAB EXCEL: Generates a professional multi-tab Excel workbook
     */
    public static exportDeliveriesToExcel(
        deliveries: any[],
        summaryMetrics: any,
        orgName: string
    ) {
        const now = new Date();
        const wb = XLSX.utils.book_new();

        // --- TAB 1: SUMMARY ---
        const summaryData = [
            ['Delivery Intelligence Executive Summary'],
            ['Organization', orgName],
            ['Report Period', summaryMetrics.period || 'Current'],
            ['Generated At', format(now, 'yyyy-MM-dd HH:mm:ss')],
            [],
            ['Key Metrics'],
            ['Total Deliveries', deliveries.length],
            ['Total Volume Invoiced', `${summaryMetrics.totalInvoiced || 0} L`],
            ['Total Volume Measured', `${summaryMetrics.totalMeasured || 0} L`],
            ['Aggregate Variance', `${summaryMetrics.totalVariance || 0} L`],
            ['Discrepancy Rate (%)', `${summaryMetrics.discrepancyRate || 0}%`]
        ];
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary');

        // --- TAB 2: DETAILED AUDIT LOG ---
        const detailedData = deliveries.map(d => {
            const rawDate = d.created_at || d.timestamp;
            const isValidDate = rawDate && !isNaN(new Date(rawDate).getTime());
            return {
                'Date': isValidDate ? format(new Date(rawDate), 'yyyy-MM-dd HH:mm') : 'Unknown Time',
                'Delivery ID': d.id,
                'Tank': d.tank_name || 'All Tanks',
                'Invoiced (L)': d.invoiceLiters || 0,
                'Measured (L)': d.measuredStandardized || 0,
                'Variance (L)': d.variance || 0,
                'Temp (°C)': d.deliveryTemp || '',
                'Dip (L)': d.physicalDip || '',
                'Status': d.status,
                'Supplier Status': d.supplierStatus,
                'Notes': d.notes || d.explanation || ''
            };
        });
        const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
        
        // Add some basic styling to column widths
        const wscols = [
            {wch: 20}, {wch: 15}, {wch: 15}, {wch: 12}, {wch: 12}, 
            {wch: 12}, {wch: 10}, {wch: 10}, {wch: 15}, {wch: 20}, {wch: 40}
        ];
        detailedSheet['!cols'] = wscols;
        
        XLSX.utils.book_append_sheet(wb, detailedSheet, 'Detailed Audit Log');

        // --- DOWNLOAD ---
        XLSX.writeFile(wb, `Delivery_History_${orgName.replace(/\s+/g, '_')}_${format(now, 'yyyyMMdd')}.xlsx`);
    }

    /**
     * PREMIUM: Generates a high-fidelity TankIQ Chat Report (Amethyst Theme)
     */
    public static exportTankIQChat(
        messages: any[],
        sessionSubject: string,
        orgName: string,
        userName: string
    ) {
        const doc = new jsPDF() as jsPDFWithAutoTable;
        const now = new Date();
        const dateStr = format(now, 'dd MMM yyyy, HH:mm');

        // --- BRANDING & HEADER ---
        // Top accent bar (Amethyst Primary)
        doc.setFillColor(67, 56, 202); 
        doc.rect(0, 0, 210, 15, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(30, 41, 59);
        doc.text('TankIQ Intelligence Report', 14, 30);

        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('AI-ASSISTANT OPERATIONAL SUMMARY', 14, 36);

        // Header Metadata Box
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(14, 42, 182, 25, 3, 3, 'FD');

        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text('STATION / ORGANIZATION', 20, 50);
        doc.text('REQUESTED BY', 90, 50);
        doc.text('TIMESTAMP', 150, 50);

        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'bold');
        doc.text(orgName, 20, 57);
        doc.text(userName, 90, 57);
        doc.text(dateStr, 150, 57);

        // Session Subject
        doc.setFontSize(14);
        doc.setTextColor(67, 56, 202);
        doc.text(`Subject: ${sessionSubject}`, 14, 82);

        // --- CHAT LOG ---
        let currentY = 90;

        messages.forEach((msg) => {
            // Check if we need a new page
            if (currentY > 260) {
                doc.addPage();
                currentY = 20;
            }

            // Role Badge
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            
            let roleLabel = 'USER';
            let roleColor = [71, 85, 105]; // Slate 600

            if (msg.role === 'assistant') {
                roleLabel = 'TANKIQ';
                roleColor = [67, 56, 202]; // Indigo 700
            } else if (msg.role === 'tool') {
                roleLabel = 'DATA';
                roleColor = [16, 185, 129]; // Emerald 600
            } else if (msg.role === 'system') {
                roleLabel = 'SYSTEM';
                roleColor = [220, 38, 38]; // Red 600
            }

            doc.setTextColor(roleColor[0], roleColor[1], roleColor[2]);
            doc.text(roleLabel, 14, currentY);

            // Message Content
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(30, 41, 59);
            
            const splitText = doc.splitTextToSize(msg.content, 170);
            doc.text(splitText, 25, currentY);
            
            const lines = splitText.length;
            currentY += (lines * 5) + 10;
        });

        // --- FOOTER ---
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text(`Generated by IoTank V2.0.0 | Page ${i} of ${pageCount}`, 14, 285);
            doc.text('Confidential Operational Intelligence', 150, 285);
        }

        const safeSubject = sessionSubject.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 30);
        doc.save(`TankIQ_Report_${safeSubject}_${format(now, 'yyyyMMdd')}.pdf`);
    }
}
