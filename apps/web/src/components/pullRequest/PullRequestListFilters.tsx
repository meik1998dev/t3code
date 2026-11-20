import { Spinner } from "~/components/ui/spinner";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestFilterOptionsInput,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  EyeOffIcon,
  FolderGit2Icon,
  LayersIcon,
  ListFilterIcon,
  SearchIcon,
  TagIcon,
  UserRoundIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { type ElementType, useState } from "react";

import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { useDebouncedValue } from "~/state/queries";
import { type EnvironmentQueryTarget, usePullRequestFilterOptions } from "~/state/pullRequests";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Button } from "../ui/button";

import {
  Menu,
  MenuCheckboxItem,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSearchInput,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  pullRequestAuthorChoices,
  selectedPullRequestAuthor,
  pullRequestLabelChoices,
  pullRequestLabelColor,
  type PullRequestAuthorFacet,
  type PullRequestLabelFacet,
} from "./pullRequestList.logic";
import { resolveFilterOptions } from "./pullRequestListOptions";
import { PullRequestActorAvatar } from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly Icon: ElementType<{ className?: string }>;
  readonly project?: ProjectFaviconProject;
  readonly unavailable?: string | undefined;
}

export function PullRequestFilterOptionIcon<Value extends string>({
  option,
}: {
  option: PullRequestFilterOption<Value>;
}) {
  return option.project ? (
    <ProjectFavicon project={option.project} className="size-3.5" />
  ) : (
    <option.Icon aria-hidden className="size-3.5" />
  );
}

export interface PullRequestExpectedHost {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
}

export function pullRequestHostLabel(
  entries: ReadonlyArray<{ readonly host: string; readonly kind: SourceControlProviderKind }>,
  entry: { readonly host: string; readonly kind: SourceControlProviderKind },
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1
    ? entry.host
    : getSourceControlPresentationForKind(entry.kind).providerName;
}

export function PullRequestSearchInput({
  value,
  busy,
  label,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  busy?: boolean;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
      <InputGroupAddon>
        {busy ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          onChange(event.currentTarget.value);
          if ((event.nativeEvent as InputEvent).inputType === "insertFromPaste") {
            onSubmit(event.currentTarget.value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            onSubmit(event.currentTarget.value);
          }
        }}
        placeholder={placeholder}
        aria-label={label}
      />
    </InputGroup>
  );
}

/** MenuRadioGroup wants a string, so "every host" wears the one value no host can be. */
const ALL_HOSTS_VALUE = "";
const ALL_SERVERS_VALUE = "";
const UNFILTERED_VALUE = "all";
/**
 * A project's own row key, carrying the server along with the id: the id alone is only unique
 * within its own server, so two rows sharing one would otherwise be the same row here.
 */
export const pullRequestProjectKey = (project: {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
}) => JSON.stringify([project.environmentId, project.id]);

const DRAFT_OPTIONS = [
  {
    value: UNFILTERED_VALUE,
    label: msg("All", { $context: "pull request filter" }),
    Icon: LayersIcon,
  },
  { value: "only", label: msg("Drafts only"), Icon: PullRequestGlyph.draft },
  { value: "hide", label: msg("Hide drafts"), Icon: EyeOffIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const REVIEW_OPTIONS = [
  {
    value: UNFILTERED_VALUE,
    label: msg("All", { $context: "pull request filter" }),
    Icon: LayersIcon,
  },
  {
    value: "approved",
    label: msg("Approved", { $context: "review decision" }),
    Icon: CircleCheckIcon,
  },
  { value: "changes-requested", label: msg("Changes requested"), Icon: CircleXIcon },
  { value: "review-required", label: msg("Review required"), Icon: CircleDashedIcon },
  { value: "none", label: msg("No reviews"), Icon: CircleSlashIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const CHECKS_OPTIONS = [
  {
    value: UNFILTERED_VALUE,
    label: msg("All", { $context: "pull request filter" }),
    Icon: LayersIcon,
  },
  { value: "passing", label: msg("Passing", { $context: "checks filter" }), Icon: CircleCheckIcon },
  { value: "failing", label: msg("Failing", { $context: "checks filter" }), Icon: CircleXIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

function PullRequestFilterRadioGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const gt = useGT();
  return (
    <MenuRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value) onChange(next as Value);
      }}
    >
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {options.map((option) => {
        const item = (
          <MenuRadioItem
            key={option.value}
            value={option.value}
            className={option.unavailable ? "data-disabled:pointer-events-auto" : undefined}
            disabled={option.unavailable !== undefined}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestFilterOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailable ? (
                <span className="shrink-0">
                  · {gt("Unavailable", { $context: "filter option" })}
                </span>
              ) : null}
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        );
        if (!option.unavailable) return item;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={item} />
            <TooltipPopup side="top">{option.unavailable}</TooltipPopup>
          </Tooltip>
        );
      })}
    </MenuRadioGroup>
  );
}

export function PullRequestFilterRadioSubmenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        <PullRequestFilterOptionIcon option={current} />
        <span className="flex-1">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <PullRequestFilterRadioGroup
          label={label}
          value={value}
          options={options}
          onChange={onChange}
        />
      </MenuSubPopup>
    </MenuSub>
  );
}

/** The listing's own scope, which the pickers search the host within. */
export type PullRequestFilterOptionScope = EnvironmentQueryTarget<
  Omit<PullRequestFilterOptionsInput, "kind" | "query">
>;

const OPTION_SEARCH_DEBOUNCE_MS = 250;

function useHostedFilterOptions(
  scope: ReadonlyArray<PullRequestFilterOptionScope>,
  kind: PullRequestFilterOptionsInput["kind"],
  query: string,
) {
  const typed = query.trim().slice(0, 100);
  const sent = useDebouncedValue(typed, OPTION_SEARCH_DEBOUNCE_MS);
  const hosted = usePullRequestFilterOptions(
    scope.map(({ environmentId, input }) => ({
      environmentId,
      input: { ...input, kind, ...(sent ? { query: sent } : {}) },
    })),
  );
  // Until the search catches up with the typing, the host's answers are for older text.
  return sent === typed ? hosted : { labels: [], authors: [], error: null, isPending: true };
}

function PullRequestAuthorChoices({
  value,
  options,
  scope,
  onChange,
}: {
  value: string | undefined;
  options: ReadonlyArray<PullRequestAuthorFacet>;
  scope: ReadonlyArray<PullRequestFilterOptionScope>;
  onChange: (author: string | undefined) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const hosted = useHostedFilterOptions(scope, "authors", query);
  const login = value?.toLowerCase() ?? "";
  const selected = selectedPullRequestAuthor(options, hosted.authors, value);
  const visible = [
    ...(selected ? [selected] : []),
    ...pullRequestAuthorChoices(options, hosted.authors, query).filter(
      (option) => option.actor.login.toLowerCase() !== login,
    ),
  ].slice(0, 30);
  const select = (next: string) => next.toLowerCase() !== login && onChange(next || undefined);
  return (
    <>
      <MenuSearchInput
        autoFocus
        busy={hosted.isPending}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={gt("Search authors")}
        aria-label={gt("Search authors")}
      />
      <MenuRadioGroup value={selected?.actor.login ?? value ?? ""} onValueChange={select}>
        <MenuRadioItem value="">
          <span className="flex min-w-0 items-center gap-2">
            <LayersIcon aria-hidden className="size-3.5" />
            <T>Anyone</T>
          </span>
        </MenuRadioItem>
        {visible.map((option) => (
          <MenuRadioItem key={option.actor.login.toLowerCase()} value={option.actor.login}>
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestActorAvatar actor={option.actor} />
              <span className="min-w-0 flex-1 truncate">{option.actor.login}</span>
              {option.mergedCount > 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.mergedCount} {option.mergedCount === 1 ? "merge" : "merges"} loaded
                </span>
              ) : null}
            </span>
          </MenuRadioItem>
        ))}
        {visible.length === 0 && !hosted.isPending ? (
          <MenuItem disabled>
            {hosted.error === null
              ? gt("No authors found")
              : gt("Couldn't search authors on the host")}
          </MenuItem>
        ) : null}
      </MenuRadioGroup>
    </>
  );
}

function PullRequestAuthorFilter({
  value,
  options,
  scope,
  onChange,
}: {
  value: string | undefined;
  options: ReadonlyArray<PullRequestAuthorFacet>;
  scope: ReadonlyArray<PullRequestFilterOptionScope>;
  onChange: (author: string | undefined) => void;
}) {
  const gt = useGT();
  return (
    <MenuSub>
      <MenuSubTrigger>
        <UserRoundIcon aria-hidden className="size-3.5" />
        <span className="flex-1">
          <T>Author</T>
        </span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {value ?? gt("Anyone")}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <PullRequestAuthorChoices
          value={value}
          options={options}
          scope={scope}
          onChange={onChange}
        />
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestLabelChoices({
  value,
  options,
  scope,
  onChange,
}: {
  value: ReadonlyArray<string>;
  options: ReadonlyArray<PullRequestLabelFacet>;
  scope: ReadonlyArray<PullRequestFilterOptionScope>;
  onChange: (labels: ReadonlyArray<string>) => void;
}) {
  const gt = useGT();
  const [query, setQuery] = useState("");
  const hosted = useHostedFilterOptions(scope, "labels", query);
  const selected = new Set(value.map((name) => name.toLowerCase()));
  const choices = pullRequestLabelChoices(options, hosted.labels, query);
  const visible = [
    ...value
      .filter((name) => !choices.some((option) => option.name.toLowerCase() === name.toLowerCase()))
      .map((name) => ({ name, color: null, count: 0 })),
    ...choices,
  ];
  return (
    <>
      <MenuSearchInput
        autoFocus
        busy={hosted.isPending}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={gt("Search labels")}
        aria-label={gt("Search labels")}
      />
      {visible.length === 0 && !hosted.isPending ? (
        <MenuItem disabled>
          {hosted.error === null ? gt("No labels found") : gt("Couldn't search labels on the host")}
        </MenuItem>
      ) : null}
      {visible.map((option) => {
        const key = option.name.toLowerCase();
        const dot = pullRequestLabelColor(option.color);
        return (
          <MenuCheckboxItem
            key={key}
            checked={selected.has(key)}
            onCheckedChange={(next) =>
              onChange(
                next
                  ? [...value, option.name]
                  : value.filter((name) => name.toLowerCase() !== option.name.toLowerCase()),
              )
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
                {...(dot ? { style: { backgroundColor: dot } } : {})}
              />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {option.count > 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {option.count}
                </span>
              ) : null}
            </span>
          </MenuCheckboxItem>
        );
      })}
    </>
  );
}

function PullRequestLabelFilter({
  value,
  options,
  scope,
  onChange,
}: {
  value: ReadonlyArray<string>;
  options: ReadonlyArray<PullRequestLabelFacet>;
  scope: ReadonlyArray<PullRequestFilterOptionScope>;
  onChange: (labels: ReadonlyArray<string>) => void;
}) {
  const gt = useGT();
  return (
    <MenuSub>
      <MenuSubTrigger>
        <TagIcon aria-hidden className="size-3.5" />
        <span className="flex-1">
          <T>Labels</T>
        </span>
        <span className="text-xs text-muted-foreground">
          {value.length === 0
            ? gt("Any", { $context: "no label filter" })
            : gt("{count, plural, one {{count} selected} other {{count} selected}}", {
                count: value.length,
              })}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <PullRequestLabelChoices
          value={value}
          options={options}
          scope={scope}
          onChange={onChange}
        />
      </MenuSubPopup>
    </MenuSub>
  );
}

/** What a project row is: enough to render it, and enough to hand back when it is picked. */
export type PullRequestProjectOption = ProjectFaviconProject & { readonly id: ProjectId };

/**
 * Several projects at once, since a reader watching two repositories wants both lists and not
 * two visits. "All projects" is the way back out, and is also what an empty selection means.
 * Projects that could not be read sink to the bottom and cannot be picked.
 */
function PullRequestProjectFilter({
  projects,
  selected,
  unavailable,
  onChange,
}: {
  projects: ReadonlyArray<PullRequestProjectOption>;
  /** The picked projects, by `pullRequestProjectKey`. Empty is every project. */
  selected: ReadonlySet<string>;
  unavailable: ReadonlyMap<string, string>;
  onChange: (projects: ReadonlyArray<PullRequestProjectOption>) => void;
}) {
  const gt = useGT();
  const ordered = projects.toSorted(
    (left, right) =>
      Number(unavailable.has(pullRequestProjectKey(left))) -
      Number(unavailable.has(pullRequestProjectKey(right))),
  );
  const picked = ordered.filter((project) => selected.has(pullRequestProjectKey(project)));
  const summary =
    picked.length === 0
      ? gt("All", { $context: "every project" })
      : picked.length === 1
        ? (picked[0]?.title ?? gt("All", { $context: "every project" }))
        : gt("{count} selected", { count: picked.length });
  return (
    <MenuSub>
      <MenuSubTrigger>
        {picked.length === 1 && picked[0] ? (
          <PullRequestFilterOptionIcon
            option={{
              value: pullRequestProjectKey(picked[0]),
              label: picked[0].title,
              Icon: FolderGit2Icon,
              project: picked[0],
            }}
          />
        ) : (
          <LayersIcon aria-hidden className="size-3.5" />
        )}
        <span className="flex-1">{gt("Project", { $context: "pull request filter" })}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">{summary}</span>
      </MenuSubTrigger>
      <MenuSubPopup className="w-72">
        <MenuItem
          onClick={(event) => {
            // Clearing is one press, and the menu stays open so the next pick follows it.
            event.preventDefault();
            if (picked.length > 0) onChange([]);
          }}
        >
          <LayersIcon aria-hidden className="size-3.5" />
          <span className="flex-1">
            <T>All projects</T>
          </span>
        </MenuItem>
        <MenuSeparator />
        {ordered.length === 0 ? (
          <MenuItem disabled>
            <T>No projects in this view</T>
          </MenuItem>
        ) : (
          ordered.map((project) => {
            const key = pullRequestProjectKey(project);
            const reason = unavailable.get(key);
            const checked = selected.has(key);
            const item = (
              <MenuCheckboxItem
                key={key}
                className={`grid-cols-[1rem_minmax(0,1fr)] ${reason ? "data-disabled:pointer-events-auto" : ""}`}
                checked={checked}
                disabled={reason !== undefined}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? [...picked, project]
                      : picked.filter((candidate) => pullRequestProjectKey(candidate) !== key),
                  )
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ProjectFavicon project={project} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  {reason ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <T>Unavailable</T>
                    </span>
                  ) : null}
                </span>
              </MenuCheckboxItem>
            );
            if (reason === undefined) return item;
            return (
              <Tooltip key={key}>
                <TooltipTrigger render={item} />
                <TooltipPopup side="top" className="max-w-80">
                  {reason}
                </TooltipPopup>
              </Tooltip>
            );
          })
        )}
      </MenuSubPopup>
    </MenuSub>
  );
}

/**
 * List narrowings live behind one filter control, separate from sorting. The trigger carries a
 * count whenever any filter is off its default, so a narrowed list is never a mystery.
 */
export function PullRequestFiltersMenu({
  onOpenChange,
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
  authorOptions = [],
  labelOptions = [],
  optionScope,
  host,
  hostOptions,
  onHost,
  server,
  serverOptions,
  onServer,
  projects,
  projectIds,
  unavailable,
  onProjects,
}: {
  onOpenChange?: (open: boolean) => void;
  state: PullRequestListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;
  onState: (state: PullRequestListState) => void;
  involvement: PullRequestInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  filters: PullRequestListFilters;
  onFilters: (filters: PullRequestListFilters) => void;
  authorOptions?: ReadonlyArray<PullRequestAuthorFacet>;
  labelOptions?: ReadonlyArray<PullRequestLabelFacet>;
  optionScope: ReadonlyArray<PullRequestFilterOptionScope>;
  host: string | undefined;
  hostOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  serverOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onServer: (server: EnvironmentId | undefined) => void;
  /** The projects of every connected environment, each carrying the one its favicon is read from. */
  projects: ReadonlyArray<PullRequestProjectOption>;
  /**
   * The projects the list is scoped to, by id. Empty is every project. An id names a project
   * only within its own server, so where two servers hold one id both rows read as picked —
   * the server filter above is what tells those apart, and picking on one server sets it.
   */
  projectIds: ReadonlyArray<ProjectId>;
  /**
   * Projects whose repository could not be read this time round. They are named here, where
   * the reader is already choosing between projects, rather than as a count above the list
   * that says something is missing without saying which.
   */
  unavailable: ReadonlyMap<string, string>;
  /** The whole new selection, each project carrying the server whose copy of it was picked. */
  onProjects: (projects: ReadonlyArray<PullRequestProjectOption>) => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const selectedLabels = (filters.labels ?? []).flatMap((group) => group);
  const filterCount = [
    state !== "open",
    involvement !== "all",
    host,
    server,
    projectIds.length > 0,
    filters.draft,
    filters.review,
    filters.checks,
    filters.author,
    ...selectedLabels,
  ].filter(Boolean).length;
  const updateFilters = (next: Partial<PullRequestListFilters>) =>
    onFilters(
      Object.fromEntries(
        Object.entries({ ...filters, ...next }).filter(([, value]) => value !== undefined),
      ) as PullRequestListFilters,
    );
  const updateFilter = (key: keyof PullRequestListFilters, value: string) =>
    updateFilters({
      [key]: value === UNFILTERED_VALUE ? undefined : value,
    } as Partial<PullRequestListFilters>);
  // Which rows read as picked. Keyed by server as well as id so the set matches the rows, and
  // built from the ids alone because that is all the scope carries.
  const scopedProjects = new Set(projectIds);
  const selectedProjectKeys = new Set(
    projects
      .filter((project) => scopedProjects.has(project.id))
      .map((project) => pullRequestProjectKey(project)),
  );
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger render={<Button variant="outline" />}>
        <ListFilterIcon className="size-4" />
        <span>
          <T>Filters</T>
        </span>
        {filterCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {filterCount}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <PullRequestFilterRadioSubmenu
          label={gt("State", { $context: "pull request filter" })}
          value={state}
          options={stateOptions}
          onChange={onState}
        />
        <PullRequestFilterRadioSubmenu
          label={gt("Involvement")}
          value={involvement}
          options={involvementOptions}
          onChange={onInvolvement}
        />
        <MenuSeparator />
        <PullRequestAuthorFilter
          value={filters.author}
          options={authorOptions}
          scope={optionScope}
          onChange={(author) => updateFilters({ author })}
        />
        <PullRequestLabelFilter
          value={selectedLabels}
          options={labelOptions}
          scope={optionScope}
          onChange={(labels) =>
            updateFilters({
              labels: labels.length === 0 ? undefined : labels.slice(0, 10).map((label) => [label]),
            })
          }
        />
        <PullRequestFilterRadioSubmenu
          label={gt("Draft", { $context: "pull request filter" })}
          value={filters.draft ?? UNFILTERED_VALUE}
          options={resolveFilterOptions(DRAFT_OPTIONS, resolve)}
          onChange={(draft) => updateFilter("draft", draft)}
        />
        <PullRequestFilterRadioSubmenu
          label={gt("Review", { $context: "pull request filter" })}
          value={filters.review ?? UNFILTERED_VALUE}
          options={resolveFilterOptions(REVIEW_OPTIONS, resolve)}
          onChange={(review) => updateFilter("review", review)}
        />
        <PullRequestFilterRadioSubmenu
          label={gt("Checks", { $context: "pull request filter" })}
          value={filters.checks ?? UNFILTERED_VALUE}
          options={resolveFilterOptions(CHECKS_OPTIONS, resolve)}
          onChange={(checks) => updateFilter("checks", checks)}
        />
        {hostOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label={gt("Host", { $context: "pull request filter" })}
              value={host ?? ALL_HOSTS_VALUE}
              options={hostOptions}
              onChange={(next) => onHost(next === ALL_HOSTS_VALUE ? undefined : next)}
            />
          </>
        ) : null}
        {serverOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label={gt("Server", { $context: "pull request filter" })}
              value={server ?? ALL_SERVERS_VALUE}
              options={serverOptions}
              onChange={(next) =>
                onServer(next === ALL_SERVERS_VALUE ? undefined : (next as EnvironmentId))
              }
            />
          </>
        ) : null}
        <MenuSeparator />
        <PullRequestProjectFilter
          projects={projects}
          selected={selectedProjectKeys}
          unavailable={unavailable}
          onChange={onProjects}
        />
      </MenuPopup>
    </Menu>
  );
}
