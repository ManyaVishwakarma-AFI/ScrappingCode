import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    extension_path = os.path.abspath('.')

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            '',
            args=[
                f'--disable-extensions-except={extension_path}',
                f'--load-extension={extension_path}',
            ]
        )

        try:
            # The service worker is the most reliable way to get the extension ID for Manifest V3
            print("Waiting for service worker...")
            await asyncio.sleep(5) # Add a delay to give the service worker time to start
            service_worker = await context.wait_for_event('serviceworker', timeout=20000)
            extension_id = service_worker.url.split('/')[2]
            print(f"Found extension ID via service worker: {extension_id}")

            # Open the popup in a new page
            page = await context.new_page()
            await page.goto(f'chrome-extension://{extension_id}/Popup.html')
            print("Opened popup page.")

            # Configure and start the scraping process
            await page.fill('#searchQuery', 'laptops')
            await page.select_option('#website', 'flipkart')
            await page.fill('#startPage', '1')
            await page.fill('#endPage', '1')
            print("Filled out form, starting scrape.")
            await page.click('#startBtn')

            # Wait for the scraping process to complete
            print("Waiting for scraping to complete...")
            await page.wait_for_selector('#status:has-text("Scraping complete")', timeout=180000)
            print("Scraping complete!")

            # Get the results from storage
            results = await page.evaluate(
                """
                () => {
                    return new Promise(resolve => {
                        chrome.storage.local.get('latest_results', (data) => {
                            resolve(data.latest_results);
                        });
                    });
                }
                """
            )

            # Verify the results
            assert results, "No results found in storage."
            assert results['products'], "No products found in results."
            assert len(results['products']) > 0, "No products were scraped."

            product = results['products'][0]
            print("Sample product data:", product)

            assert product['product_name'], "Product name was not scraped."
            assert product['current_price'], "Current price was not scraped."

            print("Verification successful!")

            # Capture a screenshot for final verification
            screenshot_path = 'jules-scratch/verification/verification.png'
            await page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"An error occurred during verification: {e}")
            if 'page' in locals() and not page.is_closed():
                await page.screenshot(path='jules-scratch/verification/error_screenshot.png')
            raise

        finally:
            await context.close()

if __name__ == '__main__':
    asyncio.run(main())