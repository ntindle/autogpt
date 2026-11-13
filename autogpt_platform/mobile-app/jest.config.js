const preset = require("jest-expo/jest-preset");

module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: preset.transformIgnorePatterns.map((pattern) =>
    pattern.replace(".pnpm|", ".pnpm|ai/|@ai-sdk/|@workflow/|"),
  ),
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
};
