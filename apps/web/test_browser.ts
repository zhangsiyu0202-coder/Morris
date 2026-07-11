import { chromium } from 'playwright';

(async () => {
  console.log("Launching Google Browser (Chromium)...");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log("Navigating to http://localhost:3000...");
  await page.goto('http://localhost:3000');
  
  const title = await page.title();
  console.log("Success! Page title is:", title);
  
  await page.screenshot({ path: 'test_success_screenshot.png' });
  console.log("Test screenshot saved to apps/web/test_success_screenshot.png");
  
  await browser.close();
  console.log("Browser test completed successfully!");
})();
