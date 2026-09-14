import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionAnswerField } from "../QuestionAnswerField";

function renderField(value = "ねこ") {
  const onSubmit = vi.fn();
  render(
    <QuestionAnswerField
      question={{ question: "Which animal?", keyword: "animal" }}
      value={value}
      labelId="label-1"
      autoFocus={false}
      onChange={() => {}}
      onPick={() => {}}
      onSubmit={onSubmit}
    />,
  );
  return { textarea: screen.getByRole("textbox"), onSubmit };
}

describe("QuestionAnswerField Enter handling", () => {
  it("advances the pager on a plain Enter", () => {
    const { textarea, onSubmit } = renderField();

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not advance while an IME owns the Enter", () => {
    const { textarea, onSubmit } = renderField();

    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    // Safari's confirming Enter arrives after compositionend.
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves Shift+Enter as the newline", () => {
    const { textarea, onSubmit } = renderField();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

it("shows a saved custom answer restored after mounting", () => {
  const props = {
    question: {
      question: "Which material?",
      keyword: "material",
      options: ["Cotton", "Wool"],
    },
    labelId: "material-label",
    autoFocus: false,
    onChange: vi.fn(),
    onPick: vi.fn(),
    onSubmit: vi.fn(),
  };
  const { rerender } = render(<QuestionAnswerField {...props} value="" />);
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  rerender(<QuestionAnswerField {...props} value="Use a silk blend" />);
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "Use a silk blend",
  );
});
