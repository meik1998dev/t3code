import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { CircleIcon } from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PullRequestFiltersMenu,
  PullRequestProjectFilter,
  pullRequestProjectKey,
  type PullRequestProjectOption,
} from "./PullRequestListFilters";

function findValueChange(
  node: ReactNode,
):
  | ReactElement<{ readonly children?: ReactNode; readonly onValueChange: (value: string) => void }>
  | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as {
      readonly children?: ReactNode;
      readonly onValueChange?: (value: string) => void;
    };
    if (props.onValueChange) {
      return child as ReactElement<{
        readonly children?: ReactNode;
        readonly onValueChange: (value: string) => void;
      }>;
    }
    const nested = findValueChange(props.children);
    if (nested) return nested;
  }
  return undefined;
}

/** The nested radio-group component element carrying this label, invoked so its group shows. */
function findLabeledGroup(node: ReactNode, label: string): ReactNode {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as { readonly children?: ReactNode; readonly label?: string };
    if (props.label === label && typeof child.type === "function") {
      const rendered = (child.type as (properties: unknown) => ReactNode)(child.props);
      return findLabeledGroup(rendered, label) ?? rendered;
    }
    const nested = findLabeledGroup(props.children, label);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function menu(overrides: Partial<Parameters<typeof PullRequestFiltersMenu>[0]>) {
  return PullRequestFiltersMenu({
    state: "open",
    stateOptions: [
      { value: "open", label: "Open", Icon: CircleIcon },
      { value: "closed", label: "Closed", Icon: CircleIcon },
    ],
    onState: () => undefined,
    involvement: "all",
    involvementOptions: [{ value: "all", label: "All", Icon: CircleIcon }],
    onInvolvement: () => undefined,
    filters: {},
    onFilters: () => undefined,
    host: undefined,
    hostOptions: [],
    onHost: () => undefined,
    server: undefined,
    serverOptions: [],
    onServer: () => undefined,
    projects: [],
    projectIds: [],
    unavailable: new Map(),
    onProjects: () => undefined,
    ...overrides,
  });
}

describe("pull request filters menu", () => {
  it("does not emit a change when the selected state is chosen again", () => {
    const onState = vi.fn();
    const group = findValueChange(findLabeledGroup(menu({ onState }), "State"));
    expect(group).toBeDefined();

    group?.props.onValueChange("open");
    expect(onState).not.toHaveBeenCalled();

    group?.props.onValueChange("closed");
    expect(onState).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledWith("closed");
  });

  it("names the chosen narrowing and leaves the others alone", () => {
    const onFilters = vi.fn();
    const group = findValueChange(
      findLabeledGroup(menu({ filters: { review: "approved" }, onFilters }), "Draft"),
    );
    expect(group).toBeDefined();

    group?.props.onValueChange("hide");
    expect(onFilters).toHaveBeenCalledWith({ review: "approved", draft: "hide" });
  });

  it("drops a narrowing chosen back to all rather than sending it as undefined", () => {
    const onFilters = vi.fn();
    const group = findValueChange(
      findLabeledGroup(
        menu({ filters: { review: "none", checks: "failing" }, onFilters }),
        "Review",
      ),
    );
    expect(group).toBeDefined();

    group?.props.onValueChange("all");
    expect(onFilters).toHaveBeenCalledWith({ checks: "failing" });
  });

  it("does not collide when environment and project ids contain spaces", () => {
    expect(
      pullRequestProjectKey({
        environmentId: "a b" as EnvironmentId,
        id: "c" as ProjectId,
      }),
    ).not.toBe(
      pullRequestProjectKey({
        environmentId: "a" as EnvironmentId,
        id: "b c" as ProjectId,
      }),
    );
  });
});

/** Every checkbox row in a rendered subtree, keyed by the title it shows. */
function findCheckboxes(node: ReactNode): Map<
  string,
  {
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly toggle: (next: boolean) => void;
  }
> {
  const found = new Map<
    string,
    {
      readonly checked: boolean;
      readonly disabled: boolean;
      readonly toggle: (next: boolean) => void;
    }
  >();
  const walk = (current: ReactNode, label: string | undefined) => {
    for (const child of Children.toArray(current)) {
      if (!isValidElement(child)) continue;
      const props = child.props as {
        readonly children?: ReactNode;
        readonly checked?: boolean;
        readonly disabled?: boolean;
        readonly onCheckedChange?: (next: boolean) => void;
        /** A row that carries a tooltip hands its own element over as this. */
        readonly render?: ReactNode;
      };
      const title = typeof child.key === "string" ? child.key : label;
      if (props.onCheckedChange) {
        found.set(textOf(props.children), {
          checked: props.checked === true,
          disabled: props.disabled === true,
          toggle: props.onCheckedChange,
        });
        continue;
      }
      walk(props.children, title);
      if (props.render !== undefined) walk(props.render, title);
    }
  };
  walk(node, undefined);
  return found;
}

/** The visible words of a subtree, joined, so a row can be found by what it reads as. */
function textOf(node: ReactNode): string {
  const parts: Array<string> = [];
  const walk = (current: ReactNode) => {
    for (const child of Children.toArray(current)) {
      if (typeof child === "string") {
        parts.push(child);
        continue;
      }
      if (!isValidElement(child)) continue;
      walk((child.props as { readonly children?: ReactNode }).children);
    }
  };
  walk(node);
  return parts.join(" ").trim();
}

/** The one row that clears the whole scope, invoked the way a press would. */
function findResetRow(node: ReactNode): (() => void) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as {
      readonly children?: ReactNode;
      readonly onClick?: (event: { preventDefault: () => void }) => void;
    };
    if (props.onClick && textOf(props.children).includes("All projects")) {
      const onClick = props.onClick;
      return () => onClick({ preventDefault: () => undefined });
    }
    const nested = findResetRow(props.children);
    if (nested) return nested;
  }
  return undefined;
}

const project = (id: string, environmentId: string, title: string): PullRequestProjectOption => ({
  id: id as ProjectId,
  environmentId: environmentId as EnvironmentId,
  title,
  workspaceRoot: `/work/${id}`,
});

function projectFilter(overrides: Partial<Parameters<typeof PullRequestProjectFilter>[0]>) {
  return PullRequestProjectFilter({
    projects: [],
    selected: new Set(),
    unavailable: new Map(),
    onChange: () => undefined,
    ...overrides,
  });
}

describe("pull request project filter", () => {
  const web = project("project-1", "env-1", "Web");
  const server = project("project-2", "env-1", "Server");

  it("adds a project to the ones already picked rather than replacing them", () => {
    const onChange = vi.fn();
    const rows = findCheckboxes(
      projectFilter({
        projects: [web, server],
        selected: new Set([pullRequestProjectKey(web)]),
        onChange,
      }),
    );

    expect(rows.get("Web")?.checked).toBe(true);
    expect(rows.get("Server")?.checked).toBe(false);

    rows.get("Server")?.toggle(true);
    expect(onChange).toHaveBeenCalledWith([web, server]);
  });

  it("removes only the project that was unchecked", () => {
    const onChange = vi.fn();
    const rows = findCheckboxes(
      projectFilter({
        projects: [web, server],
        selected: new Set([pullRequestProjectKey(web), pullRequestProjectKey(server)]),
        onChange,
      }),
    );

    rows.get("Web")?.toggle(false);
    expect(onChange).toHaveBeenCalledWith([server]);
  });

  it("clears the whole scope from its own row, and stays quiet when nothing is picked", () => {
    const onChange = vi.fn();
    findResetRow(projectFilter({ projects: [web, server], onChange }))?.();
    expect(onChange).not.toHaveBeenCalled();

    findResetRow(
      projectFilter({
        projects: [web, server],
        selected: new Set([pullRequestProjectKey(web)]),
        onChange,
      }),
    )?.();
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("refuses a project whose repository could not be read", () => {
    const rows = findCheckboxes(
      projectFilter({
        projects: [web, server],
        unavailable: new Map([[pullRequestProjectKey(server), "The remote could not be read."]]),
      }),
    );

    expect(rows.get("Server Unavailable")?.disabled).toBe(true);
    expect(rows.get("Web")?.disabled).toBe(false);
  });

  it("keeps one project id held by two servers as two rows", () => {
    const shared = project("project-1", "env-2", "Web \u00b7 two");
    const onChange = vi.fn();
    const rows = findCheckboxes(
      projectFilter({ projects: [web, shared], selected: new Set(), onChange }),
    );

    expect(rows.size).toBe(2);
    rows.get("Web \u00b7 two")?.toggle(true);
    expect(onChange).toHaveBeenCalledWith([shared]);
  });
});
