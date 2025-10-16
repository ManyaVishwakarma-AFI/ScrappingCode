import asyncio
from playwright.async_api import async_playwright
import os

async def run_test_for_site(context, extension_id, site, search_query):
    print(f"--- Starting test for {site.upper()} ---")

    page = await context.new_page()
    await page.goto(f'chrome-extension://{extension_id}/Popup.html')
    print(f"Opened popup page for {site}.")

    # Configure and start the scraping process
    await page.fill('#searchQuery', search_query)
    await page.select_option('#website', site)
    await page.fill('#startPage', '1')
    await page.fill('#endPage', '1')
    print(f"Filled out form for {site}, starting scrape.")
    await page.click('#startBtn')

    # Wait for the scraping process to complete
    print(f"Waiting for scraping to complete on {site}...")
    await page.wait_for_selector('#status:has-text("Scraping complete")', timeout=180000)
    print(f"Scraping complete on {site}!")

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
    assert results, f"No results found in storage for {site}."
    assert results['products'], f"No products found in results for {site}."
    assert len(results['products']) > 0, f"No products were scraped for {site}."

    product = results['products'][0]
    print(f"Sample product data from {site}:", product)

    assert product['product_name'], f"Product name was not scraped for {site}."
    assert product['current_price'], f"Current price was not scraped for {site}."

    print(f"--- Verification successful for {site} ---")
    await page.close()


async def main():
    extension_path = os.path.abspath('.')

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            '',
            headless=True,
            args=[
                f'--disable-extensions-except={extension_path}',
                f'--load-extension={extension_path}',
            ]
        )

        try:
            # The service worker is the most reliable way to get the extension ID
            print("Waiting for service worker...")
            service_worker = await context.wait_for_event('serviceworker', timeout=20000)
            extension_id = service_worker.url.split('/')[2]
            print(f"Found extension ID via service worker: {extension_id}")

            # Run tests for both sites
            await run_test_for_site(context, extension_id, 'flipkart', 'laptops')
            await run_test_for_site(context, extension_id, 'amazon', 'laptops')

            # Capture a final screenshot (of the last popup state) for verification
            # Since we can't show both, this just confirms the test ran.
            page = await context.new_page()
            await page.goto(f'chrome-extension://{extension_id}/Popup.html')
            screenshot_path = 'jules-scratch/verification/verification.png'
            await page.screenshot(path=screenshot_path)
            print(f"Final screenshot saved to {screenshot_path}")


        except Exception as e:
            print(f"An error occurred during verification: {e}")
            # Try to get a screenshot from any open page for debugging
            if context.pages:
                await context.pages[-1].screenshot(path='jules-scratch/verification/error_screenshot.png')
            raise

        finally:
            await context.close()

if __name__ == '__main__':
    asyncio.run(main())