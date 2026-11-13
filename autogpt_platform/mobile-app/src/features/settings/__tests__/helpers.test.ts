import { settingsCookies } from "../helpers";

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
