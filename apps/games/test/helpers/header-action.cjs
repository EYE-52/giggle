// Use the same header path as the player, including the narrow-screen disclosure.
module.exports = async function clickHeaderAction(page, selector) {
  const button = page.locator(selector);
  const options = page.locator('#headerOptions');
  if (await options.isVisible() && !await button.isVisible()) await options.click();
  await button.click();
  if (await page.locator('#headerTools:popover-open').count()) await page.keyboard.press('Escape');
};
