import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';

// Simulating extractPricesFromText from useMarketNews.ts
export function extractPricesFromText(text, basePrices) {
    const results = [];
    
    // Original regex:
    // const kshRegex = /(?:set at|retail at|price of|to ksh|ksh|shillings|sh|ksh\.|kshs|kshs\.|to)\s*(\d{2,3}(?:\.\d{2})?)/gi;
    
    // Improved regex that includes simple 'at', ':', and optional currency prefixes:
    const kshRegex = /(?:set at|retail at|price of|to ksh|ksh|shillings|sh|ksh\.|kshs|kshs\.|to|at|:\s*|of\s*|up to\s*)\s*(?:ksh|sh|shs|sh\.)?\s*(\d{2,3}(?:\.\d{2})?)/gi;
    
    let match;
    while ((match = kshRegex.exec(text)) !== null) {
        const val = parseFloat(match[1]);
        if (val < 100 || val > 300) continue; 
        
        const snippet = text.substring(Math.max(0, match.index - 80), Math.min(text.length, match.index + 80)).toLowerCase();
        
        let commodity = 'General';
        if (snippet.includes('petrol') || snippet.includes('pms') || snippet.includes('super')) commodity = 'Petrol';
        else if (snippet.includes('diesel') || snippet.includes('ago')) commodity = 'Diesel';
        else if (snippet.includes('kerosene') || snippet.includes('ik')) commodity = 'Kerosene';
        
        const isOfficialPhrasing = snippet.includes('set at') || snippet.includes('retail at') || snippet.includes('regulated') || snippet.includes('epra') || snippet.includes('nairobi') || snippet.includes('at');
        if (commodity !== 'General' || isOfficialPhrasing) {
            if (!results.some(r => r.commodity === commodity && r.value === val)) {
                results.push({ commodity, value: val, currency: 'KES' });
            }
        }
    }
    return results;
}

async function run() {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent('EPRA petroleum price Kenya')}&hl=en-KE&gl=KE&ceid=KE:en`;
  console.log('Fetching Google News RSS:', url);
  
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const xmlText = await res.text();
    
    const parser = new XMLParser();
    const jsonObj = parser.parse(xmlText);
    const items = jsonObj.rss?.channel?.item || [];
    
    console.log(`Fetched ${items.length} news items. Testing price extraction:`);
    
    for (const item of items) {
      const textToScan = `${item.title} ${item.description || ''}`;
      const detections = extractPricesFromText(textToScan);
      if (detections.length > 0) {
        console.log('\n--- Match found ---');
        console.log('Title:', item.title);
        console.log('Description:', item.description);
        console.log('Detections:', detections);
      }
    }
  } catch (err) {
    console.error('Error fetching RSS:', err);
  }
}

run();
