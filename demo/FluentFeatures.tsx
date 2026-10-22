/** @jsxRuntime automatic */
/** @jsxImportSource @fluentui/react-jsx-runtime */
import { slot, type SlotRenderFunction } from "@fluentui/react-utilities";
import type { ComponentProps, ReactNode } from "react";

type RenderSlotProps<Tag extends "button" | "span"> = Omit<
  ComponentProps<Tag>,
  "children"
> & { children?: ReactNode | SlotRenderFunction<ComponentProps<Tag>> };

export function FluentFeatures() {
  const slots = {
    root: slot.always<ComponentProps<"button">>(
      { id: "fluent-slot", children: "Fluent slot" },
      { elementType: "button" },
    ),
    spread: slot.always<ComponentProps<"button">>(
      { id: "fluent-spread", children: "Spread slot" },
      { elementType: "button" },
    ),
    custom: slot.always<RenderSlotProps<"button">>(
      {
        id: "fluent-custom",
        children: (_Component, props) => (
          <button {...props}>Custom slot</button>
        ),
      },
      { elementType: "button" },
    ),
    empty: slot.always<RenderSlotProps<"span">>(
      { children: () => null },
      { elementType: "span" },
    ),
  };
  return (
    <section id="fluent-features">
      <slots.root data-supplied="yes" />
      <slots.custom />
      <slots.empty />
      <slots.spread {...{ title: "spread" }} key="fluent-spread" />
    </section>
  );
}
