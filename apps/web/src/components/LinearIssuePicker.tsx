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
import { SearchIcon, XIcon } from "lucide-react";
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

/** More rows than this and the list asks for a search term instead of rendering them all. */
const MAX_RENDERED_ISSUES = 100;

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

interface DraftTarget {
  readonly environmentId: string;
  readonly projectId: string;
  readonly envMode: string;
  readonly worktreePath: string | null;
}

function snapshotDraftTarget(draftId: DraftId): DraftTarget | null {
  const session = useComposerDraftStore.getState().getDraftSession(draftId);
  return session
    ? {
        environmentId: session.environmentId,
        projectId: session.projectId,
        envMode: session.envMode,
        worktreePath: session.worktreePath,
      }
    : null;
}

function draftTargetMatches(draftId: DraftId, target: DraftTarget): boolean {
  const current = snapshotDraftTarget(draftId);
  return (
    current !== null &&
    current.environmentId === target.environmentId &&
    current.projectId === target.projectId &&
    current.envMode === target.envMode &&
    current.worktreePath === target.worktreePath
  );
}

function failureMessage(failure: unknown): string | undefined {
  return failure instanceof Error ? failure.message : undefined;
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
  // Always fresh: a cached answer could miss a branch created a moment ago.
  const listRefs = useAtomQueryRunner(vcsEnvironment.listRefs, {
    reportFailure: false,
    refresh: true,
  });
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const pickedBranch = useComposerDraftStore(
    (store) => store.getDraftSession(draftId)?.worktreeBranch ?? null,
  );

  const issues = issuesQuery.data?.issues ?? [];
  const issueById = useMemo(() => new Map(issues.map((issue) => [issue.id, issue])), [issues]);
  const itemIds = useMemo(() => issues.map((issue) => issue.id), [issues]);
  const matchingItemIds = useMemo(() => {
    if (deferredQuery.length === 0) return itemIds;
    return issues
      .filter(
        (issue) =>
          issue.identifier.toLowerCase().includes(deferredQuery) ||
          issue.title.toLowerCase().includes(deferredQuery),
      )
      .map((issue) => issue.id);
  }, [deferredQuery, issues, itemIds]);
  const filteredItemIds = useMemo(
    () =>
      matchingItemIds.length > MAX_RENDERED_ISSUES
        ? matchingItemIds.slice(0, MAX_RENDERED_ISSUES)
        : matchingItemIds,
    [matchingItemIds],
  );
  const hiddenCount = matchingItemIds.length - filteredItemIds.length;

  if (!statusQuery.data?.configured) {
    return null;
  }

  const clearPick = () => {
    setIsOpen(false);
    setDraftThreadContext(draftId, { worktreeBranch: null });
    onComposerFocusRequest?.();
  };

  const pickIssue = (issue: LinearIssueSummary) => {
    setIsOpen(false);
    setQuery("");
    // The two requests take a moment. Everything below must still describe the
    // same draft when they land, or the text and branch go to the wrong place.
    const target = snapshotDraftTarget(draftId);
    if (!target) return;
    const branchName = resolveLinearBranchName(issue);
    startPicking(async () => {
      const [detail, refs] = await Promise.all([
        getIssue({ environmentId, input: { issueId: issue.id } }),
        listRefs({ environmentId, input: { cwd: projectCwd, query: branchName, limit: 10 } }),
      ]);
      if (!draftTargetMatches(draftId, target)) return;
      if (detail._tag !== "Success") {
        if (!isAtomCommandInterrupted(detail)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Could not load ${issue.identifier}.`,
              description: failureMessage(squashAtomCommandFailure(detail)),
            }),
          );
        }
        return;
      }
      if (refs._tag !== "Success") {
        if (!isAtomCommandInterrupted(refs)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not check existing branches.",
              description: failureMessage(squashAtomCommandFailure(refs)),
            }),
          );
        }
        return;
      }
      const existingPrompt =
        useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt ?? "";
      setPrompt(draftId, mergeLinearPrompt(existingPrompt, buildLinearIssuePrompt(detail.value)));
      const branchExists = refs.value.refs.some((ref) => ref.name === branchName);
      // A previous pick's name must not outlive this pick, so the branch is
      // always replaced: with the new name, or with nothing on a collision.
      setDraftThreadContext(draftId, { worktreeBranch: branchExists ? null : branchName });
      if (branchExists) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: `Branch ${branchName} already exists.`,
            description: "Pick it from the branch list to continue that work.",
          }),
        );
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
              <LinearIcon className="size-3 shrink-0 opacity-70" />
            </ComboboxTrigger>
          }
        />
        <TooltipPopup side="top">
          {isPicking
            ? "Loading issue…"
            : pickedBranch
              ? `First send creates branch ${pickedBranch}`
              : "Start from one of your Linear issues"}
        </TooltipPopup>
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
          {pickedBranch ? (
            <button
              type="button"
              className="mx-1 mt-1 flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={clearPick}
            >
              <XIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                Forget <span className="font-mono">{pickedBranch}</span>
              </span>
            </button>
          ) : null}
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
          {hiddenCount > 0 ? (
            <ComboboxStatus>{hiddenCount} more not shown. Type to narrow the list.</ComboboxStatus>
          ) : issues.length > 0 ? (
            <ComboboxStatus>Grouped by status, newest update first.</ComboboxStatus>
          ) : null}
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}
