import type { PlaywrightTestConfig } from "@playwright/test";
import { devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const config: PlaywrightTestConfig = {
  globalSetup: require.resolve("./playwright.global-setup.ts"),
  globalTeardown: require.resolve("./playwright.global-teardown.ts"),
  testDir: "./tests",
  /* Maximum time one test can run for. */
  timeout: process.env.CI ? 3 * 60 * 1000 /* 3 minutes */ : 60 * 1000 /* 1 minute */,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: process.env.CI ? 2 * 60 * 1000  /* 2 minutes  */ : 30 * 1000  /* 30 seconds  */,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 2,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: "http://hass:8123/",
    // Tell all tests to load signed-in state from 'storageState.json'.
    storageState: "storageState.json",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: process.env.Z_DEBUG ? "retain-on-failure" : "on-first-retry",
    video: process.env.Z_DEBUG ? "retain-on-failure" : "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: true, // Needed as this project uses touch-based swipes
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        hasTouch: true, // Needed as this project uses touch-based swipes
      },
    },
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 5"],
      },
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: {
    //     channel: 'msedge',
    //   },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: {
    //     channel: 'chrome',
    //   },
    // },

    /* NOT SUPPORTED */
    // {
    //   /* DOESN'T SUPPORT TOUCH CONSTRUCTOR */
    //   name: "webkit",
    //   use: {
    //     ...devices["Desktop Safari"],
    //   },
    // },
    // {
    //   /* DOESN'T SUPPORT TOUCH CONSTRUCTOR */
    //   name: "Mobile Safari",
    //   use: {
    //     ...devices["iPhone 12"],
    //   },
    // },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: "test-results/",

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   port: 3000,
  // },
};

export default config;
