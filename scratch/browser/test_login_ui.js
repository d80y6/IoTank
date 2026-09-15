const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Capture console logs
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    console.log("Navigating to http://localhost:5173...");
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    console.log("Taking initial screenshot...");
    await page.screenshot({ path: 'scratch/browser/login_step1_loaded.png' });

    console.log("Typing credentials...");
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', 'joereademm@gmail.com');
    await page.type('input[type="password"]', 'Joe@26$.s');

    console.log("Clicking submit...");
    await page.click('button[type="submit"]');

    console.log("Waiting 5 seconds for transition...");
    await new Promise(r => setTimeout(r, 5000));

    console.log("Taking final screenshot...");
    await page.screenshot({ path: 'scratch/browser/login_step2_after.png' });

    console.log("Done.");
    await browser.close();
})();
