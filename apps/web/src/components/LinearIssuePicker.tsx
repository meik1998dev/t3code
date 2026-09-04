/**
 * "From Linear" picker beside the branch selector. Only rendered while a
 * draft is in new-worktree mode with no worktree yet: picking an issue names
 * the branch the first send will create and puts the issue text in the
 * composer. Nothing is created until that send.
 *
 * @module LinearIssuePicker
 */
import {
  buildLinearIssuePrompt,
  type EnvironmentId,
  type LinearIssueSummary,
} from "@t3tools/contracts";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { linearEnvironment } from "../state/linear";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { vcsEnvironment } from "../state/vcs";
import { cn } from "../lib/utils";
import { LinearIcon } from "./Icons";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface LinearIssuePickerProps {
  environmentId: EnvironmentId;
  draftId: DraftId;
  /** Where the branch-exists check looks. */
  projectCwd: string;
  onComposerFocusRequest?: () => void;
}

/** Linear's own suggestion when the workspace has one, else `ENG-123-title`. */
export function resolveLinearBranchName(issue: LinearIssueSummary): string {
  const suggested = issue.branchName?.trim();
  if (suggested) return suggested;
  return sanitizeBranchFragment(`${issue.identifier}-${issue.title}`);
}

/** Puts the issue text above whatever the user already typed. */
export function mergeLinearPrompt(existingPrompt: string, issuePrompt: string): string {
  const existing = existingPrompt.trim();
  return existing.length === 0 ? issuePrompt : `${issuePrompt}\n\n${existing}`;
}

export function LinearIssuePicker({
  environmentId,
  draftId,
  projectCwd,
  onComposerFocusRequest,
}: LinearIssuePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query).trim().toLowerCase();
  const [isPicking, startPicking] = useTransition();

  const statusQuery = useEnvironmentQuery(linearEnvironment.status({ environmentId, input: {} }));
  const issuesQuery = useEnvironmentQuery(
    isOpen ? linearEnvironment.myIssues({ environmentId, input: {} }) : null,
  );
  const getIssue = useAtomCommand(linearEnvironment.getIssue, { reportFailure: false });
  const listRefs = useAtomQueryRunner(vcsEnvironment.listRefs, { reportFailure: false });
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const issues = issuesQuery.data?.issues ?? [];
  const issueById = useMemo(() => new Map(issues.map((issue) => [issue.id, issue])), [issues]);
  const itemIds = useMemo(() => issues.map((issue) => issue.id), [issues]);
  const filteredItemIds = useMemo(() => {
    if (deferredQuery.length === 0) return itemIds;
    return issues
      .filter(
        (issue) =>
          issue.identifier.toLowerCase().includes(deferredQuery) ||
          issue.title.toLowerCase().includes(deferredQuery),
      )
      .map((issue) => issue.id);
  }, [deferredQuery, issues, itemIds]);

  if (!statusQuery.data?.configured) {
    return null;
  }

  const pickIssue = (issue: LinearIssueSummary) => {
    setIsOpen(false);
    setQuery("");
    startPicking(async () => {
      const detail = await getIssue({ environmentId, input: { issueId: issue.id } });
      if (detail._tag !== "Success") {
        if (!isAtomCommandInterrupted(detail)) {
          const failure = squashAtomCommandFailure(detail);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Could not load ${issue.identifier}.`,
              description: failure instanceof Error ? failure.message : undefined,
            }),
          );
        }
        return;
      }
      const existingPrompt =
        useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt ?? "";
      setPrompt(draftId, mergeLinearPrompt(existingPrompt, buildLinearIssuePrompt(detail.value)));

      const branchName = resolveLinearBranchName(issue);
      const refs = await listRefs({
        environmentId,
        input: { cwd: projectCwd, query: branchName, limit: 10 },
      });
      const branchExists =
        refs._tag === "Success" && refs.value.refs.some((ref) => ref.name === branchName);
      if (branchExists) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: `Branch ${branchName} already exists.`,
            description: "Pick it from the branch list to continue that work.",
          }),
        );
      } else {
        setDraftThreadContext(draftId, { worktreeBranch: branchName });
      }
      onComposerFocusRequest?.();
    });
  };

  return (
    <Combobox
      items={itemIds}
      filteredItems={filteredItemIds}
      autoHighlight
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<Button variant="ghost" size="xs" />}
              className="min-w-0 text-muted-foreground/70 hover:text-foreground/80 px-1 sm:h-5 sm:text-[11px]"
              disabled={isPicking}
              aria-label="Start from a Linear issue"
            >
              <LinearIcon className="size-2.5 shrink-0 opacity-70" />
              <span data-composer-label className="hidden sm:inline">
                {isPicking ? "Loading…" : "Linear"}
              </span>
              <ChevronDownIcon className="size-2.5 shrink-0 opacity-50" />
            </ComboboxTrigger>
          }
        />
        <TooltipPopup side="top">Start from one of your Linear issues</TooltipPopup>
      </Tooltip>
      <ComboboxPopup align="end" side="top" className="flex w-96 flex-col">
        <div className="shrink-0 px-3 pt-2.5">
          <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
            />
            <ComboboxInput
              className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
              inputClassName="rounded-none bg-transparent text-sm"
              placeholder="Search my issues..."
              showTrigger={false}
              size="sm"
              unstyled
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="flex min-h-0 max-h-72 flex-1 flex-col overflow-hidden">
          <ComboboxEmpty>
            {issuesQuery.isPending
              ? "Loading your issues..."
              : issuesQuery.error
                ? issuesQuery.error
                : "No open issues assigned to you."}
          </ComboboxEmpty>
          <ComboboxList className="max-h-72">
            {filteredItemIds.map((issueId) => {
              const issue = issueById.get(issueId);
              if (!issue) return null;
              return (
                <ComboboxItem
                  key={issueId}
                  value={issueId}
                  hideIndicator
                  className="pe-1.5"
                  onClick={() => pickIssue(issue)}
                >
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: issue.state.color }}
                    />
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {issue.identifier}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    <span
                      className={cn(
                        "shrink-0 text-[10px] text-muted-foreground/60",
                        issue.state.type === "started" && "text-muted-foreground",
                      )}
                    >
                      {issue.state.name}
                    </span>
                  </div>
                </ComboboxItem>
              );
            })}
          </ComboboxList>
          {issues.length > 0 ? (
            <ComboboxStatus>Grouped by status, newest update first.</ComboboxStatus>
          ) : null}
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
