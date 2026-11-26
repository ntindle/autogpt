import { closedCopy, deleteErrorCopy, settingsCookies } from "../helpers";

describe("settingsCookies", () => {
  it("sets HttpOnly session cookies for the native cookie store", () => {
    expect(
      settingsCookies("a=1; __Secure-b=2", "https://platform.example.com"),
    ).toEqual([
      { name: "a", value: "1", path: "/", secure: true, httpOnly: true },
      {
        name: "__Secure-b",
        value: "2",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ]);
  });

  it("supports local HTTP development", () => {
    expect(settingsCookies("a=1", "http://localhost:3000")[0].secure).toBe(
      false,
    );
  });

  it("preserves values without turning them into executable page scripts", () => {
    expect(
      settingsCookies('a=x"</script>y=2', "https://platform.example.com")[0]
        .value,
    ).toBe('x"</script>y=2');
  });

  it("ignores malformed cookie pairs", () => {
    expect(
      settingsCookies("; =oops; bad; a=1", "https://platform.example.com"),
    ).toHaveLength(1);
  });
});

describe("deleteErrorCopy", () => {
  it("shows the server's own words for a refusal it phrases", () => {
    expect(
      deleteErrorCopy({
        status: 502,
        message: "Stripe wouldn't cancel your plan.",
      }),
    ).toBe("Stripe wouldn't cancel your plan.");
  });

  it("hides anything else behind one line", () => {
    expect(deleteErrorCopy({ status: 500, message: "KeyError: 'user'" })).toBe(
      "We couldn't delete your account. Try again.",
    );
    expect(deleteErrorCopy(new TypeError("Network request failed"))).toBe(
      "We couldn't delete your account. Try again.",
    );
  });
});

describe("closedCopy", () => {
  it("names the last day to change your mind", () => {
    expect(closedCopy("2026-12-04T12:00:00Z")).toBe(
      "Changed your mind? Sign in on the web before Dec 4 and choose Keep my account.",
    );
  });

  it("falls back to the 14 days when the server gives no date", () => {
    expect(closedCopy(null)).toBe(
      "Changed your mind? Sign in on the web within 14 days and choose Keep my account.",
    );
  });
});
