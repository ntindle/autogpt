jest.mock("@preeternal/react-native-cookie-manager", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({})),
    clearAllStores: jest.fn(async () => true),
  },
}));
