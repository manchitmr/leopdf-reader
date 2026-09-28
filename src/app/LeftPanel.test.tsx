// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { OutlineTree } from "./LeftPanel";

afterEach(cleanup);

test("outline tree shows nested titles and navigates on click", () => {
  const onSelect = vi.fn();
  render(
    <OutlineTree
      nodes={[
        { title: "Chapter One", page: 0, children: [{ title: "Section 1.1", page: 1, children: [] }] },
        { title: "No target", page: null, children: [] },
      ]}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByLabelText("Chapter One"));
  fireEvent.click(screen.getByText("Section 1.1"));
  expect(onSelect).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByText("No target"));
  expect(onSelect).toHaveBeenCalledTimes(1);
});
